using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One round tile on the home screen (income source, wallet or expense category).</summary>
public enum TileKind { Source, Wallet, Category }

/// <param name="IsAdd">the white "+" tile at the end of a section (creates a new item there)</param>
/// <param name="BudgetShare">spent / budget for a category with a budget (bar under the amount), otherwise -1</param>
public sealed record TileVm(TileKind Kind, long Id, string Name, string Icon, string Color, string Amount, bool Negative,
    bool IsAdd = false, double BudgetShare = -1)
{
    public bool HasBudget => BudgetShare >= 0;
    /// <summary>width of the budget bar (the badge is 54 wide)</summary>
    public double BudgetWidth => Math.Clamp(BudgetShare, 0, 1) * 54;
    public bool OverBudget => BudgetShare > 1;
    public bool IsItem => !IsAdd;
}

public sealed record BalanceLine(string Text, bool Primary);

/// <summary>
/// Home: big total balance per currency, the period chip, then three sections of round tiles —
/// income sources, wallets and expense categories — with their period totals. The "⋯" menu opens the guide,
/// the budgets and the panel arrangement mode.
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

    /// <summary>Asks the shell to open a tile's own page (its operations, edit, filter, "+").</summary>
    public event Action<TileVm>? OpenItem;

    /// <summary>Asks the shell to create a new source / wallet / category (the "+" tile).</summary>
    public event Action<CatalogKind>? AddItem;

    [RelayCommand]
    private void OpenTile(TileVm tile)
    {
        if (tile.IsAdd)
        {
            AddItem?.Invoke(tile.Kind switch { TileKind.Source => CatalogKind.Sources, TileKind.Wallet => CatalogKind.Wallets, _ => CatalogKind.Categories });
            return;
        }
        if (EditMode) return; // arranging: taps do nothing, tiles are dragged
        OpenItem?.Invoke(tile);
    }

    /// <summary>
    /// Drag &amp; drop: which operation dropping <paramref name="from"/> on <paramref name="to"/> means, or null if it means nothing.
    /// Source → wallet: income. Wallet → category: expense. Wallet → another wallet: transfer.
    /// </summary>
    public static OpKind? DropKind(TileVm from, TileVm to) => from.IsAdd || to.IsAdd ? null : (from.Kind, to.Kind) switch
    {
        (TileKind.Source, TileKind.Wallet) => OpKind.Income,
        (TileKind.Wallet, TileKind.Category) => OpKind.Expense,
        (TileKind.Wallet, TileKind.Wallet) when from.Id != to.Id => OpKind.Transfer,
        _ => null,
    };

    /// <summary>Is <paramref name="to"/> a place <paramref name="from"/> can be dropped (an operation, or a new place while arranging)?</summary>
    public bool CanDrop(TileVm from, TileVm to) =>
        EditMode ? !from.IsAdd && !to.IsAdd && from.Kind == to.Kind && from.Id != to.Id : DropKind(from, to) is not null;

    /// <summary>Opens the operation sheet with both ends already chosen (or moves the tile while arranging). False = meaningless drop.</summary>
    public bool Drop(TileVm from, TileVm to)
    {
        if (EditMode)
        {
            if (!CanDrop(from, to)) return false;
            Move(from, to);
            return true;
        }
        if (DropKind(from, to) is not { } kind) return false;
        // the sheet takes (from, to) in its own terms: income = (source, wallet), expense = (wallet, category), transfer = (wallet, wallet)
        OpenOperation?.Invoke(kind, from.Id, to.Id);
        return true;
    }

    public event Action? OpenDebts;

    [RelayCommand] private void ShowDebts() => OpenDebts?.Invoke();

    // ---- what the home screen shows (Settings → Home screen) ----

    /// <summary>Keys of the home blocks that can be hidden, in screen order.</summary>
    public static readonly string[] Blocks = ["balance", "sources", "wallets", "categories", "debts"];

    [ObservableProperty] public partial bool ShowBalance { get; set; } = true;
    [ObservableProperty] public partial bool ShowSources { get; set; } = true;
    [ObservableProperty] public partial bool ShowWallets { get; set; } = true;
    [ObservableProperty] public partial bool ShowCategories { get; set; } = true;
    [ObservableProperty] public partial bool ShowDebtsCard { get; set; } = true;
    public bool DebtsVisible => HasDebts && ShowDebtsCard && !EditMode;

    partial void OnShowDebtsCardChanged(bool value) => OnPropertyChanged(nameof(DebtsVisible));
    partial void OnHasDebtsChanged(bool value) => OnPropertyChanged(nameof(DebtsVisible));

    /// <summary>Reads the switches (missing = shown).</summary>
    public void ApplyBlocks(Func<string, string?> pref)
    {
        bool On(string key) => pref("home_" + key) != "0";
        ShowBalance = On("balance");
        ShowSources = On("sources");
        ShowWallets = On("wallets");
        ShowCategories = On("categories");
        ShowDebtsCard = On("debts");
    }

    // ---- current profile (header avatar) ----

    [ObservableProperty] public partial string ProfileName { get; set; } = "";
    [ObservableProperty] public partial string ProfileColor { get; set; } = "#FBF5F2";
    public string ProfileInitial => ProfileName.Length > 0 ? ProfileName[..1].ToUpperInvariant() : "H";

    public void SetProfile(string name, string color)
    {
        ProfileName = name;
        ProfileColor = color;
        OnPropertyChanged(nameof(ProfileInitial));
    }

    public event Action? OpenProfiles;

    [RelayCommand] private void ShowProfiles() => OpenProfiles?.Invoke();

    [RelayCommand] private void ToggleBalance() => HideBalance = !HideBalance;

    [RelayCommand] private void NextPeriod() => Period = Period.Of(Period.Next(), DateTime.Now);

    /// <summary>Asks the shell to open the period sheet (tap on the date chip).</summary>
    public event Action? OpenPeriod;
    [RelayCommand] private void PickPeriod() => OpenPeriod?.Invoke();

    // ---- "⋯" menu: guide, budgets, arrange the panel ----

    [ObservableProperty] public partial bool MenuOpen { get; set; }

    /// <summary>Asks the shell to open the budgets sheet.</summary>
    public event Action? OpenBudgets;

    [RelayCommand] private void ToggleMenu() => MenuOpen = !MenuOpen;
    [RelayCommand] private void Budgets() { MenuOpen = false; OpenBudgets?.Invoke(); }

    // ---- arrange mode: header hidden, tiles dragged to new places within their section, "Tayyor" ends it ----

    [ObservableProperty] public partial bool EditMode { get; set; }
    public bool Normal => !EditMode && !TourOn;

    partial void OnEditModeChanged(bool value)
    {
        OnPropertyChanged(nameof(Normal));
        OnPropertyChanged(nameof(DebtsVisible));
        Refresh();
    }

    [RelayCommand] private void Arrange() { MenuOpen = false; EditMode = true; }
    [RelayCommand] private void ArrangeDone() => EditMode = false;

    /// <summary>Puts <paramref name="from"/> where <paramref name="to"/> is (the others shift) and saves the order.</summary>
    public void Move(TileVm from, TileVm to)
    {
        var list = from.Kind switch { TileKind.Source => Sources, TileKind.Wallet => Wallets, _ => Categories };
        var ids = list.Where(t => !t.IsAdd).Select(t => t.Id).ToList();
        var at = ids.IndexOf(to.Id);
        if (at < 0 || !ids.Remove(from.Id)) return;
        ids.Insert(at, from.Id);
        _store.SetOrder(from.Kind switch { TileKind.Source => "sources", TileKind.Wallet => "wallets", _ => "categories" }, ids);
        Arranged?.Invoke();
        Refresh();
    }

    /// <summary>The order changed (the shell refreshes the other pages and syncs).</summary>
    public event Action? Arranged;

    // ---- guide ("Boshqaruv bo'yicha yordam"): sections one by one, then the two drag gestures ----

    /// <summary>0 = off; 1 incomes, 2 wallets, 3 expenses, 4 "new expense?" drag, 5 "new income?" drag.</summary>
    [ObservableProperty] public partial int TourStep { get; set; }
    public const int TourSteps = 5;

    public bool TourOn => TourStep > 0;
    public bool Tour1 => TourStep == 1;
    public bool Tour2 => TourStep == 2;
    public bool Tour3 => TourStep == 3;
    public bool TourDrag => TourStep is 4 or 5;
    /// <summary>everything except the section being explained is dimmed</summary>
    public bool DimTop => TourOn;
    public bool DimSources => TourOn && TourStep != 1;
    public bool DimWallets => TourOn && TourStep != 2;
    public bool DimCategories => TourOn && TourStep != 3;
    public string TourDragTitle => L.T(TourStep == 5 ? "tour_new_income" : "tour_new_expense");
    public string TourDragText => L.T(TourStep == 5 ? "tour_new_income_hint" : "tour_new_expense_hint");
    /// <summary>the two badges of the drag illustration (real tiles of this book when there are some)</summary>
    public TileVm? TourFrom => TourStep == 5 ? First(Sources) : First(Wallets);
    public TileVm? TourTo => TourStep == 5 ? First(Wallets) : First(Categories);

    private static TileVm? First(IEnumerable<TileVm> list) => list.FirstOrDefault(t => !t.IsAdd);

    /// <summary>The guide was finished or skipped (the shell remembers it so it is shown once).</summary>
    public event Action? TourFinished;

    partial void OnTourStepChanged(int value)
    {
        foreach (var p in new[]
                 {
                     nameof(TourOn), nameof(Tour1), nameof(Tour2), nameof(Tour3), nameof(TourDrag), nameof(DimTop), nameof(DimSources),
                     nameof(DimWallets), nameof(DimCategories), nameof(TourDragTitle), nameof(TourDragText), nameof(TourFrom), nameof(TourTo), nameof(Normal),
                 })
            OnPropertyChanged(p);
    }

    [RelayCommand] public void StartTour() { MenuOpen = false; EditMode = false; TourStep = 1; }

    [RelayCommand]
    private void TourNext()
    {
        if (TourStep >= TourSteps) { TourStep = 0; TourFinished?.Invoke(); }
        else TourStep++;
    }

    [RelayCommand] private void TourSkip() { TourStep = 0; TourFinished?.Invoke(); }

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
        var budgets = _store.Budgets();
        var scale = BudgetScale(Period);

        Fill(Sources, _store.Sources().Select(s => Tile(TileKind.Source, s.Id, s.Name, s.Icon, s.Color, income.GetValueOrDefault(s.Id))), TileKind.Source);
        Fill(Wallets, wallets.Select(w => new TileVm(TileKind.Wallet, w.Id, w.Name, w.Icon, w.Color, Money.Format(w.Balance, w.Currency), w.Balance < 0)), TileKind.Wallet);
        Fill(Categories, _store.Categories().Select(c =>
        {
            var spent = expense.GetValueOrDefault(c.Id);
            var tile = Tile(TileKind.Category, c.Id, c.Name, c.Icon, c.Color, spent);
            if (scale <= 0 || !budgets.TryGetValue(c.Id, out var monthly)) return tile;
            // the budget is per month: compared with the spending of the period shown (in so'm)
            var share = (double)((spent?.GetValueOrDefault(OperationViewModel.BaseCurrency) ?? 0m) / (monthly * scale));
            return tile with { BudgetShare = share, Negative = share > 1 };
        }), TileKind.Category);

        SourcesTotal = Money.Format(Sum(income.Values));
        WalletsTotal = Money.Format(byCurrency);
        CategoriesTotal = Money.Format(Sum(expense.Values));

        // debts card: shown only while something is open
        var debts = _store.Debts();
        HasDebts = debts.Count > 0;
        OwedToMe = Money.Format(debts.Where(d => d.Balance > 0).GroupBy(d => d.Currency).ToDictionary(g => g.Key, g => g.Sum(d => d.Balance)));
        IOwe = Money.Format(debts.Where(d => d.Balance < 0).GroupBy(d => d.Currency).ToDictionary(g => g.Key, g => -g.Sum(d => d.Balance)));
        OnPropertyChanged(nameof(PeriodLabel));
        OnPropertyChanged(nameof(TourFrom));
        OnPropertyChanged(nameof(TourTo));
    }

    /// <summary>How many monthly budgets fit in the period (0 = no budget comparison, e.g. "all time").</summary>
    public static decimal BudgetScale(Period p) => p.Kind switch
    {
        PeriodKind.Month => 1,
        PeriodKind.Quarter => 3,
        PeriodKind.HalfYear => 6,
        PeriodKind.Year => 12,
        PeriodKind.Week or PeriodKind.Custom => decimal.Round(p.Days / 30.4375m, 4),
        _ => 0,
    };

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

    private static void Fill(ObservableCollection<TileVm> target, IEnumerable<TileVm> items, TileKind kind)
    {
        target.Clear();
        foreach (var i in items) target.Add(i);
        target.Add(new TileVm(kind, -1, "", "plus", "#FFFFFF", "", false, IsAdd: true));
    }
}
