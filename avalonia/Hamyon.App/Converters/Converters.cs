using System;
using System.Globalization;
using Avalonia;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace Hamyon.App.Converters;

/// <summary>"#1FCB8B" -> the round badge fill: a light-to-deep diagonal gradient of that colour.</summary>
public sealed class BadgeBrushConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string hex || !Color.TryParse(hex, out var c)) return Brushes.Gray;
        return new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0.15, 0, RelativeUnit.Relative),
            EndPoint = new RelativePoint(0.85, 1, RelativeUnit.Relative),
            GradientStops = { new GradientStop(Mix(c, Colors.White, 0.28), 0), new GradientStop(c, 0.55), new GradientStop(Mix(c, Colors.Black, 0.22), 1) },
        };
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();

    private static Color Mix(Color a, Color b, double t) =>
        Color.FromRgb((byte)(a.R + (b.R - a.R) * t), (byte)(a.G + (b.G - a.G) * t), (byte)(a.B + (b.B - a.B) * t));
}

/// <summary>"#1FCB8B" -> a soft glow shadow of that colour under the badge.</summary>
public sealed class GlowConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string hex && Color.TryParse(hex, out var c)
            ? new BoxShadows(new BoxShadow { OffsetY = 6, Blur = 18, Color = Color.FromArgb(0x66, c.R, c.G, c.B) })
            : default(BoxShadows);

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
