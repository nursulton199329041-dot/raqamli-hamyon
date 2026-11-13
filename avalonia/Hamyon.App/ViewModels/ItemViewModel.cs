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

public enum RangeKind { Month, Quarter, Year }

/// <summary>
/// One wallet / category / income source page (tap on a home tile): name, pencil (edit), filter, note search,
/// period with arrows (month / quarter / year), saldo for the period, its operations by day, and the "+" menu
/// (wallet: transfer / income / expense from or into it; category: expense; source: income).
/// </summary>
public partial class ItemViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action<ViewModelBase?> _sheet;
    private readonly Action _changed;
    private readonly HashSet<long> _hiddenSources = new();
    private readonly HashSet<long> _hiddenCategories = new();

    public TileKind Kind { get; }
    public long Id { get; }
    public Action Back { get; }

    [ObservableProperty] public partial string Name { get; set; } = "";
    [ObservableProperty] public partial string Icon { get; set; } = "other";
    [ObservableProperty] public partial string Color { get; set; } = "#64748B";
    [ObservableProperty] public partial string? Search { get; set; }
    [ObservableProperty] public partial RangeKind Range { get; set; } = RangeKind.Month;
    [ObservableProperty] public partial DateTime Anchor { get; set; } = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] public partial string Saldo { get; set; } = "0";
    [ObservableProperty] public partial string Balance { get; set; } = "";
    [ObservableProperty] public partial bool IsEmpty { get; set; }
    [ObservableProperty] public partial bool MenuOpen { get; set; }
    [ObservableProperty] public partial bool FilterOpen { get; set; }

    public ObservableCollection<DayGroupVm> Days { get; } = new();
    public ObservableCollection<ChoiceVm> FilterSources { get; } = new();
    public ObservableCollection<ChoiceVm> FilterCategories { get; } = new();

    public bool IsWallet => Kind == TileKind.Wallet;
    /// <summary>the filter only makes sense for a wallet (it mixes incomes and expenses)</summary>
    public bool CanFilter => IsWallet;
    public bool HasFilter => _hiddenSources.Count + _hiddenCategories.Count > 0;
    public string SourcesCount => $"{FilterSources.Count(x => x.IsSelected)} / {FilterSources.Count}";
    /// <summary>"clear all" while everything is on, "select all" otherwise</summary>
    public string SourcesToggleText => L.T(FilterSources.All(x => x.IsSelected) ? "clear_all" : "select_all");
    public string CategoriesToggleText => L.T(FilterCategories.All(x => x.IsSelected) ? "clear_all" : "select_all");
    public string CategoriesCount => $"{FilterCategories.Count(x => x.IsSelected)} / {FilterCategories.Count}";

    public (DateTime From, DateTime To) Bounds => Range switch
    {
        RangeKind.Quarter => (new DateTime(Anchor.Year, (Anchor.Month - 1) / 3 * 3 + 1, 1), new DateTime(Anchor.Year, (Anchor.Month - 1) / 3 * 3 + 1, 1).AddMonths(3).AddTicks(-1)),
        RangeKind.Year => (new DateTime(Anchor.Year, 1, 1), new DateTime(Anchor.Year + 1, 1, 1).AddTicks(-1)),
        _ => (new DateTime(Anchor.Year, Anchor.Month, 1), new DateTime(Anchor.Year, Anchor.Month, 1).AddMonths(1).AddTicks(-1)),
    };

    /// <summary>"01 okt. – 31 dek., 2026"</summary>
    public string RangeTitle
    {
        get
        {
            var (from, to) = Bounds;
            return $"{from.Day:00} {L.MonthShort(from.Month)}. – {to.Day:00} {L.MonthShort(to.Month)}., {to.Year}";
        }
    }

    public string RangeName => L.T(Range switch { RangeKind.Quarter => "r_quarter", RangeKind.Year => "r_year", _ => "r_month" });

    public ItemViewModel(LocalStore store, TileKind kind, long id, Action back, Action<ViewModelBase?> sheet, Action changed)
    {
        _store = store;
        Kind = kind;
        Id = id;
        Back = back;
        _sheet = sheet;
        _changed = changed;
        foreach (var s in store.Sources()) FilterSources.Add(new ChoiceVm { Id = s.Id, Name = s.Name, Icon = s.Icon, Color = s.Color, IsSelected = true });
        foreach (var c in store.Categories()) FilterCategories.Add(new ChoiceVm { Id = c.Id, Name = c.Name, Icon = c.Icon, Color = c.Color, IsSelected = true });
        Refresh();
    }

    partial void OnSearchChanged(string? value) => Refresh();
    partial void OnRangeChanged(RangeKind value) => Refresh();
    partial void OnAnchorChanged(DateTime value) => Refresh();

    [RelayCommand] private void GoBack() => Back();
    [RelayCommand] private void Prev() => Anchor = Range switch { RangeKind.Quarter => Anchor.AddMonths(-3), RangeKind.Year => Anchor.AddYears(-1), _ => Anchor.AddMonths(-1) };
    [RelayCommand] private void Next() => Anchor = Range switch { RangeKind.Quarter => Anchor.AddMonths(3), RangeKind.Year => Anchor.AddYears(1), _ => Anchor.AddMonths(1) };
    /// <summary>tap on the period: month → quarter → year → month</summary>
    [RelayCommand] private void CycleRange() => Range = Range switch { RangeKind.Month => RangeKind.Quarter, RangeKind.Quarter => RangeKind.Year, _ => RangeKind.Month };

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
        Changed();
    }

    // ---- "+" menu ----

    /// <summary>A category or a source has only one kind of operation, so "+" opens it at once.</summary>
    [RelayCommand]
    private void Plus()
    {
        switch (Kind)
        {
            case TileKind.Category: Open(OpKind.Expense); break;
            case TileKind.Source: Open(OpKind.Income); break;
            default: MenuOpen = !MenuOpen; break;
        }
    }

    [RelayCommand] private void NewTransfer() => Open(OpKind.Transfer);
    [RelayCommand] private void NewIncome() => Open(OpKind.Income);
    [RelayCommand] private void NewExpense() => Open(OpKind.Expense);
    [RelayCommand] private void CloseMenu() => MenuOpen = false;

    private void Open(OpKind kind)
    {
        MenuOpen = false;
        // this item is preselected on its side of the operation
        (long? from, long? to) ends = (Kind, kind) switch
        {
            (TileKind.Wallet, OpKind.Income) => (null, Id),
            (TileKind.Wallet, _) => (Id, null),
            (TileKind.Category, _) => (null, Id),
            _ => (Id, null), // source → income
        };
        _sheet(new OperationViewModel(_store, kind, ends.from, ends.to, onSaved: () => { _sheet(null); Changed(); }, onClose: () => _sheet(null)));
    }

    // ---- pencil: name / icon / colour, and for a wallet its current balance ----

    [RelayCommand]
    private void EditItem()
    {
        var item = new ChoiceVm { Id = Id, Name = Name, Icon = Icon, Color = Color };
        var kind = Kind switch { TileKind.Wallet => CatalogKind.Wallets, TileKind.Category => CatalogKind.Categories, _ => CatalogKind.Sources };
        _sheet(new EditorViewModel(_store, kind, item, done: () => { _sheet(null); Changed(); }, close: () => _sheet(null)));
    }

    // ---- filter (wallet page) ----

    [RelayCommand] private void OpenFilter() => FilterOpen = true;
    [RelayCommand] private void ToggleFilterItem(ChoiceVm c) { c.IsSelected = !c.IsSelected; FilterCounts(); }
    [RelayCommand] private void ToggleAllSources() { var on = !FilterSources.All(x => x.IsSelected); foreach (var x in FilterSources) x.IsSelected = on; FilterCounts(); }
    [RelayCommand] private void ToggleAllCategories() { var on = !FilterCategories.All(x => x.IsSelected); foreach (var x in FilterCategories) x.IsSelected = on; FilterCounts(); }

    [RelayCommand]
    private void ApplyFilter()
    {
        _hiddenSources.Clear();
        _hiddenCategories.Clear();
        foreach (var s in FilterSources.Where(x => !x.IsSelected)) _hiddenSources.Add(s.Id);
        foreach (var c in FilterCategories.Where(x => !x.IsSelected)) _hiddenCategories.Add(c.Id);
        FilterOpen = false;
        OnPropertyChanged(nameof(HasFilter));
        Refresh();
    }

    [RelayCommand]
    private void CloseFilter()
    {
        // discard unapplied changes
        foreach (var s in FilterSources) s.IsSelected = !_hiddenSources.Contains(s.Id);
        foreach (var c in FilterCategories) c.IsSelected = !_hiddenCategories.Contains(c.Id);
        FilterOpen = false;
        FilterCounts();
    }

    private void FilterCounts()
    {
        OnPropertyChanged(nameof(SourcesCount));
        OnPropertyChanged(nameof(CategoriesCount));
        OnPropertyChanged(nameof(SourcesToggleText));
        OnPropertyChanged(nameof(CategoriesToggleText));
    }

    private void Changed()
    {
        Refresh();
        _changed();
    }

    /// <summary>Does this operation touch the item?</summary>
    private bool Touches(OperationRow o) => Kind switch
    {
        TileKind.Wallet => o.WalletId == Id || o.ToWalletId == Id,
        TileKind.Category => o.Kind == OpKind.Expense && o.CategoryId == Id,
        _ => o.Kind == OpKind.Income && o.SourceId == Id,
    };

    private bool PassesFilter(OperationRow o) =>
        !(o.Kind == OpKind.Income && o.SourceId is { } s && _hiddenSources.Contains(s)) &&
        !(o.Kind == OpKind.Expense && o.CategoryId is { } c && _hiddenCategories.Contains(c));

    /// <summary>Signed effect of the operation on this item, in the currency the item counts in.</summary>
    private (string Currency, decimal Amount) Effect(OperationRow o)
    {
        if (Kind != TileKind.Wallet)
            return o.BaseAmount is { } b ? (OperationViewModel.BaseCurrency, b) : (o.Currency, o.Amount); // category / source totals
        if (o.Kind == OpKind.Transfer && o.ToWalletId == Id)
            return (o.ToCurrency ?? o.Currency, o.ToAmount ?? o.Amount); // money arriving
        return o.Kind is OpKind.Income or OpKind.Borrow ? (o.Currency, o.Amount) : (o.Currency, -o.Amount);
    }

    [RelayCommand]
    public void Refresh()
    {
        // header
        switch (Kind)
        {
            case TileKind.Wallet when _store.Wallets().FirstOrDefault(w => w.Id == Id) is { } w:
                (Name, Icon, Color) = (w.Name, w.Icon, w.Color);
                Balance = Money.Format(w.Balance, w.Currency);
                break;
            case TileKind.Category when _store.Categories().FirstOrDefault(c => c.Id == Id) is { } c:
                (Name, Icon, Color) = (c.Name, c.Icon, c.Color);
                break;
            case TileKind.Source when _store.Sources().FirstOrDefault(s => s.Id == Id) is { } s:
                (Name, Icon, Color) = (s.Name, s.Icon, s.Color);
                break;
        }

        var (from, to) = Bounds;
        var q = Search?.Trim();
        var ops = _store.Operations(from, to).Where(Touches).Where(PassesFilter)
            .Where(o => string.IsNullOrEmpty(q) || HistoryViewModel.Matches(o, q)).ToList();

        var saldo = new Dictionary<string, decimal>();
        foreach (var o in ops)
        {
            var (cur, amount) = Effect(o);
            saldo[cur] = saldo.GetValueOrDefault(cur) + amount;
        }
        Saldo = Money.Format(saldo);

        Days.Clear();
        foreach (var day in ops.GroupBy(o => o.Date.Date))
            Days.Add(new DayGroupVm(HistoryViewModel.DayTitle(day.Key), "", day.Select(HistoryViewModel.ToRow).ToList()));
        IsEmpty = Days.Count == 0;
        OnPropertyChanged(nameof(RangeTitle));
        OnPropertyChanged(nameof(RangeName));
    }
}
