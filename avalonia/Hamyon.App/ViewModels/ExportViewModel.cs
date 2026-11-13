using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Services;

namespace Hamyon.App.ViewModels;

/// <summary>Settings → Export: pick a period and CSV or PDF, then choose where to save the file.</summary>
public partial class ExportViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action _close;

    public ObservableCollection<OptionVm> Periods { get; } = new();
    public ObservableCollection<OptionVm> Formats { get; } = new();
    [ObservableProperty] public partial string? Status { get; set; }
    [ObservableProperty] public partial bool Busy { get; set; }

    public ExportViewModel(LocalStore store, Action close)
    {
        _store = store;
        _close = close;
        foreach (var (key, title) in new[] { ("month", "exp_this_month"), ("prev", "exp_last_month"), ("year", "exp_this_year"), ("all", "exp_all") })
            Periods.Add(new OptionVm { Key = key, Title = L.T(title), IsSelected = key == "month" });
        Formats.Add(new OptionVm { Key = "csv", Title = "CSV (Excel)", IsSelected = true });
        Formats.Add(new OptionVm { Key = "pdf", Title = "PDF" });
    }

    [RelayCommand] private void SelectPeriod(OptionVm o) { foreach (var x in Periods) x.IsSelected = x == o; Status = null; }
    [RelayCommand] private void SelectFormat(OptionVm o) { foreach (var x in Formats) x.IsSelected = x == o; Status = null; }
    [RelayCommand] private void Close() => _close();

    public (DateTime From, DateTime To, string Label) Range()
    {
        var t = DateTime.Today;
        var month = new DateTime(t.Year, t.Month, 1);
        return Periods.First(p => p.IsSelected).Key switch
        {
            "prev" => (month.AddMonths(-1), month.AddTicks(-1), $"{L.Month(month.AddMonths(-1).Month)} {month.AddMonths(-1).Year}"),
            "year" => (new DateTime(t.Year, 1, 1), new DateTime(t.Year + 1, 1, 1).AddTicks(-1), t.Year.ToString()),
            "all" => (DateTime.MinValue, DateTime.MaxValue, L.T("exp_all")),
            _ => (month, month.AddMonths(1).AddTicks(-1), $"{L.Month(month.Month)} {month.Year}"),
        };
    }

    /// <summary>The file content for the current choice (also used by tests).</summary>
    public (string Name, byte[] Bytes) Build()
    {
        var (from, to, label) = Range();
        var ops = _store.Operations(from, to == DateTime.MaxValue ? DateTime.MaxValue.AddDays(-1) : to);
        var stamp = DateTime.Now.ToString("yyyy-MM-dd");
        if (Formats.First(f => f.IsSelected).Key == "csv")
            return ($"raqamli-hamyon-{stamp}.csv", Export.Csv(ops));
        using var ms = new MemoryStream();
        Export.Pdf(ms, ops, "Raqamli Hamyon", label);
        return ($"raqamli-hamyon-{stamp}.pdf", ms.ToArray());
    }

    [RelayCommand]
    private async Task Save()
    {
        if (Files.Saver is not { } saver) { Status = L.T("exp_unavailable"); return; }
        Busy = true;
        Status = null;
        try
        {
            var (name, bytes) = Build();
            var saved = await saver(name, async s => await s.WriteAsync(bytes));
            Status = saved ? L.T("exp_done", name) : null;
        }
        catch (Exception ex)
        {
            Status = L.T("exp_failed") + " " + ex.Message;
        }
        finally
        {
            Busy = false;
        }
    }
}
