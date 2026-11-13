using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Hamyon.App.Controls;

/// <summary>
/// Outline icon on a 24x24 grid, drawn with a round-capped stroke (same set as the React Native app's Icon.tsx).
/// Scales to its size, so one geometry serves every icon size.
/// </summary>
public sealed class Glyph : Control
{
    public static readonly StyledProperty<string?> KindProperty = AvaloniaProperty.Register<Glyph, string?>(nameof(Kind));
    public static readonly StyledProperty<IBrush?> ForegroundProperty = AvaloniaProperty.Register<Glyph, IBrush?>(nameof(Foreground), Brushes.White);
    public static readonly StyledProperty<double> ThicknessProperty = AvaloniaProperty.Register<Glyph, double>(nameof(Thickness), 1.8);

    static Glyph() => AffectsRender<Glyph>(KindProperty, ForegroundProperty, ThicknessProperty);

    public string? Kind { get => GetValue(KindProperty); set => SetValue(KindProperty, value); }
    public IBrush? Foreground { get => GetValue(ForegroundProperty); set => SetValue(ForegroundProperty, value); }
    public double Thickness { get => GetValue(ThicknessProperty); set => SetValue(ThicknessProperty, value); }

    protected override Size MeasureOverride(Size availableSize) => new(24, 24);

    public override void Render(DrawingContext context)
    {
        if (Foreground is null || Glyphs.Get(Kind) is not { } geometry) return;
        var s = Math.Min(Bounds.Width, Bounds.Height) / 24;
        var dx = (Bounds.Width - 24 * s) / 2;
        var dy = (Bounds.Height - 24 * s) / 2;
        using (context.PushTransform(Matrix.CreateScale(s, s) * Matrix.CreateTranslation(dx, dy)))
            context.DrawGeometry(null, new Pen(Foreground, Thickness, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), geometry);
    }
}

public static class Glyphs
{
    private static string Rect(double x, double y, double w, double h, double r) =>
        $"M{x + r} {y}H{x + w - r}A{r} {r} 0 0 1 {x + w} {y + r}V{y + h - r}A{r} {r} 0 0 1 {x + w - r} {y + h}H{x + r}A{r} {r} 0 0 1 {x} {y + h - r}V{y + r}A{r} {r} 0 0 1 {x + r} {y}Z";

    private static string Circle(double cx, double cy, double r) => $"M{cx - r} {cy}A{r} {r} 0 1 0 {cx + r} {cy}A{r} {r} 0 1 0 {cx - r} {cy}Z";

