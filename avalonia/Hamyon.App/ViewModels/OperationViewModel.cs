using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Hamyon.App.Data;
using Hamyon.App.Models;

namespace Hamyon.App.ViewModels;

/// <summary>A selectable chip (wallet, source, category).</summary>
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
/// The operation sheet (income / expense / transfer): calculator amount, "from → to" choices, date strip, note.
/// Validates like the React Native app: positive amount, both ends chosen, no overdraft, two amounts across currencies.
/// </summary>
public partial class OperationViewModel : ViewModelBase
{
    private static readonly string[] WeekdaysUz = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
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
    public string Title => Kind switch { OpKind.Income => "Kirim", OpKind.Expense => "Xarajat", _ => "O‘tkazma" };
    public string Color => Kind switch { OpKind.Income => "#1FCB8B", OpKind.Expense => "#FF6B6B", _ => "#7C6CFF" };
    public string FromLabel => Kind == OpKind.Income ? "KIRIM MANBASI" : "QAYSI HAMYONDAN";
    public string ToLabel => Kind switch { OpKind.Income => "QAYSI HAMYONGA", OpKind.Expense => "TOIFA", _ => "QAYSI HAMYONGA" };

    public ObservableCollection<ChoiceVm> From { get; } = new();
    public ObservableCollection<ChoiceVm> To { get; } = new();
    public ObservableCollection<DayVm> Days { get; } = new();
    public IEnumerable<string> KeyList => Keys.SelectMany(r => r);

    [ObservableProperty] public partial string Expression { get; set; } = "";
    [ObservableProperty] public partial string? Note { get; set; }
    [ObservableProperty] public partial string? ToAmountText { get; set; }
    [ObservableProperty] public partial string? Error { get; set; }

    public string AmountText => Money.Format(Calc.Evaluate(Expression) ?? 0, Currency);
    public bool ShowExpression => Expression.IndexOfAny(Calc.Ops.ToCharArray()) > 0;
    public string Currency => SourceWallet?.Currency ?? "UZS";
    /// <summary>transfer between different currencies: the received amount is entered separately</summary>
    public bool NeedsToAmount => Kind == OpKind.Transfer && TargetWallet is { } t && SourceWallet is { } s && t.Currency != s.Currency;
    public string ToCurrency => TargetWallet?.Currency ?? "";

    private Wallet? SourceWallet => Kind == OpKind.Income ? Wallet(To) : Wallet(From);
    private Wallet? TargetWallet => Kind == OpKind.Transfer ? Wallet(To) : null;
    private Wallet? Wallet(IEnumerable<ChoiceVm> list) => list.FirstOrDefault(c => c.IsSelected) is { } c ? _wallets.FirstOrDefault(w => w.Id == c.Id) : null;

    public OperationViewModel(LocalStore store, OpKind kind, long? fromId, long? toId, Action onSaved, Action onClose)
    {
        _store = store;
        _onSaved = onSaved;
        _onClose = onClose;
        Kind = kind;
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
            default:
                foreach (var w in _wallets) { From.Add(W(w)); To.Add(W(w)); }
                break;
        }
        Pick(From, fromId ?? From.FirstOrDefault()?.Id);
        Pick(To, toId ?? To.FirstOrDefault(c => kind != OpKind.Transfer || c.Id != fromId)?.Id);

        var today = DateTime.Today;
        for (var i = 6; i >= 0; i--)
        {
            var d = today.AddDays(-i);
            Days.Add(new DayVm { Date = d, Caption = i == 0 ? "Bugun" : i == 1 ? "Kecha" : WeekdaysUz[(int)d.DayOfWeek], IsSelected = i == 0 });
        }
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
    }

    [RelayCommand] private void Press(string key) { if (key.Length > 0) Expression = Calc.Press(Expression, key); }

    [RelayCommand] private void SelectFrom(ChoiceVm c) { Pick(From, c.Id); Changed(); }
    [RelayCommand] private void SelectTo(ChoiceVm c) { Pick(To, c.Id); Changed(); }
    [RelayCommand] private void SelectDay(DayVm d) { foreach (var x in Days) x.IsSelected = x == d; }
    [RelayCommand] private void Close() => _onClose();

    private void Changed()
    {
        Error = null;
        OnPropertyChanged(nameof(Currency));
        OnPropertyChanged(nameof(AmountText));
        OnPropertyChanged(nameof(NeedsToAmount));
        OnPropertyChanged(nameof(ToCurrency));
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
        if (amount is not > 0) return "Summani kiriting";
        var from = From.FirstOrDefault(c => c.IsSelected);
        var to = To.FirstOrDefault(c => c.IsSelected);
        if (from is null || to is null) return Kind == OpKind.Expense ? "Hamyon va toifani tanlang" : "Ikkala tomonni tanlang";

        var date = (Days.FirstOrDefault(d => d.IsSelected)?.Date ?? DateTime.Today) + DateTime.Now.TimeOfDay;
        var note = string.IsNullOrWhiteSpace(Note) ? null : Note.Trim();
        switch (Kind)
        {
            case OpKind.Income:
                op = new Operation(0, OpKind.Income, amount.Value, Currency, to.Id, null, null, from.Id, null, date, note);
                return null;
            case OpKind.Expense:
                if (SourceWallet is { } w && w.Balance < amount) return $"Hamyonda yetarli mablag‘ yo‘q ({Money.Format(w.Balance, w.Currency)})";
                op = new Operation(0, OpKind.Expense, amount.Value, Currency, from.Id, null, null, null, to.Id, date, note);
                return null;
            default:
                if (from.Id == to.Id) return "Boshqa hamyonni tanlang";
                if (SourceWallet is { } sw && sw.Balance < amount) return $"Hamyonda yetarli mablag‘ yo‘q ({Money.Format(sw.Balance, sw.Currency)})";
                decimal? toAmount = null;
                if (NeedsToAmount)
                {
                    toAmount = Calc.Evaluate(ToAmountText ?? "");
                    if (toAmount is not > 0) return $"Qabul qilinadigan summani kiriting ({ToCurrency})";
                }
                op = new Operation(0, OpKind.Transfer, amount.Value, Currency, from.Id, to.Id, toAmount, null, null, date, note);
                return null;
        }
    }
}
