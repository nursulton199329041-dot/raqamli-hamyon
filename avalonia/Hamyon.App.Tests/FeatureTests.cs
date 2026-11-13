using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using Hamyon.App.ViewModels;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class FeatureTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-feature-{Guid.NewGuid():N}.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_path);
        L.Current = Lang.Uz;
    }

    [Fact]
    public void Book_from_the_first_release_upgrades_without_losing_records()
    {
        // the schema the first APK shipped with: no archived columns, no person, no settings, user_version 0
        using (var c = new SqliteConnection($"Data Source={_path}"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE wallets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
                  currency TEXT NOT NULL, opening_minor INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE operations (id INTEGER PRIMARY KEY, kind INTEGER NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
                  wallet_id INTEGER, to_wallet_id INTEGER, to_amount_minor INTEGER, source_id INTEGER, category_id INTEGER, date TEXT NOT NULL, note TEXT);
                INSERT INTO wallets(id, name, icon, color, currency) VALUES (1, 'Naqd', 'cash', '#1FCB8B', 'UZS');
                INSERT INTO sources(id, name, icon, color) VALUES (1, 'Ish haqi', 'salary', '#1FCB8B');
                INSERT INTO categories(id, name, icon, color) VALUES (1, 'Oziq-ovqat', 'food', '#F97316');
                INSERT INTO operations(kind, amount_minor, currency, wallet_id, source_id, date) VALUES (1, 50000000, 'UZS', 1, 1, '2026-11-13T10:00:00');
                """;
            cmd.ExecuteNonQuery();
        }
        SqliteConnection.ClearAllPools();

        var store = new LocalStore(_path);

        Assert.Equal(500_000m, store.Wallets().Single().Balance); // the old record is still there
        Assert.Single(store.Sources());
        store.SetSetting("lang", "Ru");
        Assert.Equal("Ru", store.GetSetting("lang"));
        store.AddOperation(new Operation(0, OpKind.Lend, 100_000m, "UZS", 1, null, null, null, null, DateTime.Now, null, "Akmal"));
        Assert.Equal(400_000m, store.Wallets().Single().Balance);

        SqliteConnection.ClearAllPools();
        _ = new LocalStore(_path); // opening again is a no-op
        Assert.Equal(400_000m, new LocalStore(_path).Wallets().Single().Balance);
    }

    [Fact]
    public void Debts_lend_borrow_and_repay_move_wallet_money_and_settle()
    {
        var store = new LocalStore(_path);
        var cash = store.Wallets()[0];
        store.AddOperation(new Operation(0, OpKind.Income, 1_000_000m, "UZS", cash.Id, null, null, store.Sources()[0].Id, null, DateTime.Now, null));

        store.AddOperation(new Operation(0, OpKind.Lend, 300_000m, "UZS", cash.Id, null, null, null, null, DateTime.Now, null, "Akmal"));
        store.AddOperation(new Operation(0, OpKind.Borrow, 50_000m, "UZS", cash.Id, null, null, null, null, DateTime.Now, null, "Dilnoza"));
        Assert.Equal(750_000m, store.Wallets()[0].Balance);

        var debts = new DebtsViewModel(store, () => { }, _ => { }, () => { });
        Assert.Equal(2, debts.Items.Count);
        var akmal = debts.Items.Single(d => d.Person == "Akmal");
        Assert.True(akmal.TheyOwe);

        // "repaid" opens the opposite operation with person and amount filled in
        ViewModelBase? sheet = null;
        var vm = new DebtsViewModel(store, () => { }, s => sheet = s, () => { });
        vm.RepayCommand.Execute(vm.Items.Single(d => d.Person == "Akmal"));
        var op = Assert.IsType<OperationViewModel>(sheet);
        Assert.Equal(OpKind.Borrow, op.Kind);
        Assert.Equal("Akmal", op.Person);
        op.SaveCommand.Execute(null);

        Assert.Equal(1_050_000m, store.Wallets()[0].Balance);
        Assert.DoesNotContain(store.Debts(), d => d.Person == "Akmal"); // settled: gone from the list
        Assert.Contains(store.Debts(), d => d.Person == "Dilnoza" && d.Balance == -50_000m);
    }

    [Fact]
    public void Lending_more_than_the_wallet_holds_is_refused_and_person_is_required()
    {
        var store = new LocalStore(_path);
        var vm = new OperationViewModel(store, OpKind.Lend, null, null, () => { }, () => { });
        vm.PressCommand.Execute("5"); vm.PressCommand.Execute("000");
        Assert.Equal(L.T("err_person"), vm.Validate(out _));
        vm.Person = "Akmal";
        Assert.StartsWith(L.T("err_funds", "").Split('(')[0], vm.Validate(out _)); // empty wallet
    }

    [Fact]
    public void Catalog_add_edit_archive()
    {
        var store = new LocalStore(_path);
        var id = store.AddWallet("Humo", "card", "#3B82F6", "UZS", 250_000m);
        Assert.Equal(250_000m, store.Wallets().Single(w => w.Id == id).Balance); // opening balance counts

        store.UpdateWallet(id, "Humo karta", "card", "#EF4444");
        Assert.Equal("Humo karta", store.Wallets().Single(w => w.Id == id).Name);

        // an editor refuses to archive a wallet that still holds money
        var item = new ChoiceVm { Id = id, Name = "Humo karta", Icon = "card", Color = "#EF4444" };
        var done = false;
        var editor = new EditorViewModel(store, CatalogKind.Wallets, item, () => done = true, () => { });
        editor.ArchiveCommand.Execute(null);
        Assert.False(done);
        Assert.NotNull(editor.Error);

        var cat = store.AddNamed("categories", "Kiyim", "fun", "#EC4899");
        Assert.Contains(store.Categories(), c => c.Name == "Kiyim");
        store.ArchiveNamed("categories", cat);
        Assert.DoesNotContain(store.Categories(), c => c.Name == "Kiyim");

        var add = new EditorViewModel(store, CatalogKind.Sources, null, () => done = true, () => { });
        add.SaveCommand.Execute(null);
        Assert.Equal(L.T("err_name"), add.Error);
        add.Name = "Freelance";
        add.SaveCommand.Execute(null);
        Assert.True(done);
        Assert.Contains(store.Sources(), s => s.Name == "Freelance");
    }

    [Fact]
    public void Wipe_starts_a_fresh_book_but_keeps_settings()
    {
        var store = new LocalStore(_path);
        store.SetSetting("accent", "#4D8DFF");
        store.AddOperation(new Operation(0, OpKind.Income, 10m, "UZS", store.Wallets()[0].Id, null, null, store.Sources()[0].Id, null, DateTime.Now, null));
        store.Wipe();
        Assert.All(store.Wallets(), w => Assert.Equal(0, w.Balance));
        Assert.Equal(3, store.Wallets().Count);
        Assert.Equal("#4D8DFF", store.GetSetting("accent"));
    }

    [Fact]
    public void Every_string_exists_in_three_languages()
    {
        foreach (var lang in new[] { Lang.Uz, Lang.Ru, Lang.En })
        {
            L.Current = lang;
            Assert.NotEqual("tab_home", L.T("tab_home"));
            Assert.Equal(12, Enumerable.Range(1, 12).Select(L.Month).Distinct().Count());
        }
        L.Current = Lang.Ru;
        Assert.Equal("ГЛАВНАЯ", L.T("tab_home"));
        L.Current = Lang.En;
        Assert.Equal("Not enough money in the wallet (5 UZS)", L.T("err_funds", "5 UZS"));
    }
}

public sealed class ShellTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-shell-{Guid.NewGuid():N}.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_path);
        L.Current = Lang.Uz;
    }

    [Fact]
    public void Back_closes_sheet_then_subpage_then_returns_home()
    {
        var shell = new MainViewModel(new LocalStore(_path));
        Assert.False(shell.HandleBack()); // home, nothing open: the system may leave the app

        shell.SelectTabCommand.Execute(shell.Tabs[3]);
        shell.Settings.OpenDebtsCommand.Execute(null);
        Assert.IsType<DebtsViewModel>(shell.Current);
        ((DebtsViewModel)shell.Current).LendCommand.Execute(null);
        Assert.NotNull(shell.Sheet);

        Assert.True(shell.HandleBack());
        Assert.Null(shell.Sheet);
        Assert.True(shell.HandleBack());
        Assert.Same(shell.Settings, shell.Current);
        Assert.True(shell.HandleBack());
        Assert.Same(shell.Home, shell.Current);
        Assert.True(shell.Tabs[0].IsActive);
    }

    [Fact]
    public void Language_is_remembered_in_the_book()
    {
        var store = new LocalStore(_path);
        var shell = new MainViewModel(store);
        var changed = false;
        shell.LanguageChanged += () => changed = true;
        shell.Settings.SelectLanguageCommand.Execute(shell.Settings.Languages[2]);
        Assert.True(changed);
        Assert.Equal("En", store.GetSetting("lang"));

        L.Current = Lang.Uz;
        _ = new MainViewModel(store); // next start reads it back
        Assert.Equal(Lang.En, L.Current);
    }
}
