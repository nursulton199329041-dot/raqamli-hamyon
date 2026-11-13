using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One round tile on the home screen (income source, wallet or expense category).</summary>
public enum TileKind { Source, Wallet, Category }

public sealed record TileVm(TileKind Kind, long Id, string Name, string Icon, string Color, string Amount, bool Negative);

public sealed record BalanceLine(string Text, bool Primary);

/// <summary>
/// Home: big total balance per currency, the period chip, then three sections of round tiles —
/// income sources, wallets and expense categories — with their period totals.
/// </summary>
public partial class HomeViewModel : ViewModelBase
{
    private readonly LocalStore _store;

    [ObservableProperty] public partial bool HideBalance { get; set; }
    [ObservableProperty] public partial Period Period { get; set; } = Period.Of(PeriodKind.Month, DateTime.Now);
    [ObservableProperty] public partial string SourcesTotal { get; set; } = "0";
    [ObservableProperty] public partial string WalletsTotal { get; set; } = "0";
    [ObservableProperty] public partial string CategoriesTotal { get; set; } = "0";
    [ObservableProperty] public partial bool HasDebts { get; set; }
    [ObservableProperty] public partial string OwedToMe { get; set; } = "0";
    [ObservableProperty] public partial string IOwe { get; set; } = "0";

    public ObservableCollection<BalanceLine> Balance { get; } = new();
    public ObservableCollection<TileVm> Sources { get; } = new();
    public ObservableCollection<TileVm> Wallets { get; } = new();
    public ObservableCollection<TileVm> Categories { get; } = new();

    public string PeriodLabel => Period.Label;

    public HomeViewModel(LocalStore store)
    {
        _store = store;
        Refresh();
    }

    partial void OnHideBalanceChanged(bool value) => Refresh();

    partial void OnPeriodChanged(Period value)
    {
        OnPropertyChanged(nameof(PeriodLabel));
        Refresh();
    }

    /// <summary>Asks the shell to open the operation sheet: (kind, from id, to id).</summary>
    public event Action<OpKind, long?, long?>? OpenOperation;

    /// <summary>Source -> income into it; category -> expense from the first wallet; wallet -> transfer from it.</summary>
    [RelayCommand]
    private void OpenTile(TileVm tile)
    {
        switch (tile.Kind)
        {
            case TileKind.Source: OpenOperation?.Invoke(OpKind.Income, tile.Id, null); break;
            case TileKind.Category: OpenOperation?.Invoke(OpKind.Expense, null, tile.Id); break;
            default: OpenOperation?.Invoke(OpKind.Transfer, tile.Id, null); break;
        }
    }

    /// <summary>
    /// Drag &amp; drop: which operation dropping <paramref name="from"/> on <paramref name="to"/> means, or null if it means nothing.
    /// Source → wallet: income. Wallet → category: expense. Wallet → another wallet: transfer.
    /// </summary>
    public static OpKind? DropKind(TileVm from, TileVm to) => (from.Kind, to.Kind) switch
    {
        (TileKind.Source, TileKind.Wallet) => OpKind.Income,
        (TileKind.Wallet, TileKind.Category) => OpKind.Expense,
        (TileKind.Wallet, TileKind.Wallet) when from.Id != to.Id => OpKind.Transfer,
        _ => null,
    };

    /// <summary>Opens the operation sheet with both ends already chosen. Returns false for a meaningless drop.</summary>
    public bool Drop(TileVm from, TileVm to)
    {
        if (DropKind(from, to) is not { } kind) return false;
        // the sheet takes (from, to) in its own terms: income = (source, wallet), expense = (wallet, category), transfer = (wallet, wallet)
        OpenOperation?.Invoke(kind, from.Id, to.Id);
        return true;
    }

    public event Action? OpenDebts;

    [RelayCommand] private void ShowDebts() => OpenDebts?.Invoke();

    [RelayCommand] private void ToggleBalance() => HideBalance = !HideBalance;

    [RelayCommand] private void NextPeriod() => Period = Period.Of(Period.Next(), DateTime.Now);

    [RelayCommand]
    public void Refresh()
    {
        var wallets = _store.Wallets();
        var byCurrency = wallets.GroupBy(w => w.Currency).ToDictionary(g => g.Key, g => g.Sum(w => w.Balance));

        // the main currency (so'm) first and largest, other currencies below it
        Balance.Clear();
        var lines = byCurrency.Count == 0 ? new Dictionary<string, decimal> { ["UZS"] = 0 } : byCurrency;
        foreach (var (cur, total) in lines.OrderByDescending(k => k.Key == "UZS").ThenBy(k => k.Key))
            Balance.Add(new BalanceLine(HideBalance ? $"•••• {cur}" : Money.Format(total, cur), Balance.Count == 0));

        var income = _store.Totals(OpKind.Income, Period);
        var expense = _store.Totals(OpKind.Expense, Period);

        Fill(Sources, _store.Sources().Select(s => Tile(TileKind.Source, s.Id, s.Name, s.Icon, s.Color, income.GetValueOrDefault(s.Id))));
        Fill(Wallets, wallets.Select(w => new TileVm(TileKind.Wallet, w.Id, w.Name, w.Icon, w.Color, Money.Format(w.Balance, w.Currency), w.Balance < 0)));
        Fill(Categories, _store.Categories().Select(c => Tile(TileKind.Category, c.Id, c.Name, c.Icon, c.Color, expense.GetValueOrDefault(c.Id))));

        SourcesTotal = Money.Format(Sum(income.Values));
        WalletsTotal = Money.Format(byCurrency);
        CategoriesTotal = Money.Format(Sum(expense.Values));

        // debts card: shown only while something is open
        var debts = _store.Debts();
        HasDebts = debts.Count > 0;
        OwedToMe = Money.Format(debts.Where(d => d.Balance > 0).GroupBy(d => d.Currency).ToDictionary(g => g.Key, g => g.Sum(d => d.Balance)));
        IOwe = Money.Format(debts.Where(d => d.Balance < 0).GroupBy(d => d.Currency).ToDictionary(g => g.Key, g => -g.Sum(d => d.Balance)));
        OnPropertyChanged(nameof(PeriodLabel));
    }

    private static TileVm Tile(TileKind kind, long id, string name, string icon, string color, Dictionary<string, decimal>? amounts) =>
        new(kind, id, name, icon, color, amounts is null ? "0" : Money.Format(amounts), false);

    private static Dictionary<string, decimal> Sum(IEnumerable<Dictionary<string, decimal>> all)
    {
        var acc = new Dictionary<string, decimal>();
        foreach (var m in all)
            foreach (var (cur, v) in m)
                acc[cur] = acc.GetValueOrDefault(cur) + v;
        return acc;
    }

    private static void Fill(ObservableCollection<TileVm> target, IEnumerable<TileVm> items)
    {
        target.Clear();
        foreach (var i in items) target.Add(i);
    }
}
