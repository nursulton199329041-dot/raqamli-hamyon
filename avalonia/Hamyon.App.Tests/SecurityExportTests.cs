using System.Text;
using Hamyon.App.Data;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using Hamyon.App.Services;
using Hamyon.App.ViewModels;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class SecurityTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-sec-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;

    private sealed class FakeBio(bool ok) : IBiometrics
    {
        public bool IsAvailable => true;
        public string Name => "Face ID";
        public int Calls;
        public Task<bool> AuthenticateAsync(string reason) { Calls++; return Task.FromResult(ok); }
    }

    public SecurityTests() => _store = new LocalStore(_path);

    public void Dispose()
    {
        Security.Biometrics = null;
        SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    private static void Type(LockViewModel vm, string digits)
    {
        foreach (var d in digits) vm.PressCommand.Execute(d.ToString());
    }

    [Fact]
    public void Password_on_asks_twice_then_locks_the_next_start()
    {
        var shell = new MainViewModel(_store);
        Assert.Null(shell.Lock); // no PIN yet: no lock

        shell.Settings.TogglePinCommand.Execute(null);
        var create = Assert.IsType<LockViewModel>(shell.Lock);
        Type(create, "1234");
        Assert.Equal(L.T("pin_repeat"), create.Title);
        Type(create, "9999"); // mismatch: start over
        Assert.Equal(L.T("pin_mismatch"), create.Error);
        Type(create, "1234");
        Type(create, "1234");
        Assert.Null(shell.Lock);
        Assert.True(shell.Settings.PinOn);
        Assert.DoesNotContain("1234", _store.GetSetting("pin_hash")); // only a salted hash is stored

        var next = new MainViewModel(_store);
        var unlock = Assert.IsType<LockViewModel>(next.Lock);
        Assert.False(next.HandleBack()); // back never skips the PIN
        Type(unlock, "0000");
        Assert.Equal(L.T("pin_wrong"), unlock.Error);
        Assert.NotNull(next.Lock);
        Type(unlock, "1234");
        Assert.Null(next.Lock);
    }

    [Fact]
    public void Password_off_needs_the_current_pin()
    {
        Security.SetPin(_store.SetSetting, "4321");
        var shell = new MainViewModel(_store);
        Type(shell.Lock!, "4321");

        shell.Settings.TogglePinCommand.Execute(null);
        var disable = Assert.IsType<LockViewModel>(shell.Lock);
        Assert.True(disable.CanCancel);
        Type(disable, "1111");
        Assert.True(shell.Settings.PinOn);
        Type(disable, "4321");
        Assert.False(shell.Settings.PinOn);
        Assert.False(Security.HasPin(_store.GetSetting));
        Assert.Null(new MainViewModel(_store).Lock);
    }

    [Fact]
    public async Task Face_id_unlocks_and_is_offered_only_when_switched_on()
    {
        var bio = new FakeBio(ok: true);
        Security.Biometrics = bio;
        Security.SetPin(_store.SetSetting, "1234");

        var shell = new MainViewModel(_store);
        Assert.False(shell.Lock!.ShowBiometric); // switched off: PIN only
        Type(shell.Lock!, "1234");

        await shell.Settings.ToggleBiometricCommand.ExecuteAsync(null);
        Assert.True(shell.Settings.BiometricOn);

        var next = new MainViewModel(_store); // start: Face ID is asked at once
        Assert.Null(next.Lock);
        Assert.True(bio.Calls >= 2);
    }

    [Fact]
    public void Failed_face_id_leaves_the_pin_pad()
    {
        Security.Biometrics = new FakeBio(ok: false);
        Security.SetPin(_store.SetSetting, "1234");
        _store.SetSetting("biometric", "1");
        var shell = new MainViewModel(_store);
        Assert.NotNull(shell.Lock);
        Assert.Contains(shell.Lock!.Keys, k => k.Key == "bio");
        Type(shell.Lock!, "1234");
        Assert.Null(shell.Lock);
    }
}

public sealed class ExportTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"hamyon-exp-{Guid.NewGuid():N}.db");
    private readonly LocalStore _store;

    public ExportTests()
    {
        _store = new LocalStore(_path);
        var cash = _store.Wallets()[0];
        var usd = _store.Wallets().Single(w => w.Currency == "USD");
        _store.AddOperation(new Operation(0, OpKind.Income, 1_000_000m, "UZS", cash.Id, null, null, _store.Sources()[0].Id, null, DateTime.Now, "oylik; noyabr"));
        _store.AddOperation(new Operation(0, OpKind.Expense, 20m, "USD", usd.Id, null, null, null, _store.Categories()[0].Id, DateTime.Now, null,
            BaseAmount: 256_000m, Rate: 12_800m));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_path);
    }

    [Fact]
    public void Csv_opens_in_excel_with_one_row_per_operation()
    {
        var vm = new ExportViewModel(_store, () => { });
        var (name, bytes) = vm.Build();
        Assert.EndsWith(".csv", name);
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes[..3]); // BOM: Excel reads UTF-8
        var lines = Encoding.UTF8.GetString(bytes[3..]).Trim().Split(Environment.NewLine);
        Assert.Equal(3, lines.Length);
        Assert.Contains("\"oylik; noyabr\"", lines[1]); // a ';' inside a note is quoted
        Assert.Contains(";20;USD;256000;12800;", lines[2]);
    }

    [Fact]
    public void Pdf_is_a_real_pdf_document()
    {
        var vm = new ExportViewModel(_store, () => { });
        vm.SelectFormatCommand.Execute(vm.Formats.Single(f => f.Key == "pdf"));
        var (name, bytes) = vm.Build();
        Assert.EndsWith(".pdf", name);
        Assert.Equal("%PDF", Encoding.ASCII.GetString(bytes, 0, 4));
        Assert.True(bytes.Length > 1000);
    }

    [Fact]
    public void Period_choice_limits_the_rows()
    {
        var vm = new ExportViewModel(_store, () => { });
        vm.SelectPeriodCommand.Execute(vm.Periods.Single(p => p.Key == "prev"));
        var lines = Encoding.UTF8.GetString(vm.Build().Bytes[3..]).Trim().Split(Environment.NewLine);
        Assert.Single(lines); // header only: nothing last month
    }

    [Fact]
    public void Delete_operations_only_keeps_the_catalog()
    {
        var shell = new MainViewModel(_store);
        shell.Settings.WipeOperationsCommand.Execute(null);
        Assert.Empty(_store.Operations(DateTime.MinValue, DateTime.MaxValue.AddDays(-1)));
        Assert.Equal(3, _store.Wallets().Count);
        Assert.All(_store.Wallets(), w => Assert.Equal(0, w.Balance));
    }
}
