using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using Hamyon.App.Services;

namespace Hamyon.App.ViewModels;

/// <summary>A selectable chip (wallet, source, category, icon, colour, currency).</summary>
public partial class ChoiceVm : ObservableObject
{
    public required long Id { get; init; }
    public required string Name { get; init; }
    public required string Icon { get; init; }
    public required string Color { get; init; }
    public string Hint { get; init; } = "";
    [ObservableProperty] public partial bool IsSelected { get; set; }
}

public partial class DayVm : ObservableObject
{
    public required DateTime Date { get; init; }
    public string Day => Date.Day.ToString("00");
    public required string Caption { get; init; }
    [ObservableProperty] public partial bool IsSelected { get; set; }
}

/// <summary>
/// The operation sheet (income / expense / transfer / lend / borrow): calculator amount, "from → to" choices,
/// person for debts, date strip, note. Validates: positive amount, both ends chosen, no overdraft, two amounts across currencies.
/// </summary>
public partial class OperationViewModel : ViewModelBase
{
    public static readonly string[][] Keys =
    [
        ["C", "⌫", "÷", "×"],
        ["7", "8", "9", "−"],
        ["4", "5", "6", "+"],
        ["1", "2", "3", "="],
        ["000", "0", ",", ""],
    ];

    private readonly LocalStore _store;
    private readonly Action _onSaved;
    private readonly Action _onClose;
    private readonly IReadOnlyList<Wallet> _wallets;

    public OpKind Kind { get; }
    public bool IsDebt => Kind is OpKind.Lend or OpKind.Borrow;
    private readonly string? _title;
    public string Title => _title ?? L.T(Kind switch
    {
        OpKind.Income => "op_income", OpKind.Expense => "op_expense", OpKind.Transfer => "op_transfer",
        OpKind.Lend => "op_lend", _ => "op_borrow",
    });
    public string Color => Kind switch
    {
        OpKind.Income => "#1FCB8B", OpKind.Expense => "#FF6B6B", OpKind.Transfer => "#7C6CFF", _ => "#F5A524",
    };
    public string FromLabel => L.T(Kind switch { OpKind.Income => "from_source", OpKind.Borrow => "to_wallet", _ => "from_wallet" });
    public string ToLabel => L.T(Kind switch { OpKind.Expense => "category", _ => "to_wallet" });
    /// <summary>debts have one list (the wallet); the other end is the person</summary>
    public bool ShowTo => !IsDebt;

    public ObservableCollection<ChoiceVm> From { get; } = new();
    public ObservableCollection<ChoiceVm> To { get; } = new();
    public ObservableCollection<DayVm> Days { get; } = new();
    public IEnumerable<string> KeyList => Keys.SelectMany(r => r);

    [ObservableProperty] public partial string Expression { get; set; } = "";
    [ObservableProperty] public partial string? Note { get; set; }
    [ObservableProperty] public partial string? Person { get; set; }
    [ObservableProperty] public partial string? ToAmountText { get; set; }
    [ObservableProperty] public partial string? Error { get; set; }

    public string AmountText => Money.Format(Calc.Evaluate(Expression) ?? 0, Currency);
    public bool ShowExpression => Expression.IndexOfAny(Calc.Ops.ToCharArray()) > 0;
    public string Currency => SourceWallet?.Currency ?? "UZS";
    /// <summary>transfer between different currencies: the received amount is entered separately</summary>
    public bool NeedsToAmount => Kind == OpKind.Transfer && TargetWallet is { } t && SourceWallet is { } s && t.Currency != s.Currency;
    public string ToCurrency => TargetWallet?.Currency ?? "";

    // ---- expense from a wallet that is not in so'm: the category gets the so'm amount at a rate ----

    /// <summary>The main currency of the book: reports and categories are kept in it.</summary>
    public const string BaseCurrency = "UZS";

    [ObservableProperty] public partial string? RateText { get; set; }
    [ObservableProperty] public partial string RateHint { get; set; } = "";
    /// <summary>true once the user typed a rate: a late official rate must not overwrite it</summary>
    private bool _rateTyped;
    private bool _settingRate;

