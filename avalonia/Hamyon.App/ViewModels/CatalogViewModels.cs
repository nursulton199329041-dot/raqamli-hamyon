using System;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

public enum CatalogKind { Wallets, Categories, Sources }

/// <summary>Settings → Wallets / Expense categories / Income sources: the list, "add" and tap-to-edit.</summary>
public partial class CatalogViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action<ViewModelBase?> _sheet;
    private readonly Action _changed;

    public CatalogKind Kind { get; }
    public Action Back { get; }
    public string Title => L.T(Kind switch { CatalogKind.Wallets => "manage_wallets", CatalogKind.Categories => "manage_categories", _ => "manage_sources" }).ToUpperInvariant();
    public ObservableCollection<ChoiceVm> Items { get; } = new();

    public CatalogViewModel(LocalStore store, CatalogKind kind, Action back, Action<ViewModelBase?> sheet, Action changed)
    {
        _store = store;
        Kind = kind;
        Back = back;
        _sheet = sheet;
        _changed = changed;
        Refresh();
    }

    public void Refresh()
    {
        Items.Clear();
        switch (Kind)
        {
            case CatalogKind.Wallets:
                foreach (var w in _store.Wallets())
                    Items.Add(new ChoiceVm { Id = w.Id, Name = w.Name, Icon = w.Icon, Color = w.Color, Hint = Money.Format(w.Balance, w.Currency) });
                break;
            case CatalogKind.Categories:
                foreach (var c in _store.Categories()) Items.Add(new ChoiceVm { Id = c.Id, Name = c.Name, Icon = c.Icon, Color = c.Color });
                break;
            default:
                foreach (var s in _store.Sources()) Items.Add(new ChoiceVm { Id = s.Id, Name = s.Name, Icon = s.Icon, Color = s.Color });
                break;
        }
    }

    [RelayCommand] private void GoBack() => Back();
    [RelayCommand] private void Add() => _sheet(new EditorViewModel(_store, Kind, null, Done, () => _sheet(null)));
    [RelayCommand] private void Edit(ChoiceVm item) => _sheet(new EditorViewModel(_store, Kind, item, Done, () => _sheet(null)));

    private void Done()
    {
        _sheet(null);
        Refresh();
        _changed();
    }
}

/// <summary>Bottom sheet that creates or edits a wallet, category or source.</summary>
public partial class EditorViewModel : ViewModelBase
{
    private static readonly string[] WalletIcons = ["cash", "card", "savings", "wallet", "business", "home"];
    private static readonly string[] CategoryIcons = ["food", "transport", "utilities", "home", "health", "fun", "salary", "card", "savings", "other"];
    private static readonly string[] SourceIcons = ["salary", "business", "savings", "cash", "card", "other"];
    public static readonly string[] Palette =
        ["#1FCB8B", "#22A06B", "#84CC16", "#14B8A6", "#3B82F6", "#4D8DFF", "#8B5CF6", "#EC4899", "#EF4444", "#F97316", "#F5A524", "#64748B"];
    private static readonly string[] CurrencyList = ["UZS", "USD", "EUR", "RUB"];

    private readonly LocalStore _store;
    private readonly CatalogKind _kind;
    private readonly long? _id;
    private readonly Action _done;
    private readonly Action _close;

    public bool IsNew => _id is null;
    public bool IsWallet => _kind == CatalogKind.Wallets;
    public bool ShowMoney => IsNew && IsWallet;
    public string Title => IsNew
        ? L.T(_kind switch { CatalogKind.Wallets => "new_wallet", CatalogKind.Categories => "new_category", _ => "new_source" })
        : L.T("edit");

    public ObservableCollection<ChoiceVm> Icons { get; } = new();
    public ObservableCollection<ChoiceVm> Colors { get; } = new();
    public ObservableCollection<OptionVm> Currencies { get; } = new();

    [ObservableProperty] public partial string? Name { get; set; }
    [ObservableProperty] public partial string? Opening { get; set; }
    [ObservableProperty] public partial string? Error { get; set; }

