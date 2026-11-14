using System;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Hamyon.App.Services;

namespace Hamyon.App.Controls;

/// <summary>
/// {c:Tint '#4D8DFF'}: a badge fill written as a literal colour — that colour normally, frosted glass in Super Glass mode.
/// </summary>
public sealed class TintExtension(string color) : MarkupExtension
{
    public override object ProvideValue(IServiceProvider serviceProvider) =>
        Color.TryParse(color, out var c) ? Appearance.BadgeFill(c, gradient: false) : Brushes.Gray;
}

/// <summary>{c:Ink '#5A4A4E'}: an icon colour on a light badge — that colour normally, white on glass.</summary>
public sealed class InkExtension(string color) : MarkupExtension
{
    public override object ProvideValue(IServiceProvider serviceProvider) =>
        Appearance.Glass ? Brushes.White : Color.TryParse(color, out var c) ? new SolidColorBrush(c) : Brushes.White;
}
