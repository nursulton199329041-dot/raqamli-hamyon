using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Hamyon.Api.Contracts;
using Hamyon.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace Hamyon.Tests;

/// <summary>
/// Boots the real API against a throw-away PostgreSQL database (numeric / row-level concurrency need real PG).
/// Server comes from TEST_POSTGRES (default: localhost:55433, user postgres, trust auth).
/// </summary>
public sealed class TestApp : WebApplicationFactory<Program>, IAsyncLifetime
{
    private static readonly string AdminConnection =
        Environment.GetEnvironmentVariable("TEST_POSTGRES") ?? "Host=localhost;Port=55433;Username=postgres;Database=postgres";

    private readonly string _dbName = "hamyon_test_" + Guid.NewGuid().ToString("N")[..12];

    private string ConnectionString => new NpgsqlConnectionStringBuilder(AdminConnection) { Database = _dbName, Pooling = true, MaxPoolSize = 60 }.ConnectionString;

    public async Task InitializeAsync()
    {
        await using var c = new NpgsqlConnection(AdminConnection);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand($"CREATE DATABASE \"{_dbName}\"", c);
        await cmd.ExecuteNonQueryAsync();
    }

    public new async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await using var c = new NpgsqlConnection(AdminConnection);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_dbName}\" WITH (FORCE)", c);
        await cmd.ExecuteNonQueryAsync();
        await base.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = ConnectionString,
            ["Database:AutoMigrate"] = "true",
            ["Jwt:Secret"] = "test-secret-test-secret-test-secret-0123456789",
            ["RateLimit:AuthPerMinute"] = "10000",
            ["RateLimit:PerMinute"] = "100000",
        }));
    }

    public async Task<ApiUser> RegisterAsync(string? email = null)
    {
        var client = CreateClient();
        email ??= $"u{Guid.NewGuid():N}@test.local";
        var res = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "Test User", "uz"));
        res.EnsureSuccessStatusCode();
        var auth = (await res.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return new ApiUser(client, auth.User.Id, email, auth);
    }
}

public sealed class ApiUser(HttpClient http, Guid id, string email, AuthResponse auth)
{
    public HttpClient Http { get; } = http;
    public Guid Id { get; } = id;
    public string Email { get; } = email;
    public AuthResponse Auth { get; } = auth;

    public async Task<WalletDto> WalletAsync(string name, decimal initial = 0, string currency = "UZS", bool overdraft = false,
        WalletType type = WalletType.Cash)
    {
        var res = await Http.PostAsJsonAsync("/api/wallets",
            new WalletRequest(name, type, currency, initial, null, null, null, null, null, overdraft, null));
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<WalletDto>())!;
    }

    public async Task<decimal> BalanceAsync(Guid walletId)
    {
        var list = await Http.GetFromJsonAsync<List<WalletDto>>("/api/wallets?includeArchived=true");
        return list!.Single(w => w.Id == walletId).Balance;
    }

    public async Task<CategoryDto> CategoryAsync(string name)
    {
        var res = await Http.PostAsJsonAsync("/api/categories", new CategoryRequest(name, null, null, null, null, null, null));
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<CategoryDto>())!;
    }

    public async Task<IncomeSourceDto> SourceAsync(string name)
    {
        var res = await Http.PostAsJsonAsync("/api/income-sources", new IncomeSourceRequest(name, null, null, null));
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<IncomeSourceDto>())!;
    }

    public async Task<ProjectDto> ProjectAsync(string name, string currency = "UZS")
    {
        var res = await Http.PostAsJsonAsync("/api/projects", new ProjectRequest(name, null, null, currency, null));
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<ProjectDto>())!;
    }

    public Task<HttpResponseMessage> IncomeAsync(Guid wallet, decimal amount, Guid? source = null, Guid? project = null,
        string? key = null, string? memo = null) =>
        Http.PostAsJsonAsync("/api/transactions/income",
            new IncomeRequest(wallet, amount, source, null, null, project, null, memo, key));

    public Task<HttpResponseMessage> ExpenseAsync(Guid wallet, decimal amount, Guid category, Guid? project = null,
        string? key = null, string? memo = null) =>
        Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(wallet, amount, category, null, project, null, memo, key));

    public Task<HttpResponseMessage> TransferAsync(Guid from, Guid to, decimal amount, decimal? toAmount = null,
        decimal? rate = null, Guid? project = null, string? key = null) =>
        Http.PostAsJsonAsync("/api/transactions/transfer",
            new TransferRequest(from, to, amount, toAmount, rate, project, null, null, key));

    public async Task<T> OkAsync<T>(HttpResponseMessage res)
    {
        if (res.StatusCode != HttpStatusCode.OK && res.StatusCode != HttpStatusCode.Created)
            throw new Xunit.Sdk.XunitException($"HTTP {(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<T>())!;
    }

    public async Task<ErrorResponse> ErrorAsync(HttpResponseMessage res, HttpStatusCode expected)
    {
        Assert.Equal(expected, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<ErrorResponse>())!;
    }
}
