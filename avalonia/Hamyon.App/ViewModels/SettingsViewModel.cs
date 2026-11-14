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
    private Action<LockViewModel?> _lock = _ => { };
    private Action _openExport = () => { };

    /// <summary>Hooks set by the shell after construction.</summary>
    public void Connect(Action homeChanged, Action openProfiles, Action<LockViewModel?>? setLock = null, Action? openExport = null)
    {
        _homeChanged = homeChanged;
        _openProfiles = openProfiles;
        if (setLock is not null) _lock = setLock;
        if (openExport is not null) _openExport = openExport;
    }

    // ---- account (sync) ----

    [ObservableProperty] public partial string AccountTitle { get; set; } = "";
    [ObservableProperty] public partial string AccountHint { get; set; } = "";
    [ObservableProperty] public partial bool HasAccount { get; set; }
    private Action? _openAccount;
    public void ConnectAccount(Action open) { _openAccount = open; HasAccount = true; }
    [RelayCommand] private void OpenAccount() => _openAccount?.Invoke();

    // ---- rows that open / expand ----

    [ObservableProperty] public partial bool PanelOpen { get; set; }
    [ObservableProperty] public partial bool WipeOpen { get; set; }
    [ObservableProperty] public partial bool LanguageOpen { get; set; }
    [ObservableProperty] public partial bool ThemeOpen { get; set; }
    [RelayCommand] private void TogglePanel() => PanelOpen = !PanelOpen;
    [RelayCommand] private void ToggleWipe() { WipeOpen = !WipeOpen; WipeArmed = false; }
    [RelayCommand] private void ToggleLanguage() => LanguageOpen = !LanguageOpen;
    [RelayCommand] private void ToggleTheme() => ThemeOpen = !ThemeOpen;
    [RelayCommand] private void OpenExport() => _openExport();

    public string LanguageName => Languages.FirstOrDefault(l => l.IsSelected)?.Title ?? "";
    /// <summary>"Qarzlar" switch = the debts card on the home screen</summary>
    public ToggleVm DebtsBlock => HomeBlocks.First(b => b.Key == "debts");

    // ---- password / Face ID ----

    [ObservableProperty] public partial bool PinOn { get; set; }
    [ObservableProperty] public partial bool BiometricOn { get; set; }
    public bool BiometricAvailable => Security.Biometrics?.IsAvailable == true;
    public string BiometricName => Security.Biometrics?.Name ?? "Face ID";

    /// <summary>On: type a new PIN twice. Off: confirm with the current PIN first.</summary>
    [RelayCommand]
    private void TogglePin()
    {
        if (!PinOn)
            _lock(new LockViewModel(LockMode.Create, _getPref, _setPref,
                done: () => { PinOn = true; _lock(null); }, cancel: () => _lock(null)));
        else
            _lock(new LockViewModel(LockMode.Disable, _getPref, _setPref,
                done: () => { Security.ClearPin(_setPref); PinOn = false; BiometricOn = false; _lock(null); }, cancel: () => _lock(null)));
    }

    /// <summary>Face ID / fingerprint needs a PIN behind it; turning it on asks the sensor once.</summary>
    [RelayCommand]
    private async System.Threading.Tasks.Task ToggleBiometric()
    {
        if (BiometricOn) { _setPref("biometric", "0"); BiometricOn = false; return; }
        if (!PinOn) { TogglePin(); return; }
        if (Security.Biometrics is { IsAvailable: true } bio && await bio.AuthenticateAsync(L.T("pin_bio_reason")))
        {
            _setPref("biometric", "1");
            BiometricOn = true;
        }
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

        PinOn = Security.HasPin(_getPref);
        BiometricOn = PinOn && _getPref("biometric") == "1";

        var accent = _getPref("accent") ?? Appearance.DefaultAccent;
        var i = 0;
        foreach (var hex in Appearance.Accents)
            Accents.Add(new ChoiceVm { Id = i++, Name = hex, Icon = "check", Color = hex, IsSelected = string.Equals(hex, accent, StringComparison.OrdinalIgnoreCase) });
        _glassOn = _getPref("glass") == "1";
    }

    // ---- Super Glass (iOS-style frosted badges, cards and sheets) ----

    [RelayCommand] private void ToggleGlass() => GlassOn = !GlassOn;

    private bool _glassOn;

    /// <summary>Switching rebuilds the screens so every badge, card and sheet takes the new look at once.</summary>
    public bool GlassOn
    {
        get => _glassOn;
        set
        {
            if (_glassOn == value) return;
            _glassOn = value;
            OnPropertyChanged();
            _setPref("glass", value ? "1" : "0");
            Appearance.ApplyGlass(value);
            _languageChanged();
        }
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
        WipeOpen = false;
        _wiped();
    }

    /// <summary>Keeps wallets, categories and sources; removes every operation (balances go back to the opening ones).</summary>
    [RelayCommand]
    private void WipeOperations()
    {
        _store.WipeOperations();
        WipeOpen = false;
        _wiped();
    }
}