    private static readonly Dictionary<string, string> Paths = new()
    {
        ["wallet"] = "M4 7.5A2.5 2.5 0 0 1 6.5 5H18A2 2 0 0 1 20 7V8.5" + Rect(3, 8, 18, 12, 3) + Circle(16.5, 14, 0.6),
        ["card"] = Rect(3, 5.5, 18, 13, 3) + "M3 10H21M7 15H11",
        ["cash"] = Rect(3, 6.5, 18, 11, 2.5) + Circle(12, 12, 2.6),
        ["savings"] = "M5 12.5A7 5.5 0 0 1 12 7C16 7 19 9.4 19 12.5C19 14.2 18.1 15.7 16.7 16.7V19H13.7V17.8C13.1 17.9 12.6 18 12 18S10.9 17.9 10.3 17.8V19H7.3V16.7C5.9 15.7 5 14.2 5 12.5Z" + Circle(15, 11, 0.4),
        ["salary"] = Rect(3.5, 7.5, 17, 12, 2.5) + "M9 7.5V6A1.5 1.5 0 0 1 10.5 4.5H13.5A1.5 1.5 0 0 1 15 6V7.5M3.5 13H20.5",
        ["business"] = "M4 9L5.5 4.5H18.5L20 9M4 9V19.5H20V9M4 9A2.7 2.7 0 0 0 9.3 9A2.7 2.7 0 0 0 14.7 9A2.7 2.7 0 0 0 20 9M10 19.5V14.5H14V19.5",
        ["other"] = Rect(4, 4, 7, 7, 2) + Rect(13, 4, 7, 7, 2) + Rect(4, 13, 7, 7, 2) + Rect(13, 13, 7, 7, 2),
        ["food"] = "M7 3V11M5 3V8A2 2 0 0 0 9 8V3M7 11V21M17 21V3C15 4.5 14 7 14 10V13H17",
        ["transport"] = Rect(5, 4, 14, 13, 3) + "M5 11H19M8 20L9.5 17M16 20L14.5 17",
        ["utilities"] = "M13 3L5.5 13.5H11L10 21L17.5 10.5H12Z",
        ["home"] = "M4 11L12 4.5L20 11V19A1 1 0 0 1 19 20H14.5V15H9.5V20H5A1 1 0 0 1 4 19Z",
        ["health"] = "M12 20S5 15.6 5 10A4 4 0 0 1 12 7.4A4 4 0 0 1 19 10C19 15.6 12 20 12 20Z",
        ["fun"] = "M4.5 19.5L8 9L15 16Z M12 9.5L13.5 8M17 4.5L17.5 5M19.5 9L20 9.5",
        ["plus"] = "M12 5V19M5 12H19",
        ["minus"] = "M5 12H19",
        ["filter"] = "M4 5.5H20L14 12.7V18L10 20V12.7Z",
        ["history"] = "M6 3.5H18V20.5L15 18.5L12 20.5L9 18.5L6 20.5Z M9 8H15M9 12H15",
        ["chart"] = "M12 3.5A8.5 8.5 0 1 0 20.5 12H12Z M15 3.8A8.5 8.5 0 0 1 20.2 9H15Z",
        ["settings"] = "M10.08 4.85L10.52 2.11L13.48 2.11L13.92 4.85L15.70 5.59L17.95 3.96L20.04 6.05L18.41 8.30L19.15 10.08L21.89 10.52L21.89 13.48L19.15 13.92L18.41 15.70L20.04 17.95L17.95 20.04L15.70 18.41L13.92 19.15L13.48 21.89L10.52 21.89L10.08 19.15L8.30 18.41L6.05 20.04L3.96 17.95L5.59 15.70L4.85 13.92L2.11 13.48L2.11 10.52L4.85 10.08L5.59 8.30L3.96 6.05L6.05 3.96L8.30 5.59Z" + Circle(12, 12, 3),
        ["eye"] = "M2.5 12S6 5.5 12 5.5S21.5 12 21.5 12S18 18.5 12 18.5S2.5 12 2.5 12Z" + Circle(12, 12, 3),
        ["eyeOff"] = "M10 6A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12A17 17 0 0 1 18.9 15.4M6.6 6.8C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5A9 9 0 0 0 16.6 17.2M9.9 9.9A3 3 0 0 0 14.1 14.1M3.5 3.5L20.5 20.5",
        ["chevronDown"] = "M6 9.5L12 15.5L18 9.5",
        ["edit"] = "M4 20L5 15.5L16.5 4A2.1 2.1 0 0 1 19.5 4L20 4.5A2.1 2.1 0 0 1 20 7.5L8.5 19L4 20ZM14.5 6L18 9.5",
        ["chevronLeft"] = "M14.5 5.5L8 12L14.5 18.5",
        ["handshake"] = "M3 11L7 8L11 9.5L13.5 8L17.5 8.5L21 10.5M3 11L6 17L9 18.5L11.5 17M21 11L18 17L14.5 18.5L11.5 16.5",
        ["user"] = Circle(12, 8.5, 3.6) + "M4.5 20A7.5 7.5 0 0 1 19.5 20",
        ["users"] = Circle(9, 8.5, 3) + "M3.5 19A5.5 5.5 0 0 1 14.5 19M15.5 6.2A3 3 0 0 1 15.5 11.8M17.5 14A5.5 5.5 0 0 1 20.5 19",
        ["globe"] = Circle(12, 12, 8.5) + "M3.5 12H20.5M12 3.5C14.5 6 14.5 18 12 20.5M12 3.5C9.5 6 9.5 18 12 20.5",
        ["palette"] = "M12 3.5A8.5 8.5 0 0 0 12 20.5C13.5 20.5 13.8 19.3 13.2 18.3C12.6 17.3 13.2 16 14.5 16H16.5A4 4 0 0 0 20.5 12A8.5 8.5 0 0 0 12 3.5Z" + Circle(8, 11, 0.6) + Circle(11.5, 7.5, 0.6) + Circle(15.5, 9, 0.6),
        ["database"] = "M5 6C5 4.3 8.1 3 12 3S19 4.3 19 6S15.9 9 12 9S5 7.7 5 6ZM5 6V18C5 19.7 8.1 21 12 21S19 19.7 19 18V6M5 12C5 13.7 8.1 15 12 15S19 13.7 19 12",
        ["chevronRight"] = "M9.5 5.5L16 12L9.5 18.5",
        ["search"] = Circle(11, 11, 6.5) + "M16 16L20 20",
        ["trash"] = "M4.5 7H19.5M9.5 7V4.5H14.5V7M6.5 7L7.3 19.2A1.5 1.5 0 0 0 8.8 20.6H15.2A1.5 1.5 0 0 0 16.7 19.2L17.5 7M10 11V17M14 11V17",
        ["swap"] = "M5 9H18L14.5 5.5M19 15H6L9.5 18.5",
        ["close"] = "M6 6L18 18M18 6L6 18",
        ["backspace"] = "M9 5H19A1.5 1.5 0 0 1 20.5 6.5V17.5A1.5 1.5 0 0 1 19 19H9L3.5 12Z M12.5 9.5L17.5 14.5M17.5 9.5L12.5 14.5",
        ["check"] = "M5 12.5L9.5 17L19 7.5",
        ["calendar"] = Rect(4, 5.5, 16, 14, 2.5) + "M4 10H20M8.5 3.5V7.5M15.5 3.5V7.5",
    };

    private static readonly Dictionary<string, Geometry> Cache = new();

    public static Geometry? Get(string? name)
    {
        if (name is null || !Paths.TryGetValue(name, out var data)) return null;
        if (!Cache.TryGetValue(name, out var g)) Cache[name] = g = Geometry.Parse(data.Replace(',', '.'));
        return g;
    }
}
