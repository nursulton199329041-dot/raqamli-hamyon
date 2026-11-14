using Hamyon.App.Data;
using Hamyon.App.Models;
using Hamyon.App.ViewModels;
using Xunit;

namespace Hamyon.App.Tests;

/// <summary>Period sheet, filters on History / Reports, home "+" tiles, "⋯" menu: guide, budgets, arranging.</summary>
public sealed class PanelTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-panel-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;

    public PanelTests() => _store = new LocalStore(_path);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    private void Expense(decimal amount, DateTime d, int cat = 0) =>
        _store.AddOperation(new Operation(0, OpKind.Expense, amount, "UZS", _store.Wallets()[0].Id, null, null, null, _store.Categories()[cat].Id, d, null));

    // ---- periods ----

    [Fact]
    public void Every_period_kind_has_the_right_bounds()
    {
        var d = new DateTime(2026, 11, 14, 15, 0, 0); // Saturday
        Assert.Equal((new DateTime(2026, 11, 9), new DateTime(2026, 11, 15)), Days(Period.Of(PeriodKind.Week, d)));
        Assert.Equal((new DateTime(2026, 11, 1), new DateTime(2026, 11, 30)), Days(Period.Of(PeriodKind.Month, d)));
        Assert.Equal((new DateTime(2026, 10, 1), new DateTime(2026, 12, 31)), Days(Period.Of(PeriodKind.Quarter, d)));
        Assert.Equal((new DateTime(2026, 7, 1), new DateTime(2026, 12, 31)), Days(Period.Of(PeriodKind.HalfYear, d)));
        Assert.Equal((new DateTime(2026, 1, 1), new DateTime(2026, 12, 31)), Days(Period.Of(PeriodKind.Year, d)));
        Assert.Equal((new DateTime(2026, 7, 1), new DateTime(2026, 9, 30)), Days(Period.Of(PeriodKind.Quarter, d).Shift(-1)));
        Assert.Equal((new DateTime(2027, 1, 1), new DateTime(2027, 6, 30)), Days(Period.Of(PeriodKind.HalfYear, d).Shift(1)));

        // custom: whole days, reversed input is fixed, shifting moves by its own length
        var c = Period.Custom(new DateTime(2026, 3, 10), new DateTime(2026, 3, 1));
        Assert.Equal((new DateTime(2026, 3, 1), new DateTime(2026, 3, 10)), Days(c));
        Assert.Equal(10, c.Days);
        Assert.Equal((new DateTime(2026, 2, 19), new DateTime(2026, 2, 28)), Days(c.Shift(-1)));
        Assert.False(Period.Of(PeriodKind.All, d).CanShift);
    }

    private static (DateTime, DateTime) Days(Period p) => (p.From, p.To.Date);

    [Fact]
    public void Period_sheet_marks_the_current_choice_and_returns_the_new_one()
    {
        Period? got = null;
        var closed = false;
        var vm = new PeriodPickerViewModel(Period.Of(PeriodKind.Quarter, DateTime.Now), p => got = p, () => closed = true);
        Assert.Equal(7, vm.Options.Count);
        Assert.True(vm.Options.Single(o => o.Kind == PeriodKind.Quarter).IsSelected);

        vm.ChooseCommand.Execute(vm.Options.Single(o => o.Kind == PeriodKind.HalfYear));
        Assert.Equal(PeriodKind.HalfYear, got!.Value.Kind);
        Assert.True(closed);

        // custom: the first tap opens the dates, "apply" returns the range
        vm.ChooseCommand.Execute(vm.Options.Single(o => o.IsCustom));
        Assert.True(vm.CustomOpen);
        vm.CustomFrom = new DateTimeOffset(new DateTime(2026, 1, 5));
        vm.CustomTo = new DateTimeOffset(new DateTime(2026, 2, 20));
        vm.ApplyCustomCommand.Execute(null);
        Assert.Equal(PeriodKind.Custom, got!.Value.Kind);
        Assert.Equal(new DateTime(2026, 1, 5), got.Value.From);
        Assert.Equal(new DateTime(2026, 2, 20), got.Value.To.Date);
    }

    [Fact]
    public void History_shows_any_period_from_the_filter()
    {
        var thisMonth = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        Expense(1000m, thisMonth.AddDays(1));
        Expense(2000m, thisMonth.AddMonths(-2).AddDays(3));

        var vm = new HistoryViewModel(_store, () => { });
        Assert.Single(vm.Days);
        vm.Period = Period.Custom(thisMonth.AddMonths(-3), DateTime.Today);
        Assert.Equal(2, vm.Days.Count);
        Assert.Equal(Money.Format(3000m, "UZS"), vm.Expense);
        vm.Period = Period.Of(PeriodKind.All, DateTime.Now);
        Assert.Equal(2, vm.Days.Count);
        Assert.False(vm.CanGoPrev);

        var opened = false;
        vm.OpenPeriod += () => opened = true;
        vm.PickPeriodCommand.Execute(null);
        Assert.True(opened);
    }

    [Fact]
    public void Reports_draw_days_for_short_periods_and_months_for_long_ones()
    {
        Expense(5000m, DateTime.Today);
        var vm = new ReportsViewModel(_store);
        vm.Period = Period.Of(PeriodKind.Week, DateTime.Now);
        Assert.Equal(7, vm.Bars.Count);
        Assert.Equal(5000d, vm.Bars.Sum());

        vm.Period = Period.Of(PeriodKind.Quarter, DateTime.Now);
        Assert.Equal(3, vm.Bars.Count);
        Assert.Equal(5000d, vm.Bars.Sum());

        vm.Period = Period.Of(PeriodKind.All, DateTime.Now);
        Assert.Equal(5000d, vm.Bars.Sum());
        Assert.Equal(Money.Format(5000m, "UZS"), vm.Total);
    }

    // ---- home ----

    [Fact]
    public void Each_section_ends_with_a_plus_tile_that_asks_for_a_new_item()
    {
        var home = new HomeViewModel(_store);
        Assert.True(home.Sources[^1].IsAdd);
        Assert.True(home.Wallets[^1].IsAdd);
        Assert.True(home.Categories[^1].IsAdd);
        Assert.Equal(_store.Wallets().Count, home.Wallets.Count(t => !t.IsAdd));

        CatalogKind? asked = null;
        home.AddItem += k => asked = k;
        home.OpenTileCommand.Execute(home.Wallets[^1]);
        Assert.Equal(CatalogKind.Wallets, asked);
        // "+" is never a drag source or target
        Assert.Null(HomeViewModel.DropKind(home.Wallets[0], home.Categories[^1]));
    }

    [Fact]
    public void Arrange_mode_moves_tiles_within_their_section_and_keeps_the_order()
    {
        var home = new HomeViewModel(_store);
        var names = home.Categories.Where(t => !t.IsAdd).Select(t => t.Name).ToList();
        home.ArrangeCommand.Execute(null);
        Assert.True(home.EditMode);

        // a wallet on a category means nothing while arranging; a category on another category moves it
        Assert.False(home.CanDrop(home.Wallets[0], home.Categories[0]));
        Assert.True(home.Drop(home.Categories[2], home.Categories[0]));
        var moved = home.Categories.Where(t => !t.IsAdd).Select(t => t.Name).ToList();
        Assert.Equal(names[2], moved[0]);
        Assert.Equal(names[0], moved[1]);
        Assert.Equal(moved, new HomeViewModel(_store).Categories.Where(t => !t.IsAdd).Select(t => t.Name).ToList());

        home.ArrangeDoneCommand.Execute(null);
        Assert.False(home.EditMode);
    }

    [Fact]
    public void Budget_shows_the_spent_share_and_turns_red_when_over()
    {
        var food = _store.Categories()[0];
        Expense(600_000m, DateTime.Today);
        var vm = new BudgetViewModel(_store, () => { }, () => { });
        vm.Rows.Single(r => r.Id == food.Id).Amount = "500 000";
        vm.SaveCommand.Execute(null);
        Assert.Equal(500_000m, _store.Budgets()[food.Id]);

        var home = new HomeViewModel(_store);
        var tile = home.Categories.Single(t => t.Id == food.Id);
        Assert.True(tile.HasBudget);
        Assert.True(tile.OverBudget);
        Assert.True(tile.Negative);
        Assert.False(home.Categories.Single(t => t.Id == _store.Categories()[1].Id).HasBudget);

        // the budget goes to the other phones too
        Assert.Contains(_store.PendingChanges(), d => d.Kind == "category" && d.Data.Contains("\"budget\":50000000"));
    }

    [Fact]
    public void Guide_walks_through_five_steps_and_reports_the_end()
    {
        var home = new HomeViewModel(_store);
        var finished = false;
        home.TourFinished += () => finished = true;
        home.StartTourCommand.Execute(null);
        Assert.True(home.Tour1);
        Assert.False(home.DimSources);
        Assert.True(home.DimWallets);
        for (var i = 1; i < HomeViewModel.TourSteps; i++) home.TourNextCommand.Execute(null);
        Assert.True(home.TourDrag);
        Assert.Equal(home.Sources[0], home.TourFrom); // last step: income → wallet
        home.TourNextCommand.Execute(null);
        Assert.False(home.TourOn);
        Assert.True(finished);
    }
}
