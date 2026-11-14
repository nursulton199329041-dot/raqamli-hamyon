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
    private readonly ProfileStore? _profiles;
    private readonly Account? _account;
    private readonly SyncEngine? _sync;
    private System.Threading.CancellationTokenSource? _debounce;
    private bool _syncing, _again, _applyingRemote;
    private AccountViewModel? _accountSheet;

    /// <summary>"Synced: 14:05" / "Syncing…" / "Offline" — shown under the account row.</summary>
    [ObservableProperty] public partial string SyncStatus { get; set; } = "";

    public HomeViewModel Home { get; }
    public HistoryViewModel History { get; }
    public ReportsViewModel Reports { get; }
    public SettingsViewModel Settings { get; }
    public ObservableCollection<TabVm> Tabs { get; }

    [ObservableProperty] public partial ViewModelBase Current { get; set; }

    /// <summary>Bottom sheet over everything (operation, catalog editor); null = closed.</summary>
    [ObservableProperty] public partial ViewModelBase? Sheet { get; set; }

    /// <summary>PIN pad over everything (app lock, or setting / removing the PIN); null = unlocked.</summary>
    [ObservableProperty] public partial LockViewModel? Lock { get; set; }

    /// <summary>Raised after a language change: the view tree is rebuilt so every {l:T} string is read again.</summary>
    public event Action? LanguageChanged;

    /// <summary>Raised after switching profile: the root view starts a fresh shell on the chosen book.</summary>
    public event Action? ProfileSwitched;

    public ProfileStore? Profiles => _profiles;

    public MainViewModel() : this(new ProfileStore()) { }

    public MainViewModel(ProfileStore profiles) : this(profiles.OpenCurrent(), profiles) { }

    public MainViewModel(LocalStore store, ProfileStore? profiles = null)
    {
        _store = store;
        _profiles = profiles;
        if (Enum.TryParse<Lang>(GetPref("lang"), out var lang)) L.Current = lang;
        Appearance.ApplyAccent(GetPref("accent"));

        Home = new HomeViewModel(store);
        History = new HistoryViewModel(store, changed: RefreshAll);
        Reports = new ReportsViewModel(store);
        Settings = new SettingsViewModel(store,
            navigate: vm => Current = vm,
            catalog: kind => new CatalogViewModel(store, kind, back: () => Current = Settings, sheet: s => Sheet = s, changed: RefreshAll),
            debts: NewDebts,
            languageChanged: () => { RefreshAll(); LanguageChanged?.Invoke(); },
            wiped: RefreshAll,
            getPref: GetPref, setPref: SetPref);

        Home.OpenOperation += (kind, from, to) =>
            Sheet = new OperationViewModel(store, kind, from, to, onSaved: () => { Sheet = null; RefreshAll(); }, onClose: () => Sheet = null);
        Home.OpenDebts += () => Current = NewDebts();
        Home.OpenProfiles += OpenProfiles;
        Home.ApplyBlocks(GetPref);
        Settings.Connect(homeChanged: () => Home.ApplyBlocks(GetPref), openProfiles: OpenProfiles,
            setLock: l => Lock = l, openExport: () => Sheet = new ExportViewModel(store, close: () => Sheet = null));
        Relock();
        Home.OpenItem += tile => Current = new ItemViewModel(store, tile.Kind, tile.Id, back: () => { Home.Refresh(); Current = Home; }, sheet: s => Sheet = s, changed: RefreshAll);
        if (profiles is not null) { var p = profiles.Current; Home.SetProfile(p.Name, p.Color); }

        // period sheet: the home date chip and the filter buttons of History / Reports (each keeps its own period)
        Home.OpenPeriod += () => Sheet = new PeriodPickerViewModel(Home.Period, p => Home.Period = p, close: () => Sheet = null);
        History.OpenPeriod += () => Sheet = new PeriodPickerViewModel(History.Period, p => History.Period = p, close: () => Sheet = null);
        Reports.OpenPeriod += () => Sheet = new PeriodPickerViewModel(Reports.Period, p => Reports.Period = p, close: () => Sheet = null);

        // "+" tiles, "⋯" menu
        Home.AddItem += kind => Sheet = new EditorViewModel(store, kind, null, done: () => { Sheet = null; RefreshAll(); }, close: () => Sheet = null);
        Home.OpenBudgets += () => Sheet = new BudgetViewModel(store, saved: RefreshAll, close: () => Sheet = null);
        Home.Arranged += RefreshAll;
        Home.TourFinished += () => SetPref("tour_done", "1");
        // the guide runs once on a new install (it stays in the "⋯" menu)
        if (profiles is not null && string.IsNullOrEmpty(GetPref("tour_done"))) Home.StartTour();

        // account + sync (the real app; unit tests without a profile index never touch the network)
        if (profiles is not null)
        {
            _account = new Account(GetPref, SetPref);
            _sync = new SyncEngine(_account, profiles);
            _account.SignedOut += UpdateAccountRow;
            Settings.ConnectAccount(OpenAccount);
            UpdateAccountRow();
            if (_account.SignedIn) SyncNow();
        }

        Tabs =
        [
            new TabVm { Key = "home", Icon = "wallet", IsActive = true },
            new TabVm { Key = "history", Icon = "history" },
            new TabVm { Key = "reports", Icon = "chart" },
            new TabVm { Key = "settings", Icon = "settings" },
        ];
        Current = Home;
    }

    /// <summary>Shows the PIN pad when a PIN is set (start-up, return from background); Face ID is offered at once.</summary>
    public void Relock()
    {
        if (Lock is not null || !Security.HasPin(GetPref)) return;
        Lock = new LockViewModel(LockMode.Unlock, GetPref, SetPref, done: () => Lock = null);
        Lock.Biometric();
    }

    private string? GetPref(string key) => _profiles is not null ? _profiles.GetPref(key) : _store.GetSetting(key);

    private void SetPref(string key, string value)
    {
        if (_profiles is not null) _profiles.SetPref(key, value);
        else _store.SetSetting(key, value);
    }

    private void OpenProfiles()
    {
        if (_profiles is null) return;
        Sheet = new ProfilesViewModel(_profiles, switchTo: id => { _profiles.CurrentId = id; Sheet = null; ProfileSwitched?.Invoke(); }, close: () => Sheet = null);
    }

    private DebtsViewModel NewDebts() =>
        new(_store, back: () => Current = Settings, sheet: s => Sheet = s, changed: RefreshAll);

    private void RefreshAll()
    {
        Home.Refresh();
        History.Refresh();
        Reports.Refresh();
        if (!_applyingRemote) ScheduleSync(); // a change here goes up a few seconds later (several edits = one sync)
    }

    // ---- sync ----

    private void ScheduleSync()
    {
        if (_sync is null || _account?.SignedIn != true) return;
        _debounce?.Cancel();
        _debounce = new System.Threading.CancellationTokenSource();
        _ = SyncSoonAsync(_debounce.Token);
    }

    private async System.Threading.Tasks.Task SyncSoonAsync(System.Threading.CancellationToken ct)
    {
        try { await System.Threading.Tasks.Task.Delay(3000, ct); }
        catch (System.Threading.Tasks.TaskCanceledException) { return; }
        SyncNow();
    }

    /// <summary>Two-way sync of every profile now (start-up, return to the app, after edits, "sync now").</summary>
    public async void SyncNow()
    {
        if (_sync is null || _account?.SignedIn != true) return;
        if (_syncing) { _again = true; return; }
        _syncing = true;
        SyncStatus = L.T("sync_running");
        UpdateAccountRow();
        _accountSheet?.UpdateStatus();
        try
        {
            var r = await _sync.SyncAllAsync();
            SyncStatus = L.T("sync_done", DateTime.Now.ToString("HH:mm"));
            if (r.Pulled > 0 || r.NewProfiles > 0)
            {
                _applyingRemote = true;
                try { RefreshAll(); } finally { _applyingRemote = false; }
            }
        }
        catch (ApiException e) when (e.Code == "auth.signed_out")
        {
            SyncStatus = L.T("sync_signed_out");
        }
        catch (Exception)
        {
            SyncStatus = L.T("sync_offline"); // no network / server down: the changes wait on the phone
        }
        finally
        {
            _syncing = false;
            UpdateAccountRow();
            _accountSheet?.UpdateStatus();
            if (_again) { _again = false; SyncNow(); }
        }
    }

    private string SyncStatusText() =>
        !string.IsNullOrEmpty(SyncStatus) ? SyncStatus
        : DateTimeOffset.TryParse(GetPref("sync_last"), out var t) ? L.T("sync_done", t.ToLocalTime().ToString("dd.MM HH:mm"))
        : "";

    private void UpdateAccountRow()
    {
        if (_account is null) return;
        Settings.AccountTitle = _account.SignedIn ? _account.Email ?? L.T("acct_row") : L.T("acct_row");
        Settings.AccountHint = _account.SignedIn ? SyncStatusText() : L.T("acct_row_hint");
    }

    private void OpenAccount()
    {
        if (_account is null || _sync is null) return;
        Sheet = _accountSheet = new AccountViewModel(_account,
            signedIn: () =>
            {
                _sync.ResetForNewSession(); // this phone's data goes up to the account once
                UpdateAccountRow();
                SyncNow();
                return System.Threading.Tasks.Task.CompletedTask;
            },
            syncNow: SyncNow, status: SyncStatusText,
            close: () => { Sheet = null; _accountSheet = null; });
    }

    [RelayCommand] private void CloseSheet() => Sheet = null;

    /// <summary>
    /// Phone "back": closes the sheet, then leaves a settings sub-page, then returns to Home.
    /// Returns false on Home with nothing open, so the system can leave the app.
    /// </summary>
    public bool HandleBack()
    {
        if (Lock is not null)
        {
            if (Lock.CanCancel) { Lock = null; return true; }
            return false; // locked: back leaves the app, it never skips the PIN
        }
        if (Sheet is not null) { Sheet = null; return true; }
        if (Current is ItemViewModel item)
        {
            if (item.FilterOpen) item.CloseFilterCommand.Execute(null);
            else if (item.MenuOpen) item.MenuOpen = false;
            else { Home.Refresh(); Current = Home; }
            return true;
        }
        if (Current is CatalogViewModel or DebtsViewModel) { Current = Settings; return true; }
        if (Current != Home) { SelectTab(Tabs[0]); return true; }
        if (Home.MenuOpen) { Home.MenuOpen = false; return true; }
        if (Home.TourOn) { Home.TourSkipCommand.Execute(null); return true; }
        if (Home.EditMode) { Home.EditMode = false; return true; }
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
