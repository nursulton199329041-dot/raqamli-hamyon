using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Hamyon.App.Models;

namespace Hamyon.App.Controls;

public sealed record ChartSlice(double Value, string Color);

/// <summary>Ring chart: one arc per slice, in order, starting at 12 o'clock, with a small gap between slices.</summary>
public sealed class DonutChart : Control
{
    public static readonly StyledProperty<IReadOnlyList<ChartSlice>?> SlicesProperty =
        AvaloniaProperty.Register<DonutChart, IReadOnlyList<ChartSlice>?>(nameof(Slices));
    public static readonly StyledProperty<double> RingProperty = AvaloniaProperty.Register<DonutChart, double>(nameof(Ring), 22);

    static DonutChart() => AffectsRender<DonutChart>(SlicesProperty, RingProperty);

    public IReadOnlyList<ChartSlice>? Slices { get => GetValue(SlicesProperty); set => SetValue(SlicesProperty, value); }
    public double Ring { get => GetValue(RingProperty); set => SetValue(RingProperty, value); }

    public override void Render(DrawingContext ctx)
    {
        var size = Math.Min(Bounds.Width, Bounds.Height);
        var r = (size - Ring) / 2;
        var c = new Point(Bounds.Width / 2, Bounds.Height / 2);
        // track
        ctx.DrawEllipse(null, new Pen(new SolidColorBrush(Color.Parse("#14FFECE4")), Ring), c, r, r);

        var slices = Slices?.Where(s => s.Value > 0).ToList();
        var total = slices?.Sum(s => s.Value) ?? 0;
        if (slices is null || total <= 0) return;
        if (slices.Count == 1)
        {
            ctx.DrawEllipse(null, new Pen(new SolidColorBrush(Color.Parse(slices[0].Color)), Ring), c, r, r);
            return;
        }

        var gap = Math.Min(0.035, 0.5 / slices.Count); // radians
        var a = -Math.PI / 2;
        foreach (var s in slices)
        {
            var sweep = s.Value / total * Math.PI * 2;
            var from = a + gap / 2;
            var to = a + sweep - gap / 2;
            a += sweep;
            if (to <= from) continue;
            var g = new StreamGeometry();
            using (var gc = g.Open())
            {
                gc.BeginFigure(new Point(c.X + r * Math.Cos(from), c.Y + r * Math.Sin(from)), false);
                gc.ArcTo(new Point(c.X + r * Math.Cos(to), c.Y + r * Math.Sin(to)), new Size(r, r), 0, to - from > Math.PI, SweepDirection.Clockwise);
                gc.EndFigure(false);
            }
            ctx.DrawGeometry(null, new Pen(new SolidColorBrush(Color.Parse(s.Color)), Ring, lineCap: PenLineCap.Flat), g);
        }
    }
}

/// <summary>Vertical bars with 3 value gridlines (compact labels) and sparse x labels; empty buckets show as a faint stub.</summary>
public sealed class BarChart : Control
{
    public static readonly StyledProperty<IReadOnlyList<double>?> ValuesProperty =
        AvaloniaProperty.Register<BarChart, IReadOnlyList<double>?>(nameof(Values));
    public static readonly StyledProperty<IReadOnlyList<string>?> LabelsProperty =
        AvaloniaProperty.Register<BarChart, IReadOnlyList<string>?>(nameof(Labels));
    public static readonly StyledProperty<IBrush?> BarBrushProperty =
        AvaloniaProperty.Register<BarChart, IBrush?>(nameof(BarBrush), Brushes.Orange);

    static BarChart() => AffectsRender<BarChart>(ValuesProperty, LabelsProperty, BarBrushProperty);

    public IReadOnlyList<double>? Values { get => GetValue(ValuesProperty); set => SetValue(ValuesProperty, value); }
    public IReadOnlyList<string>? Labels { get => GetValue(LabelsProperty); set => SetValue(LabelsProperty, value); }
    public IBrush? BarBrush { get => GetValue(BarBrushProperty); set => SetValue(BarBrushProperty, value); }

    private static readonly IBrush Muted = new SolidColorBrush(Color.Parse("#BFAEA9"));
    private static readonly IBrush Grid = new SolidColorBrush(Color.Parse("#1AFFECE4"));
    private static readonly Typeface Face = new(FontFamily.Default);

    public override void Render(DrawingContext ctx)
    {
        var values = Values;
        if (values is null || values.Count == 0) return;
        const double left = 52, bottom = 22, top = 6;
        var w = Bounds.Width - left;
        var h = Bounds.Height - bottom - top;
        if (w <= 0 || h <= 0) return;

        // round gridlines: step = 1/2/2.5/5 × 10^n, about three of them, the top one at or above the highest bar
        var step = NiceStep(values.Max() / 3);
        var lines = Math.Max(1, (int)Math.Ceiling(values.Max() / step));
        var max = step * lines;
        for (var i = 0; i <= lines; i++)
        {
            var y = top + h - h * i / lines;
            ctx.DrawLine(new Pen(Grid, 1), new Point(left, y), new Point(Bounds.Width, y));
            Text(ctx, Money.Compact((decimal)(step * i)), new Point(0, y - 8), 10);
        }

        var slot = w / values.Count;
        var bw = Math.Max(2, Math.Min(18, slot * 0.62));
        var every = Math.Max(1, (int)Math.Ceiling(values.Count / (w / 34)));
        for (var i = 0; i < values.Count; i++)
        {
            var x = left + slot * i + (slot - bw) / 2;
            var bh = max > 0 ? h * values[i] / max : 0;
            if (bh > 0) ctx.DrawRectangle(BarBrush, null, new RoundedRect(new Rect(x, top + h - bh, bw, bh), Math.Min(4, bw / 2), Math.Min(4, bw / 2), 0, 0));
            else ctx.DrawRectangle(Grid, null, new Rect(x, top + h - 2, bw, 2));
            if (Labels is { } labels && i < labels.Count && i % every == 0)
                Text(ctx, labels[i], new Point(left + slot * i + slot / 2 - 10, top + h + 5), 10);
        }
    }

    private static void Text(DrawingContext ctx, string s, Point at, double size) =>
        ctx.DrawText(new FormattedText(s, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, Face, size, Muted), at);

    /// <summary>Smallest 1, 2, 2.5 or 5 × 10^n that is ≥ v, so gridline labels are round numbers.</summary>
    public static double NiceStep(double v)
    {
        if (v <= 0) return 1;
        var p = Math.Pow(10, Math.Floor(Math.Log10(v)));
        foreach (var m in new[] { 1, 2, 2.5, 5, 10 })
            if (v <= m * p) return m * p;
        return 10 * p;
    }
}
