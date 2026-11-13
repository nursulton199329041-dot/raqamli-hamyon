using Android.App;
using Android.Content.PM;
using Avalonia;
using Avalonia.Android;

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
}
