using System;
using Avalonia;
using Avalonia.Media;

namespace Hamyon.App.Services;

/// <summary>Runtime accent colour: views use {DynamicResource AccentBrush / OnAccentBrush / AccentSoftBrush}.</summary>
public static class Appearance
{
    /// <summary>Gold (default) first, then jewel and metal tones that sit well on the garnet background.</summary>
    public static readonly string[] Accents =
        ["#F2C14E", "#E9D3A1", "#E8A598", "#D9844A", "#C9CED6", "#E0475B", "#EC4899", "#9B7BFF", "#4D8DFF", "#14B8A6", "#1FCB8B"];

    public const string DefaultAccent = "#F2C14E";

    public static void ApplyAccent(string? hex)
    {
        if (Application.Current is not { } app || !Color.TryParse(hex ?? DefaultAccent, out var c)) return;
        app.Resources["AccentBrush"] = new SolidColorBrush(c);
        app.Resources["OnAccentBrush"] = new SolidColorBrush(OnAccent(c));
        app.Resources["AccentSoftBrush"] = new SolidColorBrush(Color.FromArgb(0x33, c.R, c.G, c.B));
        _accent = c;
        ApplyAction(app);
    }

    private static Color _accent = Color.Parse(DefaultAccent);

    /// <summary>
    /// Filled action buttons and selected segments: {DynamicResource ActionBrush / OnActionBrush}.
    /// The accent colour normally; clear glass with white text in Super Glass.
    /// </summary>
    private static void ApplyAction(Application app)
    {
        app.Resources["ActionBrush"] = Glass
            ? new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative), EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Color.Parse("#61FFFFFF"), 0), new GradientStop(Color.Parse("#2EFFFFFF"), 1) },
            }
            : new SolidColorBrush(_accent);
        app.Resources["OnActionBrush"] = new SolidColorBrush(Glass ? Colors.White : OnAccent(_accent));
        // selected chips / options: a soft accent tint, or lighter glass (their accent outline still marks the choice)
        app.Resources["AccentSoftBrush"] = new SolidColorBrush(Glass ? Color.Parse("#40FFFFFF") : Color.FromArgb(0x33, _accent.R, _accent.G, _accent.B));
    }

    // ---- "Super Glass": iOS-style frosted glass instead of solid coloured badges ----

    /// <summary>
    /// On: every coloured badge becomes frosted glass with the icon in its own colour (like the iOS control centre),
    /// cards and sheets turn to lighter glass and the background gets soft colour light behind the glass.
    /// Read when views are built (the shell is rebuilt when it changes).
    /// </summary>
    public static bool Glass { get; private set; }

    public static void ApplyGlass(bool on)
    {
        Glass = on;
        if (Application.Current is not { } app) return;
        var r = app.Resources;
        r["GlassBrush"] = new SolidColorBrush(Color.Parse(on ? "#21FFFFFF" : "#12FFECE4"));
        r["GlassStrongBrush"] = new SolidColorBrush(Color.Parse(on ? "#33FFFFFF" : "#21FFECE4"));
        r["GlassBorderBrush"] = on
            ? new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative), EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Color.Parse("#66FFFFFF"), 0), new GradientStop(Color.Parse("#1AFFFFFF"), 1) },
            }
            : new SolidColorBrush(Color.Parse("#1AFFECE4"));
        r["SheetBrush"] = new SolidColorBrush(Color.Parse(on ? "#EB2A1A1F" : "#F7140709"));
        r["MenuBrush"] = new SolidColorBrush(Color.Parse(on ? "#E0302026" : "#F2211015"));
        ApplyAction(app);
    }

    /// <summary>Badge fill: the solid colour, or (Super Glass) neutral frosted glass like the iOS control centre buttons.</summary>
    public static IBrush BadgeFill(Color c, bool gradient) => Glass
        ? new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0.2, 0, RelativeUnit.Relative), EndPoint = new RelativePoint(0.8, 1, RelativeUnit.Relative),
            GradientStops =
            {
                new GradientStop(Color.Parse("#6BD9D4D6"), 0),
                new GradientStop(Color.Parse("#4D9C9598"), 0.55),
                new GradientStop(Color.Parse("#408A8386"), 1),
            },
        }
        : gradient
            ? new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0.15, 0, RelativeUnit.Relative), EndPoint = new RelativePoint(0.85, 1, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Mix(c, Colors.White, 0.28), 0), new GradientStop(c, 0.55), new GradientStop(Mix(c, Colors.Black, 0.22), 1) },
            }
            : new SolidColorBrush(c);


    /// <summary>Badge shadow: a coloured glow, or (glass) a bright top edge plus a soft drop shadow.</summary>
    public static BoxShadows BadgeShadow(Color c) => Glass
        ? new BoxShadows(
            new BoxShadow { IsInset = true, OffsetY = 1.2, Blur = 0, Color = Color.Parse("#8CFFFFFF") },
            [new BoxShadow { OffsetY = 8, Blur = 20, Color = Color.Parse("#52000000") }])
        : new BoxShadows(new BoxShadow { OffsetY = 6, Blur = 18, Color = Color.FromArgb(0x66, c.R, c.G, c.B) });

    private static Color Mix(Color a, Color b, double t) =>
        Color.FromRgb((byte)(a.R + (b.R - a.R) * t), (byte)(a.G + (b.G - a.G) * t), (byte)(a.B + (b.B - a.B) * t));


    /// <summary>Dark ink on light accents (gold, champagne, silver), white on deep ones — WCAG relative luminance.</summary>
    public static Color OnAccent(Color c)
    {
        static double Ch(byte v)
        {
            var x = v / 255.0;
            return x <= 0.03928 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4);
        }
        var lum = 0.2126 * Ch(c.R) + 0.7152 * Ch(c.G) + 0.0722 * Ch(c.B);
        return lum > 0.36 ? Color.Parse("#1A0B0D") : Colors.White;
    }
}
