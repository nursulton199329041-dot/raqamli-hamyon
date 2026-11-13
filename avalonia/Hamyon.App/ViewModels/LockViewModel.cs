using System;
using System.Collections.Generic;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Localization;
using Hamyon.App.Services;

namespace Hamyon.App.ViewModels;

/// <summary>One PIN pad key: a digit, or an icon (biometric, backspace), or an empty slot.</summary>
public sealed record PinKey(string Key, string? Text, string? Icon)
{
    public bool IsVisible => Key.Length > 0;
    public bool HasIcon => Icon is not null;
}

public enum LockMode
{
    /// <summary>app start / return from background</summary>
    Unlock,
    /// <summary>Settings → Password on: type a new PIN twice</summary>
    Create,
    /// <summary>Settings → Password off: confirm with the current PIN</summary>
    Disable,
}

/// <summary>PIN pad over the whole app. Unlock also offers Face ID / fingerprint when switched on.</summary>
public partial class LockViewModel : ViewModelBase
{
    private readonly Func<string, string?> _pref;
    private readonly Action<string, string> _setPref;
    private readonly Action _done;
    private readonly Action? _cancel;
    private string _entered = "";
    private string? _first;

    public LockMode Mode { get; }
    /// <summary>digits, then [biometric] 0 [backspace]</summary>
    public IEnumerable<PinKey> Keys =>
        new[] { "1", "2", "3", "4", "5", "6", "7", "8", "9" }.Select(d => new PinKey(d, d, null))
            .Append(ShowBiometric ? new PinKey("bio", null, BiometricIcon) : new PinKey("", null, null))
            .Append(new PinKey("0", "0", null))
            .Append(new PinKey("⌫", null, "backspace"));

    [ObservableProperty] public partial string Title { get; set; } = "";
    [ObservableProperty] public partial string? Error { get; set; }
    [ObservableProperty] public partial int Count { get; set; }

    public bool Dot1 => Count >= 1;
    public bool Dot2 => Count >= 2;
    public bool Dot3 => Count >= 3;
    public bool Dot4 => Count >= 4;
    public bool CanCancel => Mode != LockMode.Unlock;
    public bool ShowBiometric => Mode == LockMode.Unlock && Security.BiometricOn(_pref);
    public string BiometricIcon => Security.Biometrics?.Name.Contains("Face", StringComparison.OrdinalIgnoreCase) == true ? "faceid" : "fingerprint";

    public LockViewModel(LockMode mode, Func<string, string?> pref, Action<string, string> setPref, Action done, Action? cancel = null)
    {
        Mode = mode;
        _pref = pref;
        _setPref = setPref;
        _done = done;
        _cancel = cancel;
        Title = L.T(mode == LockMode.Create ? "pin_new" : "pin_enter");
    }

    partial void OnCountChanged(int value)
    {
        OnPropertyChanged(nameof(Dot1));
        OnPropertyChanged(nameof(Dot2));
        OnPropertyChanged(nameof(Dot3));
        OnPropertyChanged(nameof(Dot4));
    }

    [RelayCommand]
    private void Press(string key)
    {
        switch (key)
        {
            case "": return;
            case "bio": Biometric(); return;
            case "⌫":
                if (_entered.Length > 0) _entered = _entered[..^1];
                break;
            default:
                if (_entered.Length >= Security.PinLength) return;
                _entered += key;
                Error = null;
                break;
        }
        Count = _entered.Length;
        if (_entered.Length == Security.PinLength) Submit();
    }

    [RelayCommand] private void Cancel() => _cancel?.Invoke();

    private void Submit()
    {
        var pin = _entered;
        _entered = "";
        Count = 0;
        switch (Mode)
        {
            case LockMode.Create when _first is null:
                _first = pin;
                Title = L.T("pin_repeat");
                return;
            case LockMode.Create when _first == pin:
                Security.SetPin(_setPref, pin);
                _done();
                return;
            case LockMode.Create:
                _first = null;
                Title = L.T("pin_new");
                Error = L.T("pin_mismatch");
                return;
            default:
                if (Security.Check(_pref, pin)) { _done(); return; }
                Error = L.T("pin_wrong");
                return;
        }
    }

    /// <summary>Face ID / fingerprint; on failure the PIN pad stays.</summary>
    [RelayCommand]
    public async void Biometric()
    {
        if (!ShowBiometric || Security.Biometrics is not { } bio) return;
        if (await bio.AuthenticateAsync(L.T("pin_bio_reason"))) _done();
    }
}
