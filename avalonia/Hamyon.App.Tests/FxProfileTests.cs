using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using Hamyon.App.Services;
using Hamyon.App.ViewModels;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class FxTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-fx-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;
    private readonly Wallet _usd;

    public FxTests()
    {
        _store = new LocalStore(_path);
        _usd = _store.Wallets().Single(w => w.Currency == "USD");
        _store.AddOperation(new Operation(0, OpKind.Income, 500m, "USD", _usd.Id, null, null, _store.Sources()[0].Id, null, DateTime.Now, null));
    }

    public void Dispose()
    {
        Rates.Fetch = Rates.FetchCbuAsync;
        SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    private OperationViewModel Expense(Action onSaved) =>
        new(_store, OpKind.Expense, _usd.Id, _store.Categories()[0].Id, onSaved, () => { });

    [Fact]
    public void Dollar_expense_charges_the_wallet_in_dollars_and_the_category_in_som()
    {
        Rates.Fetch = (_, _) => Task.FromResult<decimal?>(12_800m);
        var saved = false;
        var vm = Expense(() => saved = true);
        Assert.True(vm.NeedsRate);
        Assert.Equal("12800", vm.RateText); // official rate arrived (stub completes synchronously)
        Assert.Equal(L.T("rate_hint_cbu"), vm.RateHint);

        vm.PressCommand.Execute("2"); vm.PressCommand.Execute("0");
        Assert.Equal("≈ " + Money.Format(256_000m, "UZS"), vm.BaseText);
        vm.SaveCommand.Execute(null);
        Assert.True(saved);

        Assert.Equal(480m, _store.Wallets().Single(w => w.Id == _usd.Id).Balance); // −20 USD
        var month = Period.Of(PeriodKind.Month, DateTime.Now);
        Assert.Equal(256_000m, _store.Totals(OpKind.Expense, month)[_store.Categories()[0].Id]["UZS"]); // category in so'm
        Assert.Equal(12_800m, Rates.Saved(_store, "USD")); // today's official rate is remembered

        var history = new HistoryViewModel(_store, () => { });
        var row = history.Days.SelectMany(d => d.Rows).Single(r => r.Kind == OpKind.Expense);
        Assert.Equal("−" + Money.Format(256_000m, "UZS"), row.Amount);
        Assert.Contains("20 USD", row.Subtitle);
    }

    [Fact]
    public void Offline_uses_the_last_known_rate_and_a_typed_rate_wins()
    {
        Rates.Fetch = (_, _) => Task.FromResult<decimal?>(null); // offline
        Rates.Save(_store, "USD", 12_700m);
        var vm = Expense(() => { });
        Assert.Equal("12700", vm.RateText);
        Assert.Equal(L.T("rate_hint_last"), vm.RateHint);

        vm.RateText = "13000";
        vm.PressCommand.Execute("1"); vm.PressCommand.Execute("0");
        Assert.Null(vm.Validate(out var op));
        Assert.Equal(130_000m, op!.BaseAmount);
        Assert.Equal(13_000m, op.Rate);
    }

    [Fact]
    public void Without_any_rate_the_user_must_type_one()
    {
        Rates.Fetch = (_, _) => Task.FromResult<decimal?>(null);
        var vm = Expense(() => { });
        Assert.Equal("", vm.RateText);
        vm.PressCommand.Execute("5");
        Assert.Equal(L.T("err_rate", "USD"), vm.Validate(out _));
    }

    [Fact]
    public void Som_wallet_expense_needs_no_rate()
    {
        var vm = new OperationViewModel(_store, OpKind.Expense, _store.Wallets()[0].Id, _store.Categories()[0].Id, () => { }, () => { });
        Assert.False(vm.NeedsRate);
    }
}

public sealed class ProfileTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"hamyon-profiles-{Guid.NewGuid():N}");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, recursive: true);
        L.Current = Lang.Uz;
    }

    [Fact]
    public void Existing_book_becomes_the_first_profile_and_keeps_its_records_and_language()
    {
        Directory.CreateDirectory(_dir);
        var old = new LocalStore(Path.Combine(_dir, "hamyon.db"));
        old.AddOperation(new Operation(0, OpKind.Income, 1000m, "UZS", old.Wallets()[0].Id, null, null, old.Sources()[0].Id, null, DateTime.Now, null));
        old.SetSetting("lang", "Ru");

        var profiles = new ProfileStore(_dir);
        Assert.Equal(ProfileStore.MainId, profiles.CurrentId);
        Assert.Equal(1000m, profiles.OpenCurrent().Wallets()[0].Balance);
        Assert.Equal("Ru", profiles.GetPref("lang"));
    }

    [Fact]
    public void Profiles_are_separate_books()
    {
        var profiles = new ProfileStore(_dir);
        var main = profiles.OpenCurrent();
        main.AddOperation(new Operation(0, OpKind.Income, 5000m, "UZS", main.Wallets()[0].Id, null, null, main.Sources()[0].Id, null, DateTime.Now, null));

        var family = profiles.Create("Oila", "#EC4899");
        profiles.CurrentId = family.Id;
        var book = profiles.OpenCurrent();
        Assert.All(book.Wallets(), w => Assert.Equal(0, w.Balance)); // nothing leaks across
        Assert.Equal(3, book.Wallets().Count);                       // default catalog

        profiles.Update(family.Id, "Oilaviy", "#3B82F6");
        Assert.Equal("Oilaviy", profiles.Current.Name);
        profiles.CurrentId = ProfileStore.MainId;
        Assert.Equal(5000m, profiles.OpenCurrent().Wallets()[0].Balance);
    }

    [Fact]
    public void New_profile_from_the_sheet_switches_to_it()
    {
        var profiles = new ProfileStore(_dir);
        var shell = new MainViewModel(profiles);
        var switched = false;
        shell.ProfileSwitched += () => switched = true;

        shell.Home.ShowProfilesCommand.Execute(null);
        var sheet = Assert.IsType<ProfilesViewModel>(shell.Sheet);
        Assert.Single(sheet.Items);

        sheet.NewCommand.Execute(null);
        sheet.SaveEditCommand.Execute(null);
        Assert.Equal(L.T("err_name"), sheet.Error);
        sheet.EditName = "Biznes";
        sheet.SaveEditCommand.Execute(null);

        Assert.True(switched);
        Assert.Equal("Biznes", profiles.Current.Name);
        Assert.Equal("Biznes", new MainViewModel(profiles).Home.ProfileName);
    }

    [Fact]
    public void Language_is_app_wide_across_profiles()
    {
        var profiles = new ProfileStore(_dir);
        var shell = new MainViewModel(profiles);
        shell.Settings.SelectLanguageCommand.Execute(shell.Settings.Languages[1]); // Русский
        var other = profiles.Create("Oila", "#EC4899");
        profiles.CurrentId = other.Id;
        L.Current = Lang.Uz;
        _ = new MainViewModel(profiles);
        Assert.Equal(Lang.Ru, L.Current);
    }
}
