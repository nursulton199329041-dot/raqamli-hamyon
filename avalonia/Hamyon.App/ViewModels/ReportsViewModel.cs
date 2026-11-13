using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Controls;
using Hamyon.App.Data;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One line of the breakdown under the ring chart.</summary>
public sealed record BreakdownRowVm(string Name, string Icon, string Color, string Amount, string Percent, double Share);

public partial class OptionVm : ObservableObject
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    [ObservableProperty] public partial bool IsSelected { get; set; }
}

/// <summary>
/// Reports: expenses (by category) or income (by source) for a month or a year in ONE currency — currencies are
/// never mixed. Bars per day (month) or per month (year), a ring chart with shares, and three key numbers.
/// </summary>
public partial class ReportsViewModel : ViewModelBase
{
    private static readonly string[] MonthsUz = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
    private static readonly string[] MonthsShort = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];

    private readonly LocalStore _store;

    public ObservableCollection<OptionVm> Kinds { get; } =
    [
        new() { Key = "expense", Title = "Xarajatlar", IsSelected = true },
        new() { Key = "income", Title = "Kirimlar" },
    ];
    public ObservableCollection<OptionVm> Ranges { get; } =
    [
        new() { Key = "month", Title = "Oy", IsSelected = true },
        new() { Key = "year", Title = "Yil" },
    ];
    public ObservableCollection<OptionVm> Currencies { get; } = new();
    public ObservableCollection<BreakdownRowVm> Breakdown { get; } = new();

    [ObservableProperty] public partial DateTime Anchor { get; set; } = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] public partial IReadOnlyList<double> Bars { get; set; } = [];
    [ObservableProperty] public partial IReadOnlyList<string> BarLabels { get; set; } = [];
    [ObservableProperty] public partial IReadOnlyList<ChartSlice> Slices { get; set; } = [];
    [ObservableProperty] public partial string Total { get; set; } = "0";
    [ObservableProperty] public partial string TotalShort { get; set; } = "0";
    [ObservableProperty] public partial string AverageDaily { get; set; } = "0";
    [ObservableProperty] public partial string TopName { get; set; } = "—";
    [ObservableProperty] public partial string TopDetail { get; set; } = "";
    [ObservableProperty] public partial bool IsEmpty { get; set; }

    public bool IsExpense => Kinds[0].IsSelected;
    public bool IsYear => Ranges[1].IsSelected;
    public string Currency => Currencies.FirstOrDefault(c => c.IsSelected)?.Key ?? "UZS";
    public string Title => IsExpense ? "XARAJATLAR" : "KIRIMLAR";
    public string BarColor => IsExpense ? "#FF6B6B" : "#1FCB8B";
    public string RangeTitle => IsYear ? $"{Anchor.Year}" : $"{MonthsUz[Anchor.Month - 1]} {Anchor.Year}";
    public string TopLabel => IsExpense ? "ENG KATTA TOIFA" : "ENG KATTA MANBA";
    public bool CanGoNext => IsYear ? Anchor.Year < DateTime.Today.Year : Anchor < new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

    public ReportsViewModel(LocalStore store)
    {
        _store = store;
        Refresh();
    }

    partial void OnAnchorChanged(DateTime value) => Refresh();

    [RelayCommand] private void SelectKind(OptionVm o) { Select(Kinds, o); Refresh(); }
    [RelayCommand] private void SelectRange(OptionVm o) { Select(Ranges, o); Refresh(); }
    [RelayCommand] private void SelectCurrency(OptionVm o) { Select(Currencies, o); Refresh(); }
    [RelayCommand] private void Prev() => Anchor = IsYear ? Anchor.AddYears(-1) : Anchor.AddMonths(-1);
    [RelayCommand] private void Next() { if (CanGoNext) Anchor = IsYear ? Anchor.AddYears(1) : Anchor.AddMonths(1); }

    private static void Select(IEnumerable<OptionVm> list, OptionVm o)
    {
        foreach (var x in list) x.IsSelected = x == o;
    }

    [RelayCommand]
    public void Refresh()
    {
        SyncCurrencies();
        var kind = IsExpense ? OpKind.Expense : OpKind.Income;
        var from = IsYear ? new DateTime(Anchor.Year, 1, 1) : Anchor;
        var to = (IsYear ? from.AddYears(1) : from.AddMonths(1)).AddTicks(-1);
        var period = new Period(IsYear ? PeriodKind.Year : PeriodKind.Month, from, to);
        var cur = Currency;

        // bars: every day of the month / every month of the year, empty buckets included
        var series = _store.Series(kind, period, cur, byMonth: IsYear);
        var buckets = IsYear ? 12 : DateTime.DaysInMonth(from.Year, from.Month);
        Bars = Enumerable.Range(1, buckets).Select(i => (double)series.GetValueOrDefault(i)).ToList();
        BarLabels = Enumerable.Range(1, buckets).Select(i => IsYear ? MonthsShort[i - 1] : i.ToString(CultureInfo.InvariantCulture)).ToList();

        // breakdown by category / source in this currency
        var totals = _store.Totals(kind, period);
        var named = IsExpense
            ? _store.Categories().Select(c => (c.Id, c.Name, c.Icon, c.Color))
            : _store.Sources().Select(s => (s.Id, s.Name, s.Icon, s.Color));
        var rows = named
            .Select(n => (n, amount: totals.GetValueOrDefault(n.Id)?.GetValueOrDefault(cur) ?? 0m))
            .Where(x => x.amount > 0)
            .OrderByDescending(x => x.amount)
            .ToList();
        var total = rows.Sum(x => x.amount);

        Breakdown.Clear();
        foreach (var (n, amount) in rows)
        {
            var share = (double)(amount / total);
            Breakdown.Add(new BreakdownRowVm(n.Name, n.Icon, n.Color, Money.Format(amount, cur), $"{Math.Round(share * 100)}%", share));
        }
        Slices = rows.Select(x => new ChartSlice((double)x.amount, x.n.Color)).ToList();

        Total = Money.Format(total, cur);
        TotalShort = Money.Compact(total);
        // average per day over the days that have passed (the whole period once it is over)
        var end = to < DateTime.Now ? to : DateTime.Today.AddDays(1).AddTicks(-1);
        var days = Math.Max(1, (int)Math.Ceiling((end - from).TotalDays));
        AverageDaily = Money.Format(decimal.Round(total / days, 2), cur);
        TopName = rows.Count > 0 ? rows[0].n.Name : "—";
        TopDetail = rows.Count > 0 ? $"{Money.Format(rows[0].amount, cur)} · {Breakdown[0].Percent}" : "";
        IsEmpty = rows.Count == 0;

        foreach (var p in new[] { nameof(IsExpense), nameof(IsYear), nameof(Currency), nameof(Title), nameof(BarColor), nameof(RangeTitle), nameof(TopLabel), nameof(CanGoNext) })
            OnPropertyChanged(p);
    }

    /// <summary>Currency chips = the wallets' currencies (so'm first); the selection survives a refresh.</summary>
    private void SyncCurrencies()
    {
        var wanted = _store.Wallets().Select(w => w.Currency).Distinct().OrderByDescending(c => c == "UZS").ThenBy(c => c).ToList();
        if (wanted.Count == 0) wanted.Add("UZS");
        if (Currencies.Select(c => c.Key).SequenceEqual(wanted)) return;
        var keep = Currency;
        Currencies.Clear();
        foreach (var c in wanted) Currencies.Add(new OptionVm { Key = c, Title = c });
        (Currencies.FirstOrDefault(c => c.Key == keep) ?? Currencies[0]).IsSelected = true;
    }
}
