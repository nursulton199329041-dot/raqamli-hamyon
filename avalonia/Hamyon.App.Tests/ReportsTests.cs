using Hamyon.App.Data;
using Hamyon.App.Models;
using Hamyon.App.ViewModels;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class ReportsTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-reports-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;
    private static readonly DateTime Mid = new(DateTime.Today.Year, DateTime.Today.Month, 10);

    public ReportsTests()
    {
        _store = new LocalStore(_path);
        var cash = _store.Wallets()[0];
        var usd = _store.Wallets().Single(w => w.Currency == "USD");
        var cats = _store.Categories();
        void Exp(long cat, decimal amount, DateTime d, long wallet, string cur) =>
            _store.AddOperation(new Operation(0, OpKind.Expense, amount, cur, wallet, null, null, null, cat, d, null));

        _store.AddOperation(new Operation(0, OpKind.Income, 10_000_000m, "UZS", cash.Id, null, null, _store.Sources()[0].Id, null, Mid, null));
        _store.AddOperation(new Operation(0, OpKind.Income, 500m, "USD", usd.Id, null, null, _store.Sources()[1].Id, null, Mid, null));
        Exp(cats[0].Id, 300_000m, Mid, cash.Id, "UZS");            // food
        Exp(cats[0].Id, 100_000m, Mid.AddDays(1), cash.Id, "UZS"); // food again, next day
        Exp(cats[1].Id, 100_000m, Mid, cash.Id, "UZS");            // transport
        Exp(cats[1].Id, 20m, Mid, usd.Id, "USD");                  // a dollar expense must not leak into the so'm report
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    [Fact]
    public void Month_expense_breakdown_shares_and_top_category()
    {
        var vm = new ReportsViewModel(_store);

        Assert.Equal(Money.Format(500_000m, "UZS"), vm.Total);
        Assert.Equal(2, vm.Breakdown.Count);
        Assert.Equal("Oziq-ovqat", vm.Breakdown[0].Name);
        Assert.Equal("80%", vm.Breakdown[0].Percent);
        Assert.Equal("20%", vm.Breakdown[1].Percent);
        Assert.Equal("Oziq-ovqat", vm.TopName);
        Assert.Equal(DateTime.DaysInMonth(Mid.Year, Mid.Month), vm.Bars.Count);
        Assert.Equal(400_000d, vm.Bars[Mid.Day - 1]);
        Assert.Equal(100_000d, vm.Bars[Mid.Day]);
    }

    [Fact]
    public void Currencies_are_reported_separately()
    {
        var vm = new ReportsViewModel(_store);
        Assert.Equal(new[] { "UZS", "USD" }, vm.Currencies.Select(c => c.Key));
        vm.SelectCurrencyCommand.Execute(vm.Currencies[1]);
        Assert.Equal(Money.Format(20m, "USD"), vm.Total);
        Assert.Single(vm.Breakdown);
    }

    [Fact]
    public void Income_and_year_view()
    {
        var vm = new ReportsViewModel(_store);
        vm.SelectKindCommand.Execute(vm.Kinds[1]);
        Assert.Equal(Money.Format(10_000_000m, "UZS"), vm.Total);
        Assert.Equal("Ish haqi", vm.TopName);

        vm.SelectRangeCommand.Execute(vm.Ranges[1]);
        Assert.Equal(12, vm.Bars.Count);
        Assert.Equal(10_000_000d, vm.Bars[Mid.Month - 1]);
        Assert.False(vm.CanGoNext);
    }

    [Theory]
    [InlineData(10_480_000, "10 mln")]
    [InlineData(1_250_000, "1,3 mln")]
    [InlineData(380_000, "380 ming")]
    [InlineData(950, "950")]
    public void Compact_axis_labels(decimal v, string expected) => Assert.Equal(expected, Money.Compact(v));
}

public class ChartAxisTests
{
    [Theory]
    [InlineData(150_000, 200_000)]
    [InlineData(3_500_000, 5_000_000)]
    [InlineData(2_400, 2_500)]
    [InlineData(1_000, 1_000)]
    [InlineData(0, 1)]
    public void Gridline_steps_are_round(double raw, double expected) =>
        Assert.Equal(expected, Hamyon.App.Controls.BarChart.NiceStep(raw));
}
