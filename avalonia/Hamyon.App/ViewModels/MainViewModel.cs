using System;
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using Hamyon.App.Services;

namespace Hamyon.App.ViewModels;

public partial class TabVm : ObservableObject
{
    public required string Key { get; init; }
    public required string Icon { get; init; }
    public string Title => L.T("tab_" + Key);
    [ObservableProperty] public partial bool IsActive { get; set; }
}

/// <summary>
/// Shell: the current screen, the floating bottom bar (Home, History, Reports, Settings), sub-pages opened from
/// Settings (catalog, debts) and the bottom sheet. Language and accent colour are loaded from the book's settings.
/// </summary>
public partial class MainViewModel : ViewModelBase
{
    private readonly LocalStore _store;

    public HomeViewModel Home { get; }
    public HistoryViewModel History { get; }
    public ReportsViewModel Reports { get; }
    public SettingsViewModel Settings { get; }
    public ObservableCollection<TabVm> Tabs { get; }

    [ObservableProperty] public partial ViewModelBase Current { get; set; }

    /// <summary>Bottom sheet over everything (operation, catalog editor); null = closed.</summary>
    [ObservableProperty] public partial ViewModelBase? Sheet { get; set; }

    /// <summary>Raised after a language change: the view tree is rebuilt so every {l:T} string is read again.</summary>
    public event Action? LanguageChanged;

    public MainViewModel() : this(new LocalStore()) { }

    public MainViewModel(LocalStore store)
    {
        _store = store;
        if (Enum.TryParse<Lang>(store.GetSetting("lang"), out var lang)) L.Current = lang;
        Appearance.ApplyAccent(store.GetSetting("accent"));

        Home = new HomeViewModel(store);
        History = new HistoryViewModel(store, changed: RefreshAll);
        Reports = new ReportsViewModel(store);
        Settings = new SettingsViewModel(store,
            navigate: vm => Current = vm,
            catalog: kind => new CatalogViewModel(store, kind, back: () => Current = Settings, sheet: s => Sheet = s, changed: RefreshAll),
            debts: NewDebts,
            languageChanged: () => { RefreshAll(); LanguageChanged?.Invoke(); },
            wiped: RefreshAll);

        Home.OpenOperation += (kind, from, to) =>
            Sheet = new OperationViewModel(store, kind, from, to, onSaved: () => { Sheet = null; RefreshAll(); }, onClose: () => Sheet = null);
        Home.OpenDebts += () => Current = NewDebts();

        Tabs =
        [
            new TabVm { Key = "home", Icon = "wallet", IsActive = true },
            new TabVm { Key = "history", Icon = "history" },
            new TabVm { Key = "reports", Icon = "chart" },
            new TabVm { Key = "settings", Icon = "settings" },
        ];
        Current = Home;
    }

    private DebtsViewModel NewDebts() =>
        new(_store, back: () => Current = Settings, sheet: s => Sheet = s, changed: RefreshAll);

    private void RefreshAll()
    {
        Home.Refresh();
        History.Refresh();
        Reports.Refresh();
    }

    [RelayCommand] private void CloseSheet() => Sheet = null;

    /// <summary>
    /// Phone "back": closes the sheet, then leaves a settings sub-page, then returns to Home.
    /// Returns false on Home with nothing open, so the system can leave the app.
    /// </summary>
    public bool HandleBack()
    {
        if (Sheet is not null) { Sheet = null; return true; }
        if (Current is CatalogViewModel or DebtsViewModel) { Current = Settings; return true; }
        if (Current != Home) { SelectTab(Tabs[0]); return true; }
        return false;
    }

    [RelayCommand]
    private void SelectTab(TabVm tab)
    {
        foreach (var t in Tabs) t.IsActive = t == tab;
        switch (tab.Key)
        {
            case "home": Home.Refresh(); Current = Home; break;
            case "history": History.Refresh(); Current = History; break;
            case "reports": Reports.Refresh(); Current = Reports; break;
            default: Current = Settings; break;
        }
    }
}
