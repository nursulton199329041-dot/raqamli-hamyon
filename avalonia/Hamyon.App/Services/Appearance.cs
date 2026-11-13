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
    }

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
