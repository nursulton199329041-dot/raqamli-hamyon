using System;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Hamyon.App.Controls;
using Hamyon.App.Converters;
using Hamyon.App.ViewModels;

namespace Hamyon.App.Views;

/// <summary>
/// Home screen. Besides taps, tiles can be dragged onto each other (rules in <see cref="HomeViewModel.DropKind"/>):
/// touch starts a drag after a short hold so a normal swipe still scrolls; a mouse drags as soon as it moves.
/// While dragging, a floating copy follows the pointer, a valid target grows with a ring, and the page scrolls
/// when the pointer rests near the top or bottom edge.
/// </summary>
public partial class HomeView : UserControl
{
    private const double MouseSlop = 8;
    private const double TouchSlop = 10;
    private const double GhostSize = 62;
    private static readonly TimeSpan HoldTime = TimeSpan.FromMilliseconds(320);

    private Button? _source;
    private Button? _target;
    private IPointer? _pointer;
    private Point _pressAt;
    private Point _last;
    private bool _isMouse;
    private bool _dragging;
    private Control? _ghost;
    private readonly DispatcherTimer _hold;
    private readonly DispatcherTimer _tick;

    public HomeView()
    {
        InitializeComponent();
        _hold = new DispatcherTimer { Interval = HoldTime };
        _hold.Tick += (_, _) => { _hold.Stop(); if (_source is not null) BeginDrag(); };
        _tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        _tick.Tick += (_, _) => AutoScroll();

        // tunnel + handledEventsToo: tiles are Buttons, which mark pointer events handled
        AddHandler(PointerPressedEvent, OnPressed, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(PointerMovedEvent, OnMoved, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(PointerReleasedEvent, OnReleased, RoutingStrategies.Tunnel, handledEventsToo: true);
        PointerCaptureLost += (_, _) => { if (_dragging) EndDrag(drop: false); };
        DataContextChanged += (_, _) =>
        {
            if (DataContext is HomeViewModel vm) vm.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(HomeViewModel.TourStep)) ShowTourStep(vm.TourStep); };
        };
    }

    /// <summary>The guide scrolls the section it explains into view (top for the drag steps).</summary>
    private void ShowTourStep(int step) => Dispatcher.UIThread.Post(() =>
    {
        Control? target = step switch { 1 => SourcesCard, 2 => WalletsCard, 3 => CategoriesCard, _ => null };
        if (target is null) { Scroller.Offset = new Vector(0, 0); return; }
        // the section a little below the top, its caption visible too
        var y = target.TranslatePoint(new Point(0, 0), Scroller.Content as Visual ?? Scroller)?.Y ?? 0;
        var max = Math.Max(0, Scroller.Extent.Height - Scroller.Viewport.Height);
        Scroller.Offset = new Vector(0, Math.Clamp(y - 140, 0, max));
    }, DispatcherPriority.Background);

    private static Button? TileOf(object? source) =>
        (source as Visual)?.GetSelfAndVisualAncestors().OfType<Button>().FirstOrDefault(b => b.Classes.Contains("tile") && b.DataContext is TileVm { IsAdd: false });

