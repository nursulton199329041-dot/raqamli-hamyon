using System;
using Avalonia;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Avalonia.Controls;
using Avalonia.Media;

namespace Hamyon.App.Controls;

/// <summary>
/// iOS-style on/off switch (green track, white knob). Visual only: the row it sits in toggles the value,
/// so the whole row is one big touch target.
/// </summary>
public sealed class Switch : Control
{
    public static readonly StyledProperty<bool> IsOnProperty = AvaloniaProperty.Register<Switch, bool>(nameof(IsOn));
    private static readonly StyledProperty<double> ProgressProperty = AvaloniaProperty.Register<Switch, double>("Progress");

    private const double W = 51, H = 31, Pad = 2;
    private static readonly Color On = Color.Parse("#34C759");
    private static readonly Color Off = Color.Parse("#3DFFECE4");

    static Switch() => AffectsRender<Switch>(ProgressProperty);

    public Switch()
    {
        Transitions = [new DoubleTransition { Property = ProgressProperty, Duration = TimeSpan.FromMilliseconds(180), Easing = new CubicEaseOut() }];
    }

    public bool IsOn { get => GetValue(IsOnProperty); set => SetValue(IsOnProperty, value); }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == IsOnProperty) SetValue(ProgressProperty, IsOn ? 1d : 0d);
    }

    protected override Size MeasureOverride(Size availableSize) => new(W, H);

    public override void Render(DrawingContext ctx)
    {
        var p = GetValue(ProgressProperty);
        var track = Color.FromArgb(
            (byte)(Off.A + (On.A - Off.A) * p), (byte)(Off.R + (On.R - Off.R) * p),
            (byte)(Off.G + (On.G - Off.G) * p), (byte)(Off.B + (On.B - Off.B) * p));
        ctx.DrawRectangle(new SolidColorBrush(track), null, new RoundedRect(new Rect(0, 0, W, H), H / 2));
        var knob = H - Pad * 2;
        var x = Pad + (W - knob - Pad * 2) * p;
        var shadow = new RoundedRect(new Rect(x, Pad + 1.5, knob, knob), knob / 2);
        ctx.DrawRectangle(new SolidColorBrush(Color.FromArgb(0x40, 0, 0, 0)), null, shadow);
        ctx.DrawRectangle(Brushes.White, null, new RoundedRect(new Rect(x, Pad, knob, knob), knob / 2));
    }
}
