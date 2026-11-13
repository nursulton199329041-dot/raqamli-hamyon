using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One line in the history list.</summary>
public partial class HistoryRowVm : ObservableObject
{
    public required long Id { get; init; }
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string Icon { get; init; }
    public required string Color { get; init; }
    public required string Amount { get; init; }
    public required OpKind Kind { get; init; }
    public string? Note { get; init; }
    public bool IsIncome => Kind == OpKind.Income;
    public bool IsExpense => Kind == OpKind.Expense;
    public bool HasNote => !string.IsNullOrEmpty(Note);
    /// <summary>tap shows the row's actions (delete)</summary>
    [ObservableProperty] public partial bool IsOpen { get; set; }
}

/// <summary>A day header ("13-noyabr, payshanba") with that day's net per currency, and its rows.</summary>
public sealed record DayGroupVm(string Title, string Net, IReadOnlyList<HistoryRowVm> Rows);

/// <summary>
/// History by month: balance change ("saldo"), income and expense cards, then operations grouped by day, newest first.
/// Search matches names and notes. Deleting an operation updates every balance at once (they are computed).
/// </summary>
public partial class HistoryViewModel : ViewModelBase
{
    private static readonly string[] MonthsUz = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
    private static readonly string[] WeekdaysUz = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

    private readonly LocalStore _store;
    private readonly Action _changed;

    [ObservableProperty] public partial DateTime Month { get; set; } = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] public partial string? Search { get; set; }
    [ObservableProperty] public partial string Saldo { get; set; } = "0";
    [ObservableProperty] public partial string Income { get; set; } = "0";
    [ObservableProperty] public partial string Expense { get; set; } = "0";
    [ObservableProperty] public partial bool IsEmpty { get; set; }

    public ObservableCollection<DayGroupVm> Days { get; } = new();
    public string MonthTitle => $"{MonthsUz[Month.Month - 1]} {Month.Year}";
    public bool CanGoNext => Month < new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

    /// <param name="changed">called after a delete, so the home screen refreshes too</param>
    public HistoryViewModel(LocalStore store, Action changed)
    {
        _store = store;
        _changed = changed;
        Refresh();
    }

    partial void OnMonthChanged(DateTime value)
    {
        OnPropertyChanged(nameof(MonthTitle));
        OnPropertyChanged(nameof(CanGoNext));
        Refresh();
    }

    partial void OnSearchChanged(string? value) => Refresh();

    [RelayCommand] private void PrevMonth() => Month = Month.AddMonths(-1);
    [RelayCommand] private void NextMonth() { if (CanGoNext) Month = Month.AddMonths(1); }

    [RelayCommand]
    private void Toggle(HistoryRowVm row)
    {
        var open = !row.IsOpen;
        foreach (var r in Days.SelectMany(d => d.Rows)) r.IsOpen = false;
        row.IsOpen = open;
    }

    [RelayCommand]
    private void Delete(HistoryRowVm row)
    {
        _store.DeleteOperation(row.Id);
        Refresh();
        _changed();
    }

    [RelayCommand]
    public void Refresh()
    {
        var all = _store.Operations(Month, Month.AddMonths(1).AddTicks(-1));

        // month totals (whole month, not just the search hits): transfers move money, they are neither in nor out
        var inc = Sum(all.Where(o => o.Kind == OpKind.Income));
        var exp = Sum(all.Where(o => o.Kind == OpKind.Expense));
        Income = Money.Format(inc);
        Expense = Money.Format(exp);
        Saldo = Money.Format(Net(inc, exp));

        var q = Search?.Trim();
        var rows = string.IsNullOrEmpty(q) ? all : all.Where(o => Matches(o, q)).ToList();

        Days.Clear();
        foreach (var day in rows.GroupBy(o => o.Date.Date))
        {
            var dayNet = Net(Sum(day.Where(o => o.Kind == OpKind.Income)), Sum(day.Where(o => o.Kind == OpKind.Expense)));
            Days.Add(new DayGroupVm(
                $"{day.Key.Day}-{MonthsUz[day.Key.Month - 1]}, {WeekdaysUz[(int)day.Key.DayOfWeek]}",
                dayNet.Count == 0 ? "" : Money.Format(dayNet),
                day.Select(ToRow).ToList()));
        }
        IsEmpty = Days.Count == 0;
    }

    private static HistoryRowVm ToRow(OperationRow o) => o.Kind switch
    {
        OpKind.Income => new HistoryRowVm
        {
            Id = o.Id, Kind = o.Kind, Note = o.Note,
            Title = o.SourceName ?? "Kirim", Subtitle = o.WalletName ?? "",
            Icon = o.SourceIcon ?? "plus", Color = o.SourceColor ?? "#1FCB8B",
            Amount = "+" + Money.Format(o.Amount, o.Currency),
        },
        OpKind.Expense => new HistoryRowVm
        {
            Id = o.Id, Kind = o.Kind, Note = o.Note,
            Title = o.CategoryName ?? "Xarajat", Subtitle = o.WalletName ?? "",
            Icon = o.CategoryIcon ?? "other", Color = o.CategoryColor ?? "#FF6B6B",
            Amount = "−" + Money.Format(o.Amount, o.Currency),
        },
        _ => new HistoryRowVm
        {
            Id = o.Id, Kind = o.Kind, Note = o.Note,
            Title = "O‘tkazma", Subtitle = $"{o.WalletName} → {o.ToWalletName}",
            Icon = "swap", Color = "#7C6CFF",
            Amount = o.ToAmount is { } ta && o.ToCurrency is { } tc && tc != o.Currency
                ? $"{Money.Format(o.Amount, o.Currency)} → {Money.Format(ta, tc)}"
                : Money.Format(o.Amount, o.Currency),
        },
    };

    private static bool Matches(OperationRow o, string q) =>
        new[] { o.SourceName, o.CategoryName, o.WalletName, o.ToWalletName, o.Note }
            .Any(s => s?.Contains(q, StringComparison.CurrentCultureIgnoreCase) == true);

    private static Dictionary<string, decimal> Sum(IEnumerable<OperationRow> ops) =>
        ops.GroupBy(o => o.Currency).ToDictionary(g => g.Key, g => g.Sum(o => o.Amount));

    private static Dictionary<string, decimal> Net(Dictionary<string, decimal> inc, Dictionary<string, decimal> exp)
    {
        var net = new Dictionary<string, decimal>(inc);
        foreach (var (cur, v) in exp) net[cur] = net.GetValueOrDefault(cur) - v;
        return net;
    }
}
