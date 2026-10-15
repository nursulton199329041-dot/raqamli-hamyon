using System.Net;
using System.Net.Http.Json;
using Hamyon.Api.Contracts;
using Hamyon.Api.Endpoints;
using Hamyon.Domain;
using Xunit;

namespace Hamyon.Tests;

public class LedgerTests(TestApp app) : IClassFixture<TestApp>
{
    private static async Task<PagedResult<TransactionDto>> ListAsync(ApiUser u, string query = "") =>
        (await u.Http.GetFromJsonAsync<PagedResult<TransactionDto>>("/api/transactions" + query))!;

    private static async Task AssertBooksBalancedAsync(ApiUser u)
    {
        var rec = await u.Http.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/reconciliation");
        Assert.True(rec.GetProperty("ok").GetBoolean(), rec.ToString());
    }

    [Fact]
    public async Task Income_increases_balance()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Naqd");
        var src = await u.SourceAsync("Maosh");
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 150_000.50m, src.Id));
        Assert.Equal(150_000.50m, await u.BalanceAsync(w.Id));
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Expense_decreases_balance()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Karta", 100_000);
        var cat = await u.CategoryAsync("Kommunal-x");
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 40_000, cat.Id));
        Assert.Equal(60_000m, await u.BalanceAsync(w.Id));
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Opening_balance_is_a_ledger_entry_not_income()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Spark 4775", 500_000);
        Assert.Equal(500_000m, w.Balance);
        // Opening entries are excluded from reversal and from income statistics.
        var income = await ListAsync(u, "?type=" + (int)TransactionType.Income);
        Assert.Empty(income.Items);
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Transfer_keeps_total_and_creates_one_linked_entry()
    {
        var u = await app.RegisterAsync();
        var a = await u.WalletAsync("Spark", 1_000);
        var b = await u.WalletAsync("Nexia", 200);
        var r = await u.OkAsync<OperationResult>(await u.TransferAsync(a.Id, b.Id, 300));
        Assert.Equal(700m, await u.BalanceAsync(a.Id));
        Assert.Equal(500m, await u.BalanceAsync(b.Id));
        Assert.Equal(TransactionType.Transfer, r.Transaction.Type);
        Assert.Equal(b.Id, r.Transaction.ToWalletId);
        // no income / expense produced
        Assert.Empty((await ListAsync(u, $"?type={(int)TransactionType.Income}")).Items);
        Assert.Empty((await ListAsync(u, $"?type={(int)TransactionType.Expense}")).Items);
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Transfer_to_same_wallet_is_rejected()
    {
        var u = await app.RegisterAsync();
        var a = await u.WalletAsync("A", 100);
        var err = await u.ErrorAsync(await u.TransferAsync(a.Id, a.Id, 10), HttpStatusCode.BadRequest);
        Assert.Equal("transfer.same_wallet", err.Code);
        Assert.Equal(100m, await u.BalanceAsync(a.Id));
    }

    [Fact]
    public async Task Insufficient_funds_is_rejected_and_balance_unchanged()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Small", 50);
        var cat = await u.CategoryAsync("X1");
        var err = await u.ErrorAsync(await u.ExpenseAsync(w.Id, 51, cat.Id), HttpStatusCode.UnprocessableEntity);
        Assert.Equal("wallet.insufficient_funds", err.Code);
        Assert.Equal(50m, await u.BalanceAsync(w.Id));
        Assert.Empty((await ListAsync(u, $"?type={(int)TransactionType.Expense}")).Items);
    }

    [Fact]
    public async Task Overdraft_wallet_may_go_negative()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Credit", 0, overdraft: true);
        var cat = await u.CategoryAsync("X2");
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 75, cat.Id));
        Assert.Equal(-75m, await u.BalanceAsync(w.Id));
    }

    [Fact]
    public async Task Parallel_expenses_never_overdraw()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Race", 100);
        var cat = await u.CategoryAsync("Race-cat");
        var tasks = Enumerable.Range(0, 30).Select(_ => u.ExpenseAsync(w.Id, 10, cat.Id)).ToArray();
        var results = await Task.WhenAll(tasks);
        var ok = results.Count(r => r.StatusCode == HttpStatusCode.OK);
        var rejected = results.Count(r => r.StatusCode == HttpStatusCode.UnprocessableEntity);
        Assert.Equal(10, ok);
        Assert.Equal(20, rejected);
        Assert.Equal(0m, await u.BalanceAsync(w.Id));
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Parallel_transfers_keep_total_constant()
    {
        var u = await app.RegisterAsync();
        var a = await u.WalletAsync("PA", 1_000);
        var b = await u.WalletAsync("PB", 1_000);
        var tasks = Enumerable.Range(0, 40).Select(i =>
            i % 2 == 0 ? u.TransferAsync(a.Id, b.Id, 30) : u.TransferAsync(b.Id, a.Id, 20)).ToArray();
        var results = await Task.WhenAll(tasks);
        Assert.All(results, r => Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.UnprocessableEntity));
        Assert.Equal(2_000m, await u.BalanceAsync(a.Id) + await u.BalanceAsync(b.Id));
        Assert.True(await u.BalanceAsync(a.Id) >= 0 && await u.BalanceAsync(b.Id) >= 0);
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Same_idempotency_key_executes_once()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Idem", 0);
        var key = Guid.NewGuid().ToString();
        var r1 = await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 500, key: key));
        var r2 = await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 500, key: key));
        Assert.False(r1.Replayed);
        Assert.True(r2.Replayed);
        Assert.Equal(r1.Transaction.Id, r2.Transaction.Id);
        Assert.Equal(500m, await u.BalanceAsync(w.Id));
    }

    [Fact]
    public async Task Idempotency_key_reused_with_different_body_conflicts()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Idem2", 0);
        var key = Guid.NewGuid().ToString();
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 500, key: key));
        var err = await u.ErrorAsync(await u.IncomeAsync(w.Id, 900, key: key), HttpStatusCode.Conflict);
        Assert.Equal("idempotency.key_reused", err.Code);
        Assert.Equal(500m, await u.BalanceAsync(w.Id));
    }

    [Fact]
    public async Task Concurrent_requests_with_same_key_create_one_entry()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Idem3", 0);
        var key = Guid.NewGuid().ToString();
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => u.IncomeAsync(w.Id, 100, key: key)));
        Assert.All(results, r => Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict));
        Assert.Equal(100m, await u.BalanceAsync(w.Id));
        Assert.Single((await ListAsync(u, $"?type={(int)TransactionType.Income}")).Items);
    }

    [Fact]
    public async Task Reversal_restores_balance_and_is_idempotent()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Rev", 1_000);
        var cat = await u.CategoryAsync("Rev-cat");
        var exp = await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 400, cat.Id));
        Assert.Equal(600m, await u.BalanceAsync(w.Id));

        var rev = await u.OkAsync<OperationResult>(await u.Http.PostAsync($"/api/transactions/{exp.Transaction.Id}/reverse", null));
        Assert.Equal(TransactionType.Reversal, rev.Transaction.Type);
        Assert.Equal(1_000m, await u.BalanceAsync(w.Id));

        var again = await u.OkAsync<OperationResult>(await u.Http.PostAsync($"/api/transactions/{exp.Transaction.Id}/reverse", null));
        Assert.True(again.Replayed);
        Assert.Equal(1_000m, await u.BalanceAsync(w.Id));

        // original is retained (audit) and excluded from default lists
        var all = await ListAsync(u, "?includeReversed=true");
        Assert.Contains(all.Items, t => t.Id == exp.Transaction.Id && t.ReversedById == rev.Transaction.Id);
        Assert.Empty((await ListAsync(u, $"?type={(int)TransactionType.Expense}")).Items);
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Correction_replaces_entry_atomically()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Fix", 1_000);
        var cat = await u.CategoryAsync("Fix-cat");
        var exp = await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 100, cat.Id));
        var res = await u.Http.PutAsJsonAsync($"/api/transactions/{exp.Transaction.Id}/expense",
            new ExpenseRequest(w.Id, 250, cat.Id, null, null, null, "to'g'rilandi", null));
        var fixedTx = await u.OkAsync<OperationResult>(res);
        Assert.Equal(exp.Transaction.Id, fixedTx.Transaction.ReplacesId);
        Assert.Equal(750m, await u.BalanceAsync(w.Id));
        var visible = await ListAsync(u, $"?type={(int)TransactionType.Expense}");
        Assert.Single(visible.Items);
        Assert.Equal(250m, visible.Items[0].Amount);
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Borrowing_is_not_income_and_lending_is_not_expense()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Debts", 1_000);
        var borrow = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/debts",
            new DebtRequest(DebtDirection.Borrowed, null, "Akmal", w.Id, 500, null, "mashina", null, null, null, null)));
        Assert.Equal(1_500m, await u.BalanceAsync(w.Id));
        var lend = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/debts",
            new DebtRequest(DebtDirection.Lent, null, "Bobur", w.Id, 300, null, null, null, null, null, null)));
        Assert.Equal(1_200m, await u.BalanceAsync(w.Id));

        Assert.Equal(TransactionType.DebtBorrow, borrow.Transaction.Type);
        Assert.Equal(TransactionType.DebtLend, lend.Transaction.Type);
        Assert.Empty((await ListAsync(u, $"?type={(int)TransactionType.Income}")).Items);
        Assert.Empty((await ListAsync(u, $"?type={(int)TransactionType.Expense}")).Items);
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Partial_then_full_repayment_settles_debt_and_overpayment_fails()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Repay", 100);
        var debt = (await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/debts",
            new DebtRequest(DebtDirection.Borrowed, null, "Karim", w.Id, 400, null, null, null, null, null, null)))).Debt!;
        Assert.Equal(500m, await u.BalanceAsync(w.Id));

        var part = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync($"/api/debts/{debt.Id}/repay",
            new RepayRequest(w.Id, 150, null, null, null)));
        Assert.Equal(250m, part.Debt!.Outstanding);
        Assert.Equal(DebtStatus.Open, part.Debt.Status);
        Assert.Equal(350m, await u.BalanceAsync(w.Id));

        var err = await u.ErrorAsync(await u.Http.PostAsJsonAsync($"/api/debts/{debt.Id}/repay",
            new RepayRequest(w.Id, 251, null, null, null)), HttpStatusCode.UnprocessableEntity);
        Assert.Equal("debt.overpayment", err.Code);

        var full = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync($"/api/debts/{debt.Id}/repay",
            new RepayRequest(w.Id, 250, null, null, null)));
        Assert.Equal(0m, full.Debt!.Outstanding);
        Assert.Equal(DebtStatus.Settled, full.Debt.Status);
        Assert.Equal(100m, await u.BalanceAsync(w.Id));
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Collecting_a_lent_debt_adds_money_back()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Collect", 1_000);
        var debt = (await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/debts",
            new DebtRequest(DebtDirection.Lent, null, "Sardor", w.Id, 600, null, null, null, null, null, null)))).Debt!;
        Assert.Equal(400m, await u.BalanceAsync(w.Id));
        var r = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync($"/api/debts/{debt.Id}/repay",
            new RepayRequest(w.Id, 200, null, null, null)));
        Assert.Equal(TransactionType.DebtCollection, r.Transaction.Type);
        Assert.Equal(600m, await u.BalanceAsync(w.Id));
        Assert.Equal(400m, r.Debt!.Outstanding);
    }

    [Fact]
    public async Task Repayment_reversal_reopens_debt()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("RevDebt", 0);
        var debt = (await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/debts",
            new DebtRequest(DebtDirection.Borrowed, null, "Dilshod", w.Id, 100, null, null, null, null, null, null)))).Debt!;
        var rep = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync($"/api/debts/{debt.Id}/repay",
            new RepayRequest(w.Id, 100, null, null, null)));
        await u.OkAsync<OperationResult>(await u.Http.PostAsync($"/api/transactions/{rep.Transaction.Id}/reverse", null));
        var debts = await u.Http.GetFromJsonAsync<List<DebtDto>>("/api/debts");
        var d = debts!.Single(x => x.Id == debt.Id);
        Assert.Equal(100m, d.Outstanding);
        Assert.Equal(DebtStatus.Open, d.Status);
        Assert.Equal(100m, await u.BalanceAsync(w.Id));
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Multi_currency_transfer_uses_rate_and_keeps_currencies_separate()
    {
        var u = await app.RegisterAsync();
        var usd = await u.WalletAsync("USD", 100, "USD");
        var uzs = await u.WalletAsync("UZS", 0, "UZS");
        var noRate = await u.ErrorAsync(await u.TransferAsync(usd.Id, uzs.Id, 10), HttpStatusCode.BadRequest);
        Assert.Equal("transfer.rate_required", noRate.Code);

        var r = await u.OkAsync<OperationResult>(await u.TransferAsync(usd.Id, uzs.Id, 10, rate: 12_650.55m));
        Assert.Equal(126_505.50m, r.Transaction.ToAmount);
        Assert.Equal("UZS", r.Transaction.ToCurrency);
        Assert.Equal(90m, await u.BalanceAsync(usd.Id));
        Assert.Equal(126_505.50m, await u.BalanceAsync(uzs.Id));
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Same_currency_transfer_cannot_change_amount()
    {
        var u = await app.RegisterAsync();
        var a = await u.WalletAsync("S1", 100);
        var b = await u.WalletAsync("S2", 0);
        var err = await u.ErrorAsync(await u.TransferAsync(a.Id, b.Id, 10, toAmount: 11), HttpStatusCode.BadRequest);
        Assert.Equal("transfer.amount_mismatch", err.Code);
    }

    [Fact]
    public async Task Amount_precision_is_enforced_per_currency()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Prec", 0);
        var err = await u.ErrorAsync(await u.IncomeAsync(w.Id, 10.005m), HttpStatusCode.BadRequest);
        Assert.Equal("amount.precision", err.Code);
    }

    [Fact]
    public async Task Users_cannot_touch_each_others_data()
    {
        var alice = await app.RegisterAsync();
        var bob = await app.RegisterAsync();
        var aw = await alice.WalletAsync("Alice-wallet", 1_000);
        var bw = await bob.WalletAsync("Bob-wallet", 1_000);
        var bobCat = await bob.CategoryAsync("Bob-cat");

        Assert.Equal(HttpStatusCode.NotFound, (await bob.IncomeAsync(aw.Id, 10)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.TransferAsync(bw.Id, aw.Id, 10)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.ExpenseAsync(aw.Id, 10, bobCat.Id)).StatusCode);
        var tx = await alice.OkAsync<OperationResult>(await alice.IncomeAsync(aw.Id, 5));
        Assert.Equal(HttpStatusCode.NotFound, (await bob.Http.GetAsync($"/api/transactions/{tx.Transaction.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.Http.PostAsync($"/api/transactions/{tx.Transaction.Id}/reverse", null)).StatusCode);
        Assert.Single(await bob.Http.GetFromJsonAsync<List<WalletDto>>("/api/wallets") ?? []);
        Assert.Equal(1_005m, await alice.BalanceAsync(aw.Id));
    }

    [Fact]
    public async Task Unauthenticated_requests_are_rejected()
    {
        var client = app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/wallets")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/transactions")).StatusCode);
    }

    [Fact]
    public async Task Project_buckets_reconcile_with_wallet_balance()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Shared", 1_000);
        var p1 = await u.ProjectAsync("Qassobxona");
        var p2 = await u.ProjectAsync("Nazorat");
        var cat = await u.CategoryAsync("Proj-cat");
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 500, project: p1.Id));
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 300, project: p2.Id));
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 120, cat.Id, project: p1.Id));

        Assert.Equal(1_680m, await u.BalanceAsync(w.Id));
        var s1 = await u.Http.GetFromJsonAsync<System.Text.Json.JsonElement>($"/api/projects/{p1.Id}/summary");
        Assert.Equal(380m, s1.GetProperty("remaining").GetProperty("UZS").GetDecimal());
        Assert.Equal(500m, s1.GetProperty("income").GetProperty("UZS").GetDecimal());
        Assert.Equal(120m, s1.GetProperty("expense").GetProperty("UZS").GetDecimal());
        await AssertBooksBalancedAsync(u);
    }

    [Fact]
    public async Task Filters_and_search_combine()
    {
        var u = await app.RegisterAsync();
        var w1 = await u.WalletAsync("F1", 10_000);
        var w2 = await u.WalletAsync("F2", 10_000);
        var cat = await u.CategoryAsync("Benzin");
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w1.Id, 100, cat.Id, memo: "Metan zapravka"));
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w2.Id, 300, cat.Id, memo: "Boshqa"));
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w1.Id, 900, memo: "Sotuv"));

        Assert.Single((await ListAsync(u, "?q=metan")).Items);
        Assert.Single((await ListAsync(u, "?q=Benzin&walletId=" + w1.Id)).Items);
        Assert.Equal(2, (await ListAsync(u, $"?type={(int)TransactionType.Expense}")).Total);
        Assert.Single((await ListAsync(u, $"?type={(int)TransactionType.Expense}&minAmount=200")).Items);
        Assert.Single((await ListAsync(u, "?q=900")).Items);
        Assert.Empty((await ListAsync(u, "?q=100%25x")).Items); // LIKE wildcards are escaped
    }

    [Fact]
    public async Task Refresh_tokens_rotate_and_reuse_revokes_family()
    {
        var u = await app.RegisterAsync();
        var client = app.CreateClient();
        var r1 = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(u.Auth.RefreshToken));
        var a1 = (await r1.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.NotEqual(u.Auth.RefreshToken, a1.RefreshToken);

        var reuse = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(u.Auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);
        // family revoked: the newer token no longer works either
        var after = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(a1.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task Wrong_password_is_rejected_and_locks_after_repeated_failures()
    {
        var u = await app.RegisterAsync();
        var client = app.CreateClient();
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(u.Email, "wrong-password"))).StatusCode);
        var locked = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(u.Email, "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
    }

    [Fact]
    public async Task Full_card_number_is_not_accepted()
    {
        var u = await app.RegisterAsync();
        var res = await u.Http.PostAsJsonAsync("/api/wallets",
            new WalletRequest("Karta", WalletType.BankCard, "UZS", 0, null, null, "Kapital", "8600123412344775", null, false, null));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var ok = await u.Http.PostAsJsonAsync("/api/wallets",
            new WalletRequest("Karta2", WalletType.BankCard, "UZS", 0, null, null, "Kapital", "•••• 4775", null, false, null));
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
    }

    [Fact]
    public async Task Archived_wallet_blocks_new_postings()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Old", 10);
        var res = await u.Http.PatchAsJsonAsync($"/api/wallets/{w.Id}",
            new WalletUpdateRequest(null, null, null, null, null, null, null, true, null));
        res.EnsureSuccessStatusCode();
        var err = await u.ErrorAsync(await u.IncomeAsync(w.Id, 5), HttpStatusCode.Conflict);
        Assert.Equal("wallet.archived", err.Code);
    }

    [Fact]
    public async Task New_account_gets_default_categories()
    {
        var u = await app.RegisterAsync();
        var cats = await u.Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories");
        Assert.Contains(cats!, c => c.Name == "Kommunal");
        Assert.True(cats!.Count >= 12);
    }
}
