using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Controls;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One line of the breakdown under the ring chart.</summary>
public sealed record BreakdownRowVm(string Name, string Icon, string Color, string Amount, string Percent, double Share);

public partial class OptionVm : ObservableObject
{
    public required string Key { get; init; }
    [ObservableProperty] public partial string Title { get; set; } = "";
    [ObservableProperty] public partial bool IsSelected { get; set; }
}

/// <summary>
/// Reports: expenses (by category) or income (by source) for a month or a year in ONE currency — currencies are
/// never mixed. Bars per day (month) or per month (year), a ring chart with shares, and three key numbers.
/// </summary>
public partial class ReportsViewModel : ViewModelBase
{

    private readonly LocalStore _store;

    public ObservableCollection<OptionVm> Kinds { get; } =
    [
        new() { Key = "expense", Title = L.T("r_expenses"), IsSelected = true },
        new() { Key = "income", Title = L.T("r_incomes") },
    ];
    public ObservableCollection<OptionVm> Currencies { get; } = new();
    public ObservableCollection<BreakdownRowVm> Breakdown { get; } = new();

    /// <summary>The period shown: the current month by default; the filter button picks any other.</summary>
    [ObservableProperty] public partial Period Period { get; set; } = Period.Of(PeriodKind.Month, DateTime.Now);
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
    public string Currency => Currencies.FirstOrDefault(c => c.IsSelected)?.Key ?? "UZS";
    public string Title => L.T(IsExpense ? "r_expenses" : "r_incomes").ToUpperInvariant();
    public string BarColor => IsExpense ? "#FF6B6B" : "#1FCB8B";
    public string RangeTitle => Period.Title;
    public string TopLabel => L.T(IsExpense ? "top_category" : "top_source");
    public bool CanGoNext => !Period.IsLatest;
    public bool CanGoPrev => Period.CanShift;

    public ReportsViewModel(LocalStore store)
    {
        _store = store;
        Refresh();
    }

    partial void OnPeriodChanged(Period value) => Refresh();

    /// <summary>Asks the shell to open the period sheet (filter button, tap on the title).</summary>
    public event Action? OpenPeriod;
    [RelayCommand] private void PickPeriod() => OpenPeriod?.Invoke();

    [RelayCommand] private void SelectKind(OptionVm o) { Select(Kinds, o); Refresh(); }
    [RelayCommand] private void SelectCurrency(OptionVm o) { Select(Currencies, o); Refresh(); }
    [RelayCommand] private void Prev() { if (CanGoPrev) Period = Period.Shift(-1); }
    [RelayCommand] private void Next() { if (CanGoNext) Period = Period.Shift(1); }

    private static void Select(IEnumerable<OptionVm> list, OptionVm o)
    {
        foreach (var x in list) x.IsSelected = x == o;
    }

    [RelayCommand]
    public void Refresh()
    {
        SyncCurrencies();
        // labels follow the current language
        Kinds[0].Title = L.T("r_expenses"); Kinds[1].Title = L.T("r_incomes");
        var kind = IsExpense ? OpKind.Expense : OpKind.Income;
        var period = Period;
        var cur = Currency;
        // "all time" draws from the first operation to today
        var from = period.Kind == PeriodKind.All ? (_store.FirstOperationDate() ?? DateTime.Today).Date : period.From;
        var to = period.Kind == PeriodKind.All ? DateTime.Today.AddDays(1).AddTicks(-1) : period.To;

        // bars: one per day up to ~2 months, otherwise one per month; empty buckets included
        var byMonth = (to - from).TotalDays > 62;
        var series = _store.SeriesByDate(kind, new Period(period.Kind, from, to), cur, byMonth);
        var keys = new List<DateTime>();
        for (var d = byMonth ? new DateTime(from.Year, from.Month, 1) : from.Date; d <= to; d = byMonth ? d.AddMonths(1) : d.AddDays(1)) keys.Add(d);
        Bars = keys.Select(d => (double)series.GetValueOrDefault(d)).ToList();
        var manyYears = byMonth && from.Year != to.Year;
        BarLabels = keys.Select(d => byMonth
            ? (manyYears && d.Month == 1 ? d.Year.ToString(CultureInfo.InvariantCulture) : L.MonthShort(d.Month))
            : d.Day.ToString(CultureInfo.InvariantCulture)).ToList();

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

        foreach (var p in new[] { nameof(IsExpense), nameof(Currency), nameof(Title), nameof(BarColor), nameof(RangeTitle), nameof(TopLabel), nameof(CanGoNext), nameof(CanGoPrev) })
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
