using Hamyon.App.Data;
using Hamyon.App.Models;
using Hamyon.App.ViewModels;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class StoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-test-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;

    public StoreTests() => _store = new LocalStore(_path);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    private Wallet W(string name) => _store.Wallets().Single(w => w.Name == name);

    [Fact]
    public void Fresh_book_has_default_catalog_and_zero_balances()
    {
        Assert.Equal(3, _store.Wallets().Count);
        Assert.Equal(3, _store.Sources().Count);
        Assert.Equal(7, _store.Categories().Count);
        Assert.All(_store.Wallets(), w => Assert.Equal(0, w.Balance));
    }

    [Fact]
    public void Balances_follow_income_expense_and_transfers()
    {
        var cash = W("Naqd"); var card = W("Bank kartasi"); var usd = W("Dollar jamg'arma");
        var salary = _store.Sources()[0]; var food = _store.Categories()[0];
        var now = DateTime.Now;

        _store.AddOperation(new Operation(0, OpKind.Income, 5_000_000m, "UZS", cash.Id, null, null, salary.Id, null, now, null));
        _store.AddOperation(new Operation(0, OpKind.Expense, 150_000.50m, "UZS", cash.Id, null, null, null, food.Id, now, null));
        _store.AddOperation(new Operation(0, OpKind.Transfer, 1_000_000m, "UZS", cash.Id, card.Id, null, null, null, now, null));
        _store.AddOperation(new Operation(0, OpKind.Transfer, 1_280_000m, "UZS", card.Id, usd.Id, 100m, null, null, now, null));

        Assert.Equal(3_849_999.50m, W("Naqd").Balance);
        Assert.Equal(-280_000m, W("Bank kartasi").Balance);
        Assert.Equal(100m, W("Dollar jamg'arma").Balance); // received amount in the target currency

        var month = Period.Of(PeriodKind.Month, now);
        Assert.Equal(5_000_000m, _store.Totals(OpKind.Income, month)[salary.Id]["UZS"]);
        Assert.Equal(150_000.50m, _store.Totals(OpKind.Expense, month)[food.Id]["UZS"]);
    }

    [Fact]
    public void Operation_sheet_blocks_overdraft_and_saves_valid_expense()
    {
        var saved = false;
        var food = _store.Categories()[0];
        var vm = new OperationViewModel(_store, OpKind.Expense, null, food.Id, () => saved = true, () => { });
        vm.PressCommand.Execute("5"); vm.PressCommand.Execute("000");

        Assert.NotNull(vm.Validate(out _)); // empty wallet: not enough money
        vm.SaveCommand.Execute(null);
        Assert.False(saved);

        var cash = W("Naqd");
        _store.AddOperation(new Operation(0, OpKind.Income, 10_000m, "UZS", cash.Id, null, null, _store.Sources()[0].Id, null, DateTime.Now, null));
        var vm2 = new OperationViewModel(_store, OpKind.Expense, cash.Id, food.Id, () => saved = true, () => { });
        vm2.PressCommand.Execute("5"); vm2.PressCommand.Execute("000");
        vm2.SaveCommand.Execute(null);
        Assert.True(saved);
        Assert.Equal(5_000m, W("Naqd").Balance);
    }

    [Fact]
    public void Transfer_across_currencies_needs_received_amount()
    {
        var card = W("Bank kartasi"); var usd = W("Dollar jamg'arma");
        _store.AddOperation(new Operation(0, OpKind.Income, 2_000_000m, "UZS", card.Id, null, null, _store.Sources()[0].Id, null, DateTime.Now, null));
        var vm = new OperationViewModel(_store, OpKind.Transfer, card.Id, usd.Id, () => { }, () => { });
        vm.PressCommand.Execute("1"); vm.PressCommand.Execute("000"); vm.PressCommand.Execute("000");

        Assert.True(vm.NeedsToAmount);
        Assert.Contains("USD", vm.Validate(out _));
        vm.ToAmountText = "78,5";
        Assert.Null(vm.Validate(out var op));
        Assert.Equal(78.5m, op!.ToAmount);
    }
}
