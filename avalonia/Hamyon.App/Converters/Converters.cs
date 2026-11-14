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
        return Hamyon.App.Services.Appearance.BadgeFill(c, gradient: true); // frosted glass in Super Glass mode
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();

}

/// <summary>"#1FCB8B" -> solid brush of that colour.</summary>
public sealed class HexBrushConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string hex && Color.TryParse(hex, out var c) ? new SolidColorBrush(c) : Brushes.Gray;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>A solid fill brush -> readable ink on it (dark on light accents, white on deep ones).</summary>
public sealed class InkOnConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is ISolidColorBrush b ? new SolidColorBrush(Hamyon.App.Services.Appearance.OnAccent(b.Color)) : Brushes.White;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>"#F2C14E" -> readable ink on that colour.</summary>
public sealed class InkOnHexConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string hex && Color.TryParse(hex, out var c) ? new SolidColorBrush(Hamyon.App.Services.Appearance.OnAccent(c)) : Brushes.White;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>0..1 share -> bar width in pixels of a 100% bar given as the parameter.</summary>
public sealed class ShareWidthConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is double share && double.TryParse(parameter as string, NumberStyles.Float, CultureInfo.InvariantCulture, out var full)
            ? Math.Max(4, share * full)
            : 4d;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>"#1FCB8B" -> a soft glow shadow of that colour under the badge.</summary>
public sealed class GlowConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string hex && Color.TryParse(hex, out var c)
            ? Hamyon.App.Services.Appearance.BadgeShadow(c)
            : default(BoxShadows);

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>Profile avatar fill: its solid colour, or (Super Glass) clear glass so only the initial shows.</summary>
public sealed class AvatarBrushConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string hex && Color.TryParse(hex, out var c) ? Hamyon.App.Services.Appearance.BadgeFill(c, gradient: false) : Brushes.Gray;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
