using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;

namespace Hamyon.App.ViewModels;

public partial class TabVm : ObservableObject
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    public required string Icon { get; init; }
    [ObservableProperty] public partial bool IsActive { get; set; }
}

/// <summary>A tab whose screen is not ported from the React Native app yet.</summary>
public sealed class PlaceholderViewModel(string title) : ViewModelBase
{
    public string Title { get; } = title;
}

/// <summary>Shell: the current screen and the floating bottom bar (Bosh, Tarix, Hisobot, Sozlamalar).</summary>
public partial class MainViewModel : ViewModelBase
{
    public HomeViewModel Home { get; }
    public HistoryViewModel History { get; }
    public ObservableCollection<TabVm> Tabs { get; }

    [ObservableProperty] public partial ViewModelBase Current { get; set; }

    /// <summary>Bottom sheet over everything (operation entry); null = closed.</summary>
    [ObservableProperty] public partial OperationViewModel? Sheet { get; set; }

    public MainViewModel() : this(new LocalStore()) { }

    public MainViewModel(LocalStore store)
    {
        Home = new HomeViewModel(store);
        History = new HistoryViewModel(store, changed: () => Home.Refresh());
        Home.OpenOperation += (kind, from, to) =>
            Sheet = new OperationViewModel(store, kind, from, to,
                onSaved: () => { Sheet = null; Home.Refresh(); History.Refresh(); },
                onClose: () => Sheet = null);
        Tabs =
        [
            new TabVm { Key = "home", Title = "BOSH", Icon = "wallet", IsActive = true },
            new TabVm { Key = "history", Title = "TARIX", Icon = "history" },
            new TabVm { Key = "reports", Title = "HISOBOT", Icon = "chart" },
            new TabVm { Key = "settings", Title = "SOZLAMALAR", Icon = "settings" },
        ];
        Current = Home;
    }

    [RelayCommand] private void CloseSheet() => Sheet = null;

    [RelayCommand]
    private void SelectTab(TabVm tab)
    {
        foreach (var t in Tabs) t.IsActive = t == tab;
        switch (tab.Key)
        {
            case "home": Home.Refresh(); Current = Home; break;
            case "history": History.Refresh(); Current = History; break;
            default: Current = new PlaceholderViewModel(tab.Title); break;
        }
    }
}
