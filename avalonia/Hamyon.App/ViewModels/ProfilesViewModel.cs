using System;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;

namespace Hamyon.App.ViewModels;

public sealed class ProfileItemVm
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Color { get; init; }
    public bool IsCurrent { get; init; }
    public string Initial => Name.Length > 0 ? Name[..1].ToUpperInvariant() : "?";
}

/// <summary>
/// Profiles sheet (top-right icon on Home): the list of books, tap to switch, pencil to rename / recolour,
/// "new profile" to start an empty book. Switching restarts the shell on the chosen book.
/// </summary>
public partial class ProfilesViewModel : ViewModelBase
{
    private readonly ProfileStore _profiles;
    private readonly Action<string> _switchTo;
    private readonly Action _close;
    private string? _editId;

    public ObservableCollection<ProfileItemVm> Items { get; } = new();
    public ObservableCollection<ChoiceVm> Colors { get; } = new();

    [ObservableProperty] public partial bool IsEditing { get; set; }
    [ObservableProperty] public partial string? EditName { get; set; }
    [ObservableProperty] public partial string? Error { get; set; }
    public string EditTitle => _editId is null ? L.T("new_profile") : L.T("edit");

    public ProfilesViewModel(ProfileStore profiles, Action<string> switchTo, Action close)
    {
        _profiles = profiles;
        _switchTo = switchTo;
        _close = close;
        var i = 0;
        foreach (var c in EditorViewModel.Palette.Prepend("#F2C14E")) Colors.Add(new ChoiceVm { Id = i++, Name = c, Icon = "", Color = c });
        Reload();
    }

    private void Reload()
    {
        Items.Clear();
        var current = _profiles.CurrentId;
        foreach (var p in _profiles.Items())
            Items.Add(new ProfileItemVm { Id = p.Id, Name = p.Name, Color = p.Color, IsCurrent = p.Id == current });
    }

    [RelayCommand] private void Close() => _close();

    [RelayCommand]
    private void Select(ProfileItemVm p)
    {
        if (p.IsCurrent) { _close(); return; }
        _switchTo(p.Id);
    }

    [RelayCommand] private void New() => BeginEdit(null, "", Colors[1].Color);
    [RelayCommand] private void Edit(ProfileItemVm p) => BeginEdit(p.Id, p.Name, p.Color);

    private void BeginEdit(string? id, string name, string color)
    {
        _editId = id;
        EditName = name;
        Error = null;
        foreach (var c in Colors) c.IsSelected = string.Equals(c.Color, color, StringComparison.OrdinalIgnoreCase);
        if (!Colors.Any(c => c.IsSelected)) Colors[0].IsSelected = true;
        IsEditing = true;
        OnPropertyChanged(nameof(EditTitle));
    }

    [RelayCommand] private void SelectColor(ChoiceVm c) { foreach (var x in Colors) x.IsSelected = x == c; }
    [RelayCommand] private void CancelEdit() => IsEditing = false;

    [RelayCommand]
    private void SaveEdit()
    {
        var name = EditName?.Trim();
        if (string.IsNullOrEmpty(name)) { Error = L.T("err_name"); return; }
        var color = Colors.First(c => c.IsSelected).Color;
        if (_editId is null)
        {
            // a new profile opens right away, empty, with the default catalog
            var p = _profiles.Create(name, color);
            _switchTo(p.Id);
            return;
        }
        _profiles.Update(_editId, name, color);
        IsEditing = false;
        Reload();
        if (_editId == _profiles.CurrentId) _switchTo(_editId); // refresh the header's name / colour
    }
}
