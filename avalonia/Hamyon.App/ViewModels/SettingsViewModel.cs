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

/// <summary>Settings: language, accent colour, catalog and debts pages, wipe (two-step), version.</summary>
public partial class SettingsViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action<ViewModelBase> _navigate;
    private readonly Func<CatalogKind, ViewModelBase> _catalog;
    private readonly Func<ViewModelBase> _debts;
    private readonly Action _languageChanged;
    private readonly Action _wiped;

    public ObservableCollection<OptionVm> Languages { get; } = new();
    public ObservableCollection<ChoiceVm> Accents { get; } = new();
    [ObservableProperty] public partial bool WipeArmed { get; set; }

    public string Version => $"{L.T("version")} {Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0"}";

    public SettingsViewModel(LocalStore store, Action<ViewModelBase> navigate, Func<CatalogKind, ViewModelBase> catalog,
        Func<ViewModelBase> debts, Action languageChanged, Action wiped)
    {
        _store = store;
        _navigate = navigate;
        _catalog = catalog;
        _debts = debts;
        _languageChanged = languageChanged;
        _wiped = wiped;

        foreach (var (lang, title) in new[] { (Lang.Uz, "O‘zbekcha"), (Lang.Ru, "Русский"), (Lang.En, "English") })
            Languages.Add(new OptionVm { Key = lang.ToString(), Title = title, IsSelected = L.Current == lang });

        var accent = store.GetSetting("accent") ?? Appearance.DefaultAccent;
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
        _store.SetSetting("lang", o.Key);
        _languageChanged();
    }

    [RelayCommand]
    private void SelectAccent(ChoiceVm c)
    {
        foreach (var x in Accents) x.IsSelected = x == c;
        _store.SetSetting("accent", c.Color);
        Appearance.ApplyAccent(c.Color);
    }

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
