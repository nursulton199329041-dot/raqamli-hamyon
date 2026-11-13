using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace Hamyon.App.Services;

/// <summary>Face ID / Touch ID / fingerprint, supplied by the platform head (iOS: LocalAuthentication, Android: BiometricPrompt).</summary>
public interface IBiometrics
{
    bool IsAvailable { get; }
    /// <summary>"Face ID", "Touch ID", "Barmoq izi"…</summary>
    string Name { get; }
    Task<bool> AuthenticateAsync(string reason);
}

/// <summary>
/// App lock: a 4-digit PIN (stored only as a salted SHA-256 hash in the app preferences) and, optionally, biometrics.
/// The PIN is always the fallback, so a failed or missing biometric sensor never locks the user out.
/// </summary>
public static class Security
{
    public const int PinLength = 4;

    /// <summary>Set by the platform head at start-up; null where the device has none (desktop, old phones).</summary>
    public static IBiometrics? Biometrics { get; set; }

    public static bool HasPin(Func<string, string?> pref) => !string.IsNullOrEmpty(pref("pin_hash"));

    public static void SetPin(Action<string, string> setPref, string pin)
    {
        var salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        setPref("pin_salt", salt);
        setPref("pin_hash", Hash(salt, pin));
    }

    public static void ClearPin(Action<string, string> setPref)
    {
        setPref("pin_hash", "");
        setPref("pin_salt", "");
        setPref("biometric", "0");
    }

    public static bool Check(Func<string, string?> pref, string pin)
    {
        var salt = pref("pin_salt");
        var hash = pref("pin_hash");
        if (string.IsNullOrEmpty(salt) || string.IsNullOrEmpty(hash)) return true;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(salt, pin)), Encoding.ASCII.GetBytes(hash));
    }

    public static bool BiometricOn(Func<string, string?> pref) => pref("biometric") == "1" && Biometrics?.IsAvailable == true;

    private static string Hash(string salt, string pin) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(salt + ":" + pin)));
}
