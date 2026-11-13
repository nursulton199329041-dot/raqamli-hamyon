using System;
using System.Net.Http;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Localization;
using Hamyon.App.Services;

namespace Hamyon.App.ViewModels;

/// <summary>
/// Settings → Account: sign in / sign up with email and password; when signed in, the sync state, "sync now" and
/// sign out. Signing out keeps everything on the phone (the data just stops syncing).
/// </summary>
public partial class AccountViewModel : ViewModelBase
{
    private readonly Account _account;
    private readonly Func<Task> _signedIn;
    private readonly Action _syncNow;
    private readonly Action _close;
    private readonly Func<string> _status;

    [ObservableProperty] public partial bool RegisterMode { get; set; }
    [ObservableProperty] public partial string? Email { get; set; }
    [ObservableProperty] public partial string? Password { get; set; }
    [ObservableProperty] public partial string? Name { get; set; }
    [ObservableProperty] public partial string? Error { get; set; }
    [ObservableProperty] public partial bool Busy { get; set; }
    [ObservableProperty] public partial bool SignedIn { get; set; }
    [ObservableProperty] public partial string Status { get; set; } = "";

    public string SubmitText => L.T(RegisterMode ? "acct_register" : "acct_signin");
    public string SwitchText => L.T(RegisterMode ? "acct_have_account" : "acct_no_account");
    public string? AccountEmail => _account.Email;

    public AccountViewModel(Account account, Func<Task> signedIn, Action syncNow, Func<string> status, Action close)
    {
        _account = account;
        _signedIn = signedIn;
        _syncNow = syncNow;
        _status = status;
        _close = close;
        SignedIn = account.SignedIn;
        Email = account.Email;
        Status = status();
    }

    partial void OnRegisterModeChanged(bool value)
    {
        Error = null;
        OnPropertyChanged(nameof(SubmitText));
        OnPropertyChanged(nameof(SwitchText));
    }

    [RelayCommand] private void Switch() => RegisterMode = !RegisterMode;
    [RelayCommand] private void Close() => _close();

    /// <summary>Refreshes the sync line while the sheet is open.</summary>
    public void UpdateStatus() => Status = _status();

    [RelayCommand]
    private async Task Submit()
    {
        var email = Email?.Trim() ?? "";
        if (!email.Contains('@') || email.Length < 5) { Error = L.T("acct_err_email"); return; }
        if (string.IsNullOrEmpty(Password) || (RegisterMode && Password.Length < 8)) { Error = L.T("acct_err_password"); return; }
        if (RegisterMode && string.IsNullOrWhiteSpace(Name)) { Error = L.T("err_name"); return; }

        Busy = true;
        Error = null;
        try
        {
            if (RegisterMode) await _account.RegisterAsync(email, Password, Name!, L.Current.ToString().ToLowerInvariant());
            else await _account.LoginAsync(email, Password);
            Password = null;
            SignedIn = true;
            OnPropertyChanged(nameof(AccountEmail));
            await _signedIn();
            Status = _status();
        }
        catch (ApiException e)
        {
            Error = Message(e);
        }
        catch (HttpRequestException)
        {
            Error = L.T("acct_err_offline");
        }
        catch (TaskCanceledException)
        {
            Error = L.T("acct_err_offline");
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand] private void SyncNow() { _syncNow(); Status = _status(); }

    [RelayCommand]
    private async Task SignOut()
    {
        await _account.LogoutAsync();
        SignedIn = false;
        Status = _status();
    }

    public static string Message(ApiException e) => e.Code switch
    {
        "auth.invalid_credentials" => L.T("acct_err_invalid"),
        "auth.email_taken" => L.T("acct_err_taken"),
        "auth.locked" => L.T("acct_err_locked"),
        "validation" => L.T("acct_err_password"),
        _ => string.IsNullOrWhiteSpace(e.Message) ? L.T("acct_err_server") : e.Message,
    };
}
