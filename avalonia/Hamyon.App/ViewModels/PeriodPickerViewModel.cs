using System;
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Localization;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One line of the period sheet ("Hafta", "Oy", … "Ixtiyoriy").</summary>
public partial class PeriodOptionVm : ObservableObject
{
    public required PeriodKind Kind { get; init; }
    public required string Title { get; init; }
    [ObservableProperty] public partial bool IsSelected { get; set; }
    [ObservableProperty] public partial string? Hint { get; set; }
    public bool IsCustom => Kind == PeriodKind.Custom;
}

/// <summary>
/// "Hisob davri" sheet: week, month, quarter, half-year, year, all time, or any range (from – to).
/// Used by the home date chip and the filter buttons on History and Reports.
/// </summary>
public partial class PeriodPickerViewModel : ViewModelBase
{
    private readonly Action<Period> _chosen;
    private readonly Action _close;

    public ObservableCollection<PeriodOptionVm> Options { get; } = new();

    /// <summary>The from / to pickers are open (after tapping "Ixtiyoriy").</summary>
    [ObservableProperty] public partial bool CustomOpen { get; set; }
    [ObservableProperty] public partial DateTimeOffset? CustomFrom { get; set; }
    [ObservableProperty] public partial DateTimeOffset? CustomTo { get; set; }

    public PeriodPickerViewModel(Period current, Action<Period> chosen, Action close)
    {
        _chosen = chosen;
        _close = close;
        foreach (var (kind, key) in new[]
                 {
                     (PeriodKind.Week, "p_week"), (PeriodKind.Month, "p_month"), (PeriodKind.Quarter, "p_quarter"),
                     (PeriodKind.HalfYear, "p_half"), (PeriodKind.Year, "p_year"), (PeriodKind.All, "p_all"), (PeriodKind.Custom, "p_custom"),
                 })
            Options.Add(new PeriodOptionVm { Kind = kind, Title = L.T(key), IsSelected = kind == current.Kind });

        // the custom line shows the range in use; its pickers start from the current period (or this month)
        var start = current.Kind == PeriodKind.All ? Period.Of(PeriodKind.Month, DateTime.Now) : current;
        CustomFrom = new DateTimeOffset(start.From.Date);
        CustomTo = new DateTimeOffset(start.To.Date);
        Options[^1].Hint = start.Label;
    }

    [RelayCommand]
    private void Choose(PeriodOptionVm option)
    {
        if (option.IsCustom) { CustomOpen = !CustomOpen; return; }
        _chosen(Period.Of(option.Kind, DateTime.Now));
        _close();
    }

    [RelayCommand]
    private void ApplyCustom()
    {
        var from = CustomFrom?.Date ?? DateTime.Today;
        var to = CustomTo?.Date ?? from;
        _chosen(Period.Custom(from, to));
        _close();
    }

    [RelayCommand] private void Close() => _close();
}
