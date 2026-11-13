using System;
using System.IO;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform.Storage;
using Hamyon.App.Services;
using Hamyon.App.ViewModels;

namespace Hamyon.App.Views;

/// <summary>
/// Root view. Hosts a <see cref="ShellView"/> and replaces it after a language change: views read their strings once
/// ({l:T key}), so a fresh tree is the simplest way to show every label in the new language.
/// Also plugs in the platform pieces the view models need: back button, save-file dialog, lock on return.
/// </summary>
public partial class MainView : UserControl
{
    /// <summary>Away longer than this (app in the background) → PIN again.</summary>
    private static readonly TimeSpan RelockAfter = TimeSpan.FromSeconds(30);

    private MainViewModel? _vm;
    private DateTime _hiddenAt = DateTime.MaxValue;

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

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (TopLevel.GetTopLevel(this) is { } top)
        {
            top.BackRequested += OnBack; // Android back button / gesture
            Files.Saver = (name, write) => SaveAsync(top, name, write);
        }
        if (Application.Current?.TryGetFeature<IActivatableLifetime>() is { } life)
        {
            life.Deactivated += OnDeactivated;
            life.Activated += OnActivated;
        }
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (TopLevel.GetTopLevel(this) is { } top) top.BackRequested -= OnBack;
        if (Application.Current?.TryGetFeature<IActivatableLifetime>() is { } life)
        {
            life.Deactivated -= OnDeactivated;
            life.Activated -= OnActivated;
        }
        base.OnDetachedFromVisualTree(e);
    }

    private void OnBack(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        if (_vm?.HandleBack() == true) e.Handled = true;
    }

    private void OnDeactivated(object? sender, ActivatedEventArgs e)
    {
        if (e.Kind == ActivationKind.Background) _hiddenAt = DateTime.UtcNow;
    }

    private void OnActivated(object? sender, ActivatedEventArgs e)
    {
        if (e.Kind != ActivationKind.Background) return;
        if (DateTime.UtcNow - _hiddenAt > RelockAfter) _vm?.Relock();
        _hiddenAt = DateTime.MaxValue;
    }

    /// <summary>System "save as" (Android: document picker, iOS: Files, desktop: dialog).</summary>
    private static async System.Threading.Tasks.Task<bool> SaveAsync(TopLevel top, string name, Func<Stream, System.Threading.Tasks.Task> write)
    {
        var file = await top.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            SuggestedFileName = name,
            DefaultExtension = Path.GetExtension(name).TrimStart('.'),
            ShowOverwritePrompt = true,
        });
        if (file is null) return false;
        await using var stream = await file.OpenWriteAsync();
        await write(stream);
        return true;
    }
}
