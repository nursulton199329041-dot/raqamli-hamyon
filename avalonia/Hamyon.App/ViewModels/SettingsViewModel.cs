using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Reflection;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Services;

namespace Hamyon.App.ViewModels;

public partial class ToggleVm : ObservableObject
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    public required string Icon { get; init; }
    [ObservableProperty] public partial bool IsOn { get; set; }
}

/// <summary>Settings: profiles, language, accent colour, home screen blocks, catalog and debts pages, wipe (two-step), version.</summary>
public partial class SettingsViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action<ViewModelBase> _navigate;
    private readonly Func<CatalogKind, ViewModelBase> _catalog;
    private readonly Func<ViewModelBase> _debts;
    private readonly Action _languageChanged;
    private readonly Action _wiped;
    private readonly Func<string, string?> _getPref;
    private readonly Action<string, string> _setPref;

    public ObservableCollection<OptionVm> Languages { get; } = new();
    public ObservableCollection<ChoiceVm> Accents { get; } = new();
    /// <summary>Home screen blocks with a tick: shown / hidden.</summary>
    public ObservableCollection<ToggleVm> HomeBlocks { get; } = new();
    private Action _homeChanged = () => { };
    private Action _openProfiles = () => { };

    /// <summary>Hooks set by the shell after construction.</summary>
    public void Connect(Action homeChanged, Action openProfiles)
    {
        _homeChanged = homeChanged;
        _openProfiles = openProfiles;
    }
    [ObservableProperty] public partial bool WipeArmed { get; set; }

    public string Version => $"{L.T("version")} {Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0"}";

    public SettingsViewModel(LocalStore store, Action<ViewModelBase> navigate, Func<CatalogKind, ViewModelBase> catalog,
        Func<ViewModelBase> debts, Action languageChanged, Action wiped,
        Func<string, string?>? getPref = null, Action<string, string>? setPref = null)
    {
        // app-wide preferences (language, accent) live in the profile index; tests may keep them in the book
        _getPref = getPref ?? store.GetSetting;
        _setPref = setPref ?? store.SetSetting;
        _store = store;
        _navigate = navigate;
        _catalog = catalog;
        _debts = debts;
        _languageChanged = languageChanged;
        _wiped = wiped;

        foreach (var (lang, title) in new[] { (Lang.Uz, "O‘zbekcha"), (Lang.Ru, "Русский"), (Lang.En, "English") })
            Languages.Add(new OptionVm { Key = lang.ToString(), Title = title, IsSelected = L.Current == lang });

        foreach (var key in HomeViewModel.Blocks)
            HomeBlocks.Add(new ToggleVm { Key = key, Title = L.T("show_" + key), Icon = BlockIcon(key), IsOn = _getPref("home_" + key) != "0" });

        var accent = _getPref("accent") ?? Appearance.DefaultAccent;
        var i = 0;
        foreach (var hex in Appearance.Accents)
            Accents.Add(new ChoiceVm { Id = i++, Name = hex, Icon = "check", Color = hex, IsSelected = string.Equals(hex, accent, StringComparison.OrdinalIgnoreCase) });
    }

    [RelayCommand]
    private void SelectLanguage(OptionVm o)
    {
        if (o.IsSelected) return;
        foreach (var x in Languages) x.IsSelected = x == o;
        L.Current = Enum.Parse<Lang>(o.Key);
        _setPref("lang", o.Key);
        _languageChanged();
    }

    [RelayCommand]
    private void SelectAccent(ChoiceVm c)
    {
        foreach (var x in Accents) x.IsSelected = x == c;
        _setPref("accent", c.Color);
        Appearance.ApplyAccent(c.Color);
    }

    private static string BlockIcon(string key) => key switch
    {
        "balance" => "eye", "sources" => "salary", "wallets" => "wallet", "categories" => "food", _ => "handshake",
    };

    [RelayCommand]
    private void ToggleBlock(ToggleVm t)
    {
        t.IsOn = !t.IsOn;
        _setPref("home_" + t.Key, t.IsOn ? "1" : "0");
        _homeChanged();
    }

    [RelayCommand] private void OpenProfiles() => _openProfiles();

    [RelayCommand] private void OpenWallets() => _navigate(_catalog(CatalogKind.Wallets));
    [RelayCommand] private void OpenCategories() => _navigate(_catalog(CatalogKind.Categories));
    [RelayCommand] private void OpenSources() => _navigate(_catalog(CatalogKind.Sources));
    [RelayCommand] private void OpenDebts() => _navigate(_debts());

    [RelayCommand] private void ArmWipe() => WipeArmed = !WipeArmed;

    [RelayCommand]
    private void Wipe()
    {
        _store.Wipe();
        WipeArmed = false;
        _wiped();
    }
}
