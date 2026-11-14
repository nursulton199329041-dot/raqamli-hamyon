using System;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using Avalonia.Animation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media.Transformation;
using Avalonia.Threading;
using Hamyon.App.ViewModels;

namespace Hamyon.App.Views;

/// <summary>
/// The shell. The tab bar works like iOS 26's liquid glass bar: a tap selects a tab; pressing and sliding grows the
/// glass lens, it follows the finger (the icons under it grow too), and on release it snaps to the nearest tab,
/// which opens.
/// </summary>
public partial class ShellView : UserControl
{
    private const double LensGrow = 1.14;   // lens scale while held
    private const double IconGrow = 0.22;   // extra icon scale right under the lens centre

    private MainViewModel? _vm;
    private bool _pressed;
    private double _lensX;                  // current left edge of the lens
    private double _grabOffset;             // finger x minus lens left, so the lens doesn't jump under the finger
    private readonly Transitions? _lensTransitions;

    public ShellView()
    {
        InitializeComponent();
        _lensTransitions = Lens.Transitions;
        TabArea.PointerPressed += OnPressed;
        TabArea.PointerMoved += OnMoved;
        TabArea.PointerReleased += OnReleased;
        TabArea.PointerCaptureLost += (_, _) => { if (_pressed) Finish(); };
        TabArea.SizeChanged += (_, _) => PlaceLens(animate: false);
        DataContextChanged += (_, _) => Attach(DataContext as MainViewModel);
    }

    // ---- on-screen keyboard: sheets (sign-in, editor, budget, …) move up so their fields stay visible ----

    private Avalonia.Controls.Platform.IInputPane? _pane;

    protected override void OnAttachedToVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _pane = TopLevel.GetTopLevel(this)?.InputPane;
        if (_pane is null) return;
        _pane.StateChanged += OnKeyboard;
        LiftSheet(_pane.OccludedRect);
    }

    protected override void OnDetachedFromVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        if (_pane is not null) _pane.StateChanged -= OnKeyboard;
        _pane = null;
        base.OnDetachedFromVisualTree(e);
    }

    private void OnKeyboard(object? sender, Avalonia.Controls.Platform.InputPaneStateEventArgs e) =>
        LiftSheet(e.NewState == Avalonia.Controls.Platform.InputPaneState.Open ? e.EndRect : default);

    /// <summary>Bottom margin = the part of this view the keyboard covers.</summary>
    private void LiftSheet(Avalonia.Rect keyboard)
    {
        var covered = keyboard.Height <= 0 ? 0 : Math.Max(0, Bounds.Height - keyboard.Top);
        SheetHost.Margin = new Avalonia.Thickness(0, 36, 0, covered);
    }

    private void Attach(MainViewModel? vm)
    {
        _vm = vm;
        if (vm is null) return;
        foreach (var t in vm.Tabs) t.PropertyChanged += OnTabChanged;
        Dispatcher.UIThread.Post(() => PlaceLens(animate: false), DispatcherPriority.Loaded);
    }

    /// <summary>The active tab can also change from code (phone "back" returns to Home).</summary>
    private void OnTabChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(TabVm.IsActive) && !_pressed && sender is TabVm { IsActive: true }) PlaceLens(animate: true);
    }

    private int Count => Math.Max(1, _vm?.Tabs.Count ?? 4);
    private double CellWidth => TabArea.Bounds.Width / Count;

    private int ActiveIndex
    {
        get
        {
            if (_vm is null) return 0;
            var active = _vm.Tabs.FirstOrDefault(t => t.IsActive);
            return active is null ? 0 : _vm.Tabs.IndexOf(active);
        }
    }

    /// <summary>Lens resting under the active tab.</summary>
    private void PlaceLens(bool animate)
    {
        if (TabArea.Bounds.Width <= 0) return;
        Lens.Width = CellWidth;
        Lens.Height = TabArea.Bounds.Height;
        Lens.Transitions = animate ? _lensTransitions : null;
        _lensX = ActiveIndex * CellWidth;
        SetLens(_lensX, 1);
        ResetIcons();
        if (!animate) Dispatcher.UIThread.Post(() => Lens.Transitions = _lensTransitions, DispatcherPriority.Background);
    }

    private void SetLens(double x, double scale) =>
        Lens.RenderTransform = TransformOperations.Parse(string.Create(CultureInfo.InvariantCulture, $"translateX({x:0.##}px) scale({scale:0.###})"));

    private void OnPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_vm is null || CellWidth <= 0) return;
        _pressed = true;
        e.Pointer.Capture(TabArea);
        var x = e.GetPosition(TabArea).X;
        // pressing on the lens picks it up where it is; pressing elsewhere brings it under the finger
        var onLens = x >= _lensX && x <= _lensX + CellWidth;
        _grabOffset = onLens ? x - _lensX : CellWidth / 2;
        _lensX = Clamp(x - _grabOffset);
        Lens.Transitions = _lensTransitions;
        SetLens(_lensX, LensGrow);
        MagnifyIcons();
        e.Handled = true;
    }

    private void OnMoved(object? sender, PointerEventArgs e)
    {
        if (!_pressed) return;
        Lens.Transitions = null; // follow the finger exactly
        _lensX = Clamp(e.GetPosition(TabArea).X - _grabOffset);
        SetLens(_lensX, LensGrow);
        MagnifyIcons();
        e.Handled = true;
    }

    private void OnReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (!_pressed) return;
        Finish();
        e.Pointer.Capture(null);
        e.Handled = true;
    }

    /// <summary>Snap to the tab nearest to the lens and open it.</summary>
    private void Finish()
    {
        _pressed = false;
        if (_vm is null || CellWidth <= 0) return;
        var index = Math.Clamp((int)Math.Round(_lensX / CellWidth), 0, Count - 1);
        Lens.Transitions = _lensTransitions;
        _lensX = index * CellWidth;
        SetLens(_lensX, 1);
        ResetIcons();
        var tab = _vm.Tabs[index];
        if (!tab.IsActive) _vm.SelectTabCommand.Execute(tab);
    }

    private double Clamp(double x) => Math.Clamp(x, 0, Math.Max(0, TabArea.Bounds.Width - CellWidth));

    /// <summary>Icons grow as the lens passes over them (closest = biggest).</summary>
    private void MagnifyIcons()
    {
        var centre = _lensX + CellWidth / 2;
        for (var i = 0; i < Count; i++)
        {
            if (TabItems.ContainerFromIndex(i) is not Control c) continue;
            var d = Math.Abs(centre - (i + 0.5) * CellWidth) / CellWidth;
            var s = 1 + IconGrow * Math.Max(0, 1 - d);
            c.RenderTransform = TransformOperations.Parse(string.Create(CultureInfo.InvariantCulture, $"scale({s:0.###})"));
        }
    }

    private void ResetIcons()
    {
        for (var i = 0; i < Count; i++)
            if (TabItems.ContainerFromIndex(i) is Control c) c.RenderTransform = null;
    }
}
