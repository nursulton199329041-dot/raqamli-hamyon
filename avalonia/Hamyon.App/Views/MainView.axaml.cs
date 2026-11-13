using System;
using Avalonia.Controls;
using Hamyon.App.ViewModels;

namespace Hamyon.App.Views;

/// <summary>
/// Root view. Hosts a <see cref="ShellView"/> and replaces it after a language change: views read their strings once
/// ({l:T key}), so a fresh tree is the simplest way to show every label in the new language.
/// </summary>
public partial class MainView : UserControl
{
    private MainViewModel? _vm;

    public MainView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_vm is not null) { _vm.LanguageChanged -= Rebuild; _vm.ProfileSwitched -= SwitchProfile; }
        _vm = DataContext as MainViewModel;
        if (_vm is not null) { _vm.LanguageChanged += Rebuild; _vm.ProfileSwitched += SwitchProfile; }
        Rebuild();
    }

    /// <summary>Another profile = another book: start a fresh shell on it.</summary>
    private void SwitchProfile()
    {
        if (_vm?.Profiles is { } profiles) DataContext = new MainViewModel(profiles);
    }

    private void Rebuild() => Host.Content = _vm is null ? null : new ShellView { DataContext = _vm };

    // Android back button / gesture
    protected override void OnAttachedToVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (TopLevel.GetTopLevel(this) is { } top) top.BackRequested += OnBack;
    }

    protected override void OnDetachedFromVisualTree(Avalonia.VisualTreeAttachmentEventArgs e)
    {
        if (TopLevel.GetTopLevel(this) is { } top) top.BackRequested -= OnBack;
        base.OnDetachedFromVisualTree(e);
    }

    private void OnBack(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        if (_vm?.HandleBack() == true) e.Handled = true;
    }
}
