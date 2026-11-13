using System.Threading.Tasks;
using AndroidX.Biometric;
using AndroidX.Core.Content;
using AndroidX.Fragment.App;
using Hamyon.App.Localization;
using Hamyon.App.Services;

namespace Hamyon.App.Android;

/// <summary>Fingerprint / face unlock through AndroidX BiometricPrompt (system UI; nothing biometric reaches the app).</summary>
public sealed class AndroidBiometrics(FragmentActivity activity) : IBiometrics
{
    private const int Allowed = BiometricManager.Authenticators.BiometricWeak;

    public bool IsAvailable => BiometricManager.From(activity).CanAuthenticate(Allowed) == BiometricManager.BiometricSuccess;

    public string Name => L.T("bio_android");

    public Task<bool> AuthenticateAsync(string reason)
    {
        var result = new TaskCompletionSource<bool>();
        activity.RunOnUiThread(() =>
        {
            var prompt = new BiometricPrompt(activity, ContextCompat.GetMainExecutor(activity), new Callback(result));
            var info = new BiometricPrompt.PromptInfo.Builder()
                .SetTitle(reason)
                .SetNegativeButtonText(L.T("cancel"))
                .SetAllowedAuthenticators(Allowed)
                .Build();
            prompt.Authenticate(info);
        });
        return result.Task;
    }

    private sealed class Callback(TaskCompletionSource<bool> result) : BiometricPrompt.AuthenticationCallback
    {
        public override void OnAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) => result.TrySetResult(true);

        // cancelled, too many attempts, no sensor…: the PIN pad stays
        public override void OnAuthenticationError(int errorCode, Java.Lang.ICharSequence errString) => result.TrySetResult(false);

        // a single wrong finger: the system prompt stays open for another try
    }
}
