using System.Threading.Tasks;
using Hamyon.App.Services;
using LocalAuthentication;

namespace Hamyon.App.iOS;

/// <summary>Face ID / Touch ID through LocalAuthentication (needs NSFaceIDUsageDescription in Info.plist).</summary>
public sealed class IosBiometrics : IBiometrics
{
    private const LAPolicy Policy = LAPolicy.DeviceOwnerAuthenticationWithBiometrics;

    public bool IsAvailable
    {
        get
        {
            using var context = new LAContext();
            return context.CanEvaluatePolicy(Policy, out _);
        }
    }

    public string Name
    {
        get
        {
            using var context = new LAContext();
            context.CanEvaluatePolicy(Policy, out _);
            return context.BiometryType == LABiometryType.FaceId ? "Face ID" : "Touch ID";
        }
    }

    public async Task<bool> AuthenticateAsync(string reason)
    {
        using var context = new LAContext();
        try
        {
            var result = await context.EvaluatePolicyAsync(Policy, reason);
            return result.Item1;
        }
        catch (Foundation.NSErrorException)
        {
            return false; // cancelled / not enrolled: the PIN pad stays
        }
    }
}
