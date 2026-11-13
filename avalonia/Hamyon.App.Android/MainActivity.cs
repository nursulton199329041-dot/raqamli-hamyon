using Android.App;
using Android.Content.PM;
using Android.OS;
using Avalonia.Android;
using Hamyon.App.Services;

namespace Hamyon.App.Android;

[Activity(
    Label = "Raqamli Hamyon",
    Theme = "@style/MyTheme.NoActionBar",
    Icon = "@drawable/icon",
    MainLauncher = true,
    ScreenOrientation = ScreenOrientation.Portrait,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.UiMode)]
public class MainActivity : AvaloniaMainActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        // before the app builds its views: the lock screen asks whether biometrics exist
        Security.Biometrics = new AndroidBiometrics(this);
        base.OnCreate(savedInstanceState);
    }
}