    public string SelectedColor => Colors.FirstOrDefault(c => c.IsSelected)?.Color ?? Palette[0];

    public EditorViewModel(LocalStore store, CatalogKind kind, ChoiceVm? existing, Action done, Action close)
    {
        _store = store;
        _kind = kind;
        _id = existing?.Id;
        _done = done;
        _close = close;
        Name = existing?.Name;

        var icons = kind switch { CatalogKind.Wallets => WalletIcons, CatalogKind.Categories => CategoryIcons, _ => SourceIcons };
        var i = 0;
        foreach (var ic in icons) Icons.Add(new ChoiceVm { Id = i++, Name = ic, Icon = ic, Color = "#00000000" });
        i = 0;
        foreach (var c in Palette) Colors.Add(new ChoiceVm { Id = i++, Name = c, Icon = "", Color = c });
        foreach (var cur in CurrencyList) Currencies.Add(new OptionVm { Key = cur, Title = cur, IsSelected = cur == "UZS" });

        (Icons.FirstOrDefault(x => x.Icon == existing?.Icon) ?? Icons[0]).IsSelected = true;
        (Colors.FirstOrDefault(x => string.Equals(x.Color, existing?.Color, StringComparison.OrdinalIgnoreCase)) ?? Colors[0]).IsSelected = true;
        RefreshIconColor();
    }

    [RelayCommand] private void SelectIcon(ChoiceVm c) { foreach (var x in Icons) x.IsSelected = x == c; }

    [RelayCommand]
    private void SelectColor(ChoiceVm c)
    {
        foreach (var x in Colors) x.IsSelected = x == c;
        RefreshIconColor();
    }

    [RelayCommand] private void SelectCurrency(OptionVm o) { foreach (var x in Currencies) x.IsSelected = x == o; }
    [RelayCommand] private void Close() => _close();

    /// <summary>icon chips are drawn in the chosen colour</summary>
    private void RefreshIconColor()
    {
        var selected = Icons.Where(x => x.IsSelected).Select(x => x.Icon).FirstOrDefault();
        var color = SelectedColor;
        var items = Icons.Select(x => new ChoiceVm { Id = x.Id, Name = x.Name, Icon = x.Icon, Color = color, IsSelected = x.Icon == selected }).ToList();
        Icons.Clear();
        foreach (var x in items) Icons.Add(x);
        OnPropertyChanged(nameof(SelectedColor));
    }

    [RelayCommand]
    private void Save()
    {
        var name = Name?.Trim();
        if (string.IsNullOrEmpty(name)) { Error = L.T("err_name"); return; }
        var icon = Icons.First(x => x.IsSelected).Icon;
        var color = SelectedColor;
        var table = _kind == CatalogKind.Categories ? "categories" : "sources";

        if (IsWallet)
        {
            if (IsNew)
            {
                var opening = string.IsNullOrWhiteSpace(Opening) ? 0m : Calc.Evaluate(Opening.Trim()) ?? -1m;
                if (opening < 0) { Error = L.T("err_amount"); return; }
                _store.AddWallet(name, icon, color, Currencies.First(c => c.IsSelected).Key, opening);
            }
            else _store.UpdateWallet(_id!.Value, name, icon, color);
        }
        else if (IsNew) _store.AddNamed(table, name, icon, color);
        else _store.UpdateNamed(table, _id!.Value, name, icon, color);
        _done();
    }

    [RelayCommand]
    private void Archive()
    {
        if (_id is not { } id) return;
        if (IsWallet)
        {
            // money can't disappear: only an empty wallet goes to the archive
            if (_store.Wallets().FirstOrDefault(w => w.Id == id) is { Balance: not 0 }) { Error = L.T("err_archive_balance"); return; }
            _store.ArchiveWallet(id);
        }
        else _store.ArchiveNamed(_kind == CatalogKind.Categories ? "categories" : "sources", id);
        _done();
    }
}