    public bool NeedsRate => Kind == OpKind.Expense && SourceWallet is { } w && w.Currency != BaseCurrency;
    public string RateLabel => L.T("rate_label", Currency);
    public decimal? Rate => Calc.Evaluate((RateText ?? "").Trim());
    public string BaseText => Calc.Evaluate(Expression) is { } a && Rate is { } r && r > 0
        ? "≈ " + Money.Format(decimal.Round(a * r, 2, MidpointRounding.AwayFromZero), BaseCurrency)
        : "";

    partial void OnRateTextChanged(string? value)
    {
        if (!_settingRate) _rateTyped = true;
        Error = null;
        OnPropertyChanged(nameof(BaseText));
    }

    private void SetRate(decimal? rate, string hintKey)
    {
        _settingRate = true;
        RateText = rate is { } r ? Calc.Plain(r) : "";
        _settingRate = false;
        RateHint = L.T(rate is null ? "rate_hint_manual" : hintKey);
    }

    /// <summary>Known rate at once, then the Central Bank's rate for the chosen day when it arrives.</summary>
    private async void LoadRate()
    {
        if (!NeedsRate) return;
        var cur = Currency;
        if (!_rateTyped) SetRate(Rates.Known(_store, cur), "rate_hint_last");
        var day = Days.FirstOrDefault(d => d.IsSelected)?.Date ?? DateTime.Today;
        var official = await Rates.Fetch(cur, day);
        if (official is not { } r || cur != Currency || !NeedsRate) return;
        if (day.Date == DateTime.Today) Rates.Save(_store, cur, r);
        if (!_rateTyped) SetRate(r, "rate_hint_cbu");
    }

    /// <summary>the wallet whose currency the amount is in</summary>
    private Wallet? SourceWallet => Kind == OpKind.Income ? Wallet(To) : Wallet(From);
    private Wallet? TargetWallet => Kind == OpKind.Transfer ? Wallet(To) : null;
    private Wallet? Wallet(IEnumerable<ChoiceVm> list) => list.FirstOrDefault(c => c.IsSelected) is { } c ? _wallets.FirstOrDefault(w => w.Id == c.Id) : null;

    public OperationViewModel(LocalStore store, OpKind kind, long? fromId, long? toId, Action onSaved, Action onClose, string? person = null, string? title = null)
    {
        _store = store;
        _onSaved = onSaved;
        _onClose = onClose;
        Kind = kind;
        Person = person;
        _title = title;
        _wallets = store.Wallets();

        ChoiceVm W(Wallet w) => new() { Id = w.Id, Name = w.Name, Icon = w.Icon, Color = w.Color, Hint = Money.Format(w.Balance, w.Currency) };
        switch (kind)
        {
            case OpKind.Income:
                foreach (var s in store.Sources()) From.Add(new ChoiceVm { Id = s.Id, Name = s.Name, Icon = s.Icon, Color = s.Color });
                foreach (var w in _wallets) To.Add(W(w));
                break;
            case OpKind.Expense:
                foreach (var w in _wallets) From.Add(W(w));
                foreach (var c in store.Categories()) To.Add(new ChoiceVm { Id = c.Id, Name = c.Name, Icon = c.Icon, Color = c.Color });
                break;
            case OpKind.Transfer:
                foreach (var w in _wallets) { From.Add(W(w)); To.Add(W(w)); }
                break;
            default: // lend / borrow: one wallet list
                foreach (var w in _wallets) From.Add(W(w));
                break;
        }
        Pick(From, fromId ?? From.FirstOrDefault()?.Id);
        Pick(To, toId ?? To.FirstOrDefault(c => kind != OpKind.Transfer || c.Id != (fromId ?? From.FirstOrDefault()?.Id))?.Id);

        var today = DateTime.Today;
        for (var i = 6; i >= 0; i--)
        {
            var d = today.AddDays(-i);
            Days.Add(new DayVm { Date = d, Caption = i == 0 ? L.T("today") : i == 1 ? L.T("yesterday") : L.Weekday(d.DayOfWeek), IsSelected = i == 0 });
        }
        LoadRate();
    }

    private static void Pick(IEnumerable<ChoiceVm> list, long? id)
    {
        foreach (var c in list) c.IsSelected = c.Id == id;
    }

