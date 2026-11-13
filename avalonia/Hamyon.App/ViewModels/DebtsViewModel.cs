using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

public sealed record DebtRowVm(string Person, string Currency, decimal Balance)
{
    public bool TheyOwe => Balance > 0;
    public string Amount => Money.Format(Math.Abs(Balance), Currency);
    public string Caption => L.T(TheyOwe ? "debt_they_owe" : "debt_you_owe");
    public string Initial => Person.Length > 0 ? Person[..1].ToUpperInvariant() : "?";
}

/// <summary>
/// Open debts per person: "lent" takes money out of a wallet, "borrowed" puts it in. "Repaid" opens the opposite
/// operation with the person and the open amount filled in, so a settled debt disappears from the list.
/// </summary>
public partial class DebtsViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action<ViewModelBase?> _sheet;
    private readonly Action _changed;

    public Action Back { get; }
    public ObservableCollection<DebtRowVm> Items { get; } = new();
    [ObservableProperty] public partial bool IsEmpty { get; set; }
    [ObservableProperty] public partial string OwedToMe { get; set; } = "0";
    [ObservableProperty] public partial string IOwe { get; set; } = "0";

    public DebtsViewModel(LocalStore store, Action back, Action<ViewModelBase?> sheet, Action changed)
    {
        _store = store;
        Back = back;
        _sheet = sheet;
        _changed = changed;
        Refresh();
    }

    public void Refresh()
    {
        Items.Clear();
        var plus = new System.Collections.Generic.Dictionary<string, decimal>();
        var minus = new System.Collections.Generic.Dictionary<string, decimal>();
        foreach (var (person, cur, bal) in _store.Debts())
        {
            Items.Add(new DebtRowVm(person, cur, bal));
            var target = bal > 0 ? plus : minus;
            target[cur] = target.GetValueOrDefault(cur) + Math.Abs(bal);
        }
        OwedToMe = Money.Format(plus);
        IOwe = Money.Format(minus);
        IsEmpty = Items.Count == 0;
    }

    [RelayCommand] private void GoBack() => Back();
    [RelayCommand] private void Lend() => Open(OpKind.Lend, null, null);
    [RelayCommand] private void Borrow() => Open(OpKind.Borrow, null, null);

    /// <summary>They owe me → the money comes back (Borrow kind); I owe → I pay it back (Lend kind).</summary>
    [RelayCommand]
    private void Repay(DebtRowVm row) => Open(row.TheyOwe ? OpKind.Borrow : OpKind.Lend, row.Person, Math.Abs(row.Balance), row.Currency, L.T("repay"));

    private void Open(OpKind kind, string? person, decimal? amount, string? currency = null, string? title = null)
    {
        // pick a wallet in the debt's currency when repaying
        long? wallet = null;
        if (currency is not null)
            foreach (var w in _store.Wallets())
                if (w.Currency == currency) { wallet = w.Id; break; }

        var vm = new OperationViewModel(_store, kind, wallet, null,
            onSaved: () => { _sheet(null); Refresh(); _changed(); },
            onClose: () => _sheet(null), person: person, title: title);
        if (amount is { } a) vm.Expression = Calc.Plain(a);
        _sheet(vm);
    }
}