    private void OnPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_dragging || TileOf(e.Source) is not { } tile) return;
        _isMouse = e.Pointer.Type == PointerType.Mouse;
        if (_isMouse && !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        _source = tile;
        _pointer = e.Pointer;
        _pressAt = _last = e.GetPosition(this);
        if (!_isMouse) _hold.Start(); // touch / pen: hold to pick up
    }

    private void OnMoved(object? sender, PointerEventArgs e)
    {
        _last = e.GetPosition(this);
        if (_dragging)
        {
            MoveGhost();
            UpdateTarget();
            e.Handled = true;
            return;
        }
        if (_source is null) return;
        var moved = Distance(_last, _pressAt);
        if (_isMouse)
        {
            if (moved > MouseSlop && e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) BeginDrag();
        }
        else if (moved > TouchSlop) CancelPending(); // the finger is scrolling, not picking up
    }

    private void OnReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (_dragging)
        {
            EndDrag(drop: true);
            e.Handled = true; // no tap on the tile under the finger
        }
        else CancelPending();
    }

    private void BeginDrag()
    {
        if (_source?.DataContext is not TileVm tile) return;
        _hold.Stop();
        _dragging = true;
        _source.Classes.Add("dragSource");

        var badge = new BadgeBrushConverter().Convert(tile.Color, typeof(IBrush), null, System.Globalization.CultureInfo.InvariantCulture) as IBrush;
        _ghost = new Border
        {
            Width = GhostSize, Height = GhostSize, CornerRadius = new CornerRadius(GhostSize / 2),
            Background = badge,
            BoxShadow = new BoxShadows(new BoxShadow { OffsetY = 12, Blur = 26, Color = Color.FromArgb(0x99, 0, 0, 0) }),
            Child = new Glyph
            {
                Kind = tile.Icon, Foreground = Brushes.White, Width = 28, Height = 28,
                HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            },
        };
        DragLayer.Children.Add(_ghost);
        _pointer?.Capture(this);
        _tick.Start();
        MoveGhost();
        UpdateTarget();
    }

    /// <summary>The copy floats a little above the finger so the finger doesn't hide it.</summary>
    private void MoveGhost()
    {
        if (_ghost is null) return;
        Canvas.SetLeft(_ghost, _last.X - GhostSize / 2);
        Canvas.SetTop(_ghost, _last.Y - GhostSize / 2 - (_isMouse ? 0 : 36));
    }

    private void UpdateTarget()
    {
        if (_source?.DataContext is not TileVm from) return;
        // what is under the (lifted) pointer — the floating copy itself is not hit-testable
        var probe = new Point(_last.X, _last.Y - (_isMouse ? 0 : 36));
        Button? found = null;
        foreach (var hit in this.GetInputElementsAt(probe))
        {
            if (TileOf(hit) is not { } b) continue;
            if (b != _source && b.DataContext is TileVm to && DataContext is HomeViewModel vm && vm.CanDrop(from, to)) found = b;
            break;
        }
        if (found == _target) return;
        _target?.Classes.Remove("dropTarget");
        _target = found;
        _target?.Classes.Add("dropTarget");
    }

    /// <summary>Scrolls the page while the pointer rests near the top or above the tab bar.</summary>
    private void AutoScroll()
    {
        if (!_dragging) return;
        // only the very edges scroll: the top strip, and the strip of the floating tab bar at the bottom
        const double top = 56, bottom = 110;
        var h = Scroller.Bounds.Height;
        var speed = _last.Y < top ? -(top - _last.Y) / 6 : _last.Y > h - bottom ? (_last.Y - (h - bottom)) / 6 : 0;
        if (speed == 0) return;
        var max = Math.Max(0, Scroller.Extent.Height - Scroller.Viewport.Height);
        Scroller.Offset = new Vector(Scroller.Offset.X, Math.Clamp(Scroller.Offset.Y + speed, 0, max));
        UpdateTarget();
    }

    private void EndDrag(bool drop)
    {
        var from = _source?.DataContext as TileVm;
        var to = _target?.DataContext as TileVm;
        _dragging = false;
        _tick.Stop();
        _source?.Classes.Remove("dragSource");
        _target?.Classes.Remove("dropTarget");
        if (_ghost is not null) DragLayer.Children.Remove(_ghost);
        _ghost = null;
        _source = _target = null;
        _pointer?.Capture(null);
        _pointer = null;
        if (drop && from is not null && to is not null && DataContext is HomeViewModel vm) vm.Drop(from, to);
    }

    private void CancelPending()
    {
        _hold.Stop();
        _source = null;
        _pointer = null;
    }

    private static double Distance(Point a, Point b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
}