    partial void OnExpressionChanged(string value)
    {
        Error = null;
        OnPropertyChanged(nameof(AmountText));
        OnPropertyChanged(nameof(ShowExpression));
        OnPropertyChanged(nameof(BaseText));
    }

    [RelayCommand] private void Press(string key) { if (key.Length > 0) Expression = Calc.Press(Expression, key); }

    [RelayCommand] private void SelectFrom(ChoiceVm c) { Pick(From, c.Id); Changed(); }
    [RelayCommand] private void SelectTo(ChoiceVm c) { Pick(To, c.Id); Changed(); }
    [RelayCommand]
    private void SelectDay(DayVm d)
    {
        foreach (var x in Days) x.IsSelected = x == d;
        LoadRate(); // the official rate is per day
    }
    [RelayCommand] private void Close() => _onClose();

    private void Changed()
    {
        Error = null;
        OnPropertyChanged(nameof(Currency));
        OnPropertyChanged(nameof(AmountText));
        OnPropertyChanged(nameof(NeedsToAmount));
        OnPropertyChanged(nameof(ToCurrency));
        OnPropertyChanged(nameof(NeedsRate));
        OnPropertyChanged(nameof(RateLabel));
        OnPropertyChanged(nameof(BaseText));
        _rateTyped = false; // another wallet may be in another currency
        LoadRate();
    }

    [RelayCommand]
    private void Save()
    {
        Error = Validate(out var op);
        if (Error is not null || op is null) return;
        _store.AddOperation(op);
        _onSaved();
    }

    /// <summary>Returns the user-facing error, or null with a ready operation.</summary>
    public string? Validate(out Operation? op)
    {
        op = null;
        var amount = Calc.Evaluate(Expression);
        if (amount is not > 0) return L.T("err_amount");
        var from = From.FirstOrDefault(c => c.IsSelected);
        var to = To.FirstOrDefault(c => c.IsSelected);
        var date = (Days.FirstOrDefault(d => d.IsSelected)?.Date ?? DateTime.Today) + DateTime.Now.TimeOfDay;
        var note = string.IsNullOrWhiteSpace(Note) ? null : Note.Trim();

        if (IsDebt)
        {
            if (from is null) return L.T("err_wallet");
            if (string.IsNullOrWhiteSpace(Person)) return L.T("err_person");
            if (Kind == OpKind.Lend && SourceWallet is { } lw && lw.Balance < amount) return L.T("err_funds", Money.Format(lw.Balance, lw.Currency));
            op = new Operation(0, Kind, amount.Value, Currency, from.Id, null, null, null, null, date, note, Person.Trim());
            return null;
        }

        if (from is null || to is null) return L.T(Kind == OpKind.Expense ? "err_pick_expense" : "err_pick");
        switch (Kind)
        {
            case OpKind.Income:
                op = new Operation(0, OpKind.Income, amount.Value, Currency, to.Id, null, null, from.Id, null, date, note);
                return null;
            case OpKind.Expense:
                if (SourceWallet is { } w && w.Balance < amount) return L.T("err_funds", Money.Format(w.Balance, w.Currency));
                decimal? rate = null, baseAmount = null;
                if (NeedsRate)
                {
                    // wallet loses its own currency; the category is charged in so'm at this rate
                    if (Rate is not { } r || r <= 0) return L.T("err_rate", Currency);
                    rate = r;
                    baseAmount = decimal.Round(amount.Value * r, 2, MidpointRounding.AwayFromZero);
                }
                op = new Operation(0, OpKind.Expense, amount.Value, Currency, from.Id, null, null, null, to.Id, date, note,
                    BaseAmount: baseAmount, Rate: rate);
                return null;
            default:
                if (from.Id == to.Id) return L.T("err_other_wallet");
                if (SourceWallet is { } sw && sw.Balance < amount) return L.T("err_funds", Money.Format(sw.Balance, sw.Currency));
                decimal? toAmount = null;
                if (NeedsToAmount)
                {
                    toAmount = Calc.Evaluate(ToAmountText ?? "");
                    if (toAmount is not > 0) return L.T("err_to_amount", ToCurrency);
                }
                op = new Operation(0, OpKind.Transfer, amount.Value, Currency, from.Id, to.Id, toAmount, null, null, date, note);
                return null;
        }
    }
}
