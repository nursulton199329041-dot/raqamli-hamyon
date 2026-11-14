using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>One expense category with its monthly limit and this month's spending.</summary>
public partial class BudgetRowVm : ObservableObject
{
    public required long Id { get; init; }
    public required string Name { get; init; }
    public required string Icon { get; init; }
    public required string Color { get; init; }
    public required decimal Spent { get; init; }
    public required string SpentText { get; init; }
    public decimal Original { get; init; }
    /// <summary>the limit as typed (spaces allowed); empty = no budget</summary>
    [ObservableProperty] public partial string? Amount { get; set; }
}

/// <summary>
/// "Byudjetni sozlash": a monthly limit (so'm) per expense category. On the home screen the category then shows
/// a bar of how much of it is spent, red once it is over.
/// </summary>
public partial class BudgetViewModel : ViewModelBase
{
    private readonly LocalStore _store;
    private readonly Action _saved;
    private readonly Action _close;

    public ObservableCollection<BudgetRowVm> Rows { get; } = new();
    [ObservableProperty] public partial string Total { get; set; } = "";

    public BudgetViewModel(LocalStore store, Action saved, Action close)
    {
        _store = store;
        _saved = saved;
        _close = close;
        var budgets = store.Budgets();
        var spent = store.Totals(OpKind.Expense, Period.Of(PeriodKind.Month, DateTime.Now));
        foreach (var c in store.Categories())
        {
            var s = spent.GetValueOrDefault(c.Id)?.GetValueOrDefault(OperationViewModel.BaseCurrency) ?? 0m;
            var b = budgets.GetValueOrDefault(c.Id);
            Rows.Add(new BudgetRowVm
            {
                Id = c.Id, Name = c.Name, Icon = c.Icon, Color = c.Color, Spent = s,
                SpentText = L.T("budget_spent", Money.Format(s, OperationViewModel.BaseCurrency)),
                Original = b, Amount = b > 0 ? Calc.Plain(b) : null,
            });
        }
        UpdateTotal();
        foreach (var r in Rows) r.PropertyChanged += (_, _) => UpdateTotal();
    }

    /// <summary>"12 500 000" / "12500000" / "12 500 000,50" → amount; empty or invalid → 0.</summary>
    public static decimal Parse(string? text)
    {
        var t = new string((text ?? "").Where(ch => char.IsDigit(ch) || ch is ',' or '.').ToArray()).Replace(',', '.');
        return decimal.TryParse(t, NumberStyles.Number, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : 0m;
    }

    private void UpdateTotal() =>
        Total = Money.Format(Rows.Sum(r => Parse(r.Amount)), OperationViewModel.BaseCurrency);

    [RelayCommand]
    private void Save()
    {
        foreach (var r in Rows)
        {
            var v = Parse(r.Amount);
            if (v != r.Original) _store.SetBudget(r.Id, v);
        }
        _saved();
        _close();
    }

    [RelayCommand] private void Close() => _close();
}
