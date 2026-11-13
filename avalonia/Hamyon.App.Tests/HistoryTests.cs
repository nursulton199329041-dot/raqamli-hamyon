using Hamyon.App.Data;
using Hamyon.App.Models;
using Hamyon.App.ViewModels;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class HistoryTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-history-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;

    private static DateTime MidMonth => new(DateTime.Today.Year, DateTime.Today.Month, 15);

    public HistoryTests() => _store = new LocalStore(_path);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    private void Seed(DateTime day)
    {
        var cash = _store.Wallets()[0]; var card = _store.Wallets()[1];
        _store.AddOperation(new Operation(0, OpKind.Income, 1_000_000m, "UZS", cash.Id, null, null, _store.Sources()[0].Id, null, day.AddHours(9), null));
        _store.AddOperation(new Operation(0, OpKind.Expense, 250_000m, "UZS", cash.Id, null, null, null, _store.Categories()[0].Id, day.AddHours(12), "bozor"));
        _store.AddOperation(new Operation(0, OpKind.Transfer, 100_000m, "UZS", cash.Id, card.Id, null, null, null, day.AddDays(-1).AddHours(10), null));
    }

    [Fact]
    public void Month_totals_saldo_and_day_groups()
    {
        // mid-month: "the day before" stays in the same month whatever today is
        Seed(MidMonth);
        var vm = new HistoryViewModel(_store, () => { });

        Assert.Equal(Money.Format(1_000_000m, "UZS"), vm.Income);
        Assert.Equal(Money.Format(250_000m, "UZS"), vm.Expense);
        Assert.Equal(Money.Format(750_000m, "UZS"), vm.Saldo); // transfers are neither in nor out
        var rows = vm.Days.SelectMany(d => d.Rows).ToList();
        Assert.Equal(3, rows.Count);
        Assert.Equal(OpKind.Expense, rows[0].Kind); // newest first
        Assert.StartsWith("+", rows.Single(r => r.Kind == OpKind.Income).Amount);
    }

    [Fact]
    public void Search_filters_by_names_and_notes()
    {
        Seed(MidMonth);
        var vm = new HistoryViewModel(_store, () => { }) { Search = "bozor" };
        Assert.Single(vm.Days.SelectMany(d => d.Rows));
        vm.Search = "yo'q narsa";
        Assert.True(vm.IsEmpty);
    }

    [Fact]
    public void Delete_restores_the_wallet_balance_and_notifies()
    {
        Seed(MidMonth);
        var notified = false;
        var vm = new HistoryViewModel(_store, () => notified = true);
        var expense = vm.Days.SelectMany(d => d.Rows).Single(r => r.Kind == OpKind.Expense);

        vm.DeleteCommand.Execute(expense);

        Assert.True(notified);
        Assert.Equal(900_000m, _store.Wallets()[0].Balance); // 1 000 000 in − 100 000 transfer
        Assert.Equal(2, vm.Days.SelectMany(d => d.Rows).Count());
    }

    [Fact]
    public void Previous_month_is_empty_and_next_is_blocked_for_the_current_month()
    {
        Seed(MidMonth);
        var vm = new HistoryViewModel(_store, () => { });
        Assert.False(vm.CanGoNext);
        vm.PrevMonthCommand.Execute(null);
        Assert.True(vm.CanGoNext);
    }
}
