using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using Hamyon.App.ViewModels;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class ItemPageTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-item-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;
    private readonly Wallet _cash, _card;
    private readonly long _salary, _food, _transport;

    public ItemPageTests()
    {
        _store = new LocalStore(_path);
        _cash = _store.Wallets()[0];
        _card = _store.Wallets()[1];
        _salary = _store.Sources()[0].Id;
        _food = _store.Categories()[0].Id;
        _transport = _store.Categories()[1].Id;
        var now = DateTime.Now;
        _store.AddOperation(new Operation(0, OpKind.Income, 1_000_000m, "UZS", _cash.Id, null, null, _salary, null, now, "oylik"));
        _store.AddOperation(new Operation(0, OpKind.Expense, 200_000m, "UZS", _cash.Id, null, null, null, _food, now, "bozor"));
        _store.AddOperation(new Operation(0, OpKind.Expense, 50_000m, "UZS", _cash.Id, null, null, null, _transport, now, null));
        _store.AddOperation(new Operation(0, OpKind.Transfer, 300_000m, "UZS", _cash.Id, _card.Id, null, null, null, now, null));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    private ItemViewModel Page(TileKind kind, long id, Action<ViewModelBase?>? sheet = null) =>
        new(_store, kind, id, () => { }, sheet ?? (_ => { }), () => { });

    [Fact]
    public void Wallet_page_lists_everything_touching_it_and_the_period_saldo()
    {
        var page = Page(TileKind.Wallet, _cash.Id);
        Assert.Equal("Naqd", page.Name);
        Assert.Equal(4, page.Days.SelectMany(d => d.Rows).Count());
        Assert.Equal(Money.Format(450_000m, "UZS"), page.Saldo); // +1 000 000 − 200 000 − 50 000 − 300 000
        Assert.Equal(Money.Format(450_000m, "UZS"), page.Balance);

        var card = Page(TileKind.Wallet, _card.Id);
        Assert.Equal(Money.Format(300_000m, "UZS"), card.Saldo); // transfer arriving
    }

    [Fact]
    public void Category_and_source_pages_show_only_their_operations()
    {
        var food = Page(TileKind.Category, _food);
        Assert.Single(food.Days.SelectMany(d => d.Rows));
        Assert.Equal(Money.Format(200_000m, "UZS"), food.Saldo);

        var salary = Page(TileKind.Source, _salary);
        Assert.Single(salary.Days.SelectMany(d => d.Rows));
    }

    [Fact]
    public void Note_search_and_filter_narrow_the_list()
    {
        var page = Page(TileKind.Wallet, _cash.Id);
        page.Search = "bozor";
        Assert.Single(page.Days.SelectMany(d => d.Rows));
        page.Search = null;

        // hide the food category: its expense disappears, the saldo follows
        page.OpenFilterCommand.Execute(null);
        page.ToggleFilterItemCommand.Execute(page.FilterCategories.Single(c => c.Id == _food));
        Assert.Equal("6 / 7", page.CategoriesCount);
        page.ApplyFilterCommand.Execute(null);
        Assert.True(page.HasFilter);
        Assert.Equal(3, page.Days.SelectMany(d => d.Rows).Count());
        Assert.Equal(Money.Format(650_000m, "UZS"), page.Saldo);

        // "clear all" then "select all"
        page.OpenFilterCommand.Execute(null);
        page.ToggleAllSourcesCommand.Execute(null);
        Assert.Equal("0 / 3", page.SourcesCount);
        Assert.Equal(L.T("select_all"), page.SourcesToggleText);
        page.CloseFilterCommand.Execute(null); // not applied: back to the applied state
        Assert.Equal("3 / 3", page.SourcesCount);
    }

    [Fact]
    public void Period_moves_by_month_quarter_and_year()
    {
        var page = Page(TileKind.Wallet, _cash.Id);
        page.PrevCommand.Execute(null);
        Assert.True(page.IsEmpty);
        page.NextCommand.Execute(null);
        page.CycleRangeCommand.Execute(null);
        Assert.Equal(RangeKind.Quarter, page.Range);
        var (from, to) = page.Bounds;
        Assert.Equal(0, (from.Month - 1) % 3); // quarters start in Jan, Apr, Jul, Oct
        Assert.Equal(3, (to.Year - from.Year) * 12 + to.Month - from.Month + 1);
        page.CycleRangeCommand.Execute(null);
        Assert.Equal(new DateTime(DateTime.Today.Year, 1, 1), page.Bounds.From);
    }

    [Fact]
    public void Plus_opens_the_right_sheet_with_this_item_chosen()
    {
        ViewModelBase? sheet = null;
        var wallet = Page(TileKind.Wallet, _card.Id, s => sheet = s);
        wallet.PlusCommand.Execute(null);
        Assert.True(wallet.MenuOpen); // a wallet asks which kind
        wallet.NewIncomeCommand.Execute(null);
        var op = Assert.IsType<OperationViewModel>(sheet);
        Assert.Equal(OpKind.Income, op.Kind);
        Assert.Equal(_card.Id, op.To.Single(x => x.IsSelected).Id);

        var category = Page(TileKind.Category, _transport, s => sheet = s);
        category.PlusCommand.Execute(null); // straight to an expense
        op = Assert.IsType<OperationViewModel>(sheet);
        Assert.Equal(OpKind.Expense, op.Kind);
        Assert.Equal(_transport, op.To.Single(x => x.IsSelected).Id);
    }

    [Fact]
    public void Pencil_renames_and_corrects_the_wallet_balance()
    {
        ViewModelBase? sheet = null;
        var page = Page(TileKind.Wallet, _cash.Id, s => sheet = s);
        page.EditItemCommand.Execute(null);
        var editor = Assert.IsType<EditorViewModel>(sheet);
        Assert.True(editor.ShowBalance);
        Assert.Equal("450000", editor.BalanceText);

        editor.Name = "Hamyon";
        editor.BalanceText = "500000";
        editor.SaveCommand.Execute(null);

        var w = _store.Wallets().Single(x => x.Id == _cash.Id);
        Assert.Equal("Hamyon", w.Name);
        Assert.Equal(500_000m, w.Balance);
        Assert.Equal(4, _store.Operations(DateTime.MinValue, DateTime.MaxValue.AddDays(-1)).Count); // history untouched
    }

    [Fact]
    public void Home_blocks_follow_the_settings_ticks()
    {
        var shell = new MainViewModel(_store);
        Assert.True(shell.Home.ShowBalance);
        var balance = shell.Settings.HomeBlocks.Single(b => b.Key == "balance");
        shell.Settings.ToggleBlockCommand.Execute(balance);
        Assert.False(balance.IsOn);
        Assert.False(shell.Home.ShowBalance);

        // remembered on the next start
        Assert.False(new MainViewModel(_store).Home.ShowBalance);
        Assert.True(new MainViewModel(_store).Home.ShowWallets);
    }

    [Fact]
    public void Tapping_a_home_tile_opens_its_page_and_back_returns_home()
    {
        var shell = new MainViewModel(_store);
        shell.Home.OpenTileCommand.Execute(shell.Home.Wallets[0]);
        var page = Assert.IsType<ItemViewModel>(shell.Current);
        page.PlusCommand.Execute(null);
        Assert.True(shell.HandleBack()); // closes the "+" menu first
        Assert.False(page.MenuOpen);
        Assert.True(shell.HandleBack());
        Assert.Same(shell.Home, shell.Current);
    }
}
