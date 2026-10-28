using Hamyon.Api.Auth;
using Hamyon.Api.Contracts;
using Hamyon.Api.Ledger;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Data;

/// <summary>
/// Development-only demo account. Never runs outside Development, never touches real accounts: it creates
/// (or reuses) one dedicated user flagged IsDemo and posts a fixed, idempotent set of operations.
/// </summary>
public static class DemoSeeder
{
    public const string DemoEmail = "demo@hamyon.local";

    public static async Task SeedAsync(IServiceProvider sp, string password, CancellationToken ct = default)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var fin = scope.ServiceProvider.GetRequiredService<FinanceService>();
        var hasher = scope.ServiceProvider.GetRequiredService<PasswordHasher>();

        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == DemoEmail.ToUpperInvariant(), ct);
        if (user is not null)
        {
            if (!user.IsDemo) throw new InvalidOperationException("A non-demo account uses the demo email; refusing to seed.");
            return; // already seeded
        }

        user = new User
        {
            Email = DemoEmail, NormalizedEmail = DemoEmail.ToUpperInvariant(), PasswordHash = hasher.Hash(password),
            DisplayName = "Demo foydalanuvchi", Locale = "uz", IsDemo = true,
        };
        db.Users.Add(user);
        var profile = UserDefaults.AddProfile(db, user.Id, UserDefaults.MainProfileName);
        await db.SaveChangesAsync(ct);
        scope.ServiceProvider.GetRequiredService<ProfileScope>().Use(profile.Id);
        var uid = user.Id;

        async Task<Wallet> W(string name, WalletType type, decimal initial, string cur = "UZS", string icon = "wallet",
            string color = "#3B82F6", string? bank = null, string? mask = null) =>
            await fin.CreateWalletAsync(uid, new WalletRequest(name, type, cur, initial, icon, color, bank, mask, null, false, null), ct);

        var naqd = await W("Naqd", WalletType.Cash, 1_500_000, icon: "cash", color: "#22C55E");
        var karta = await W("Bank kartasi", WalletType.BankCard, 4_200_000, icon: "card", bank: "Kapitalbank", mask: "•••• 1208");
        var spark = await W("Spark 4775", WalletType.BankCard, 2_300_000, icon: "car", color: "#0EA5E9", mask: "•••• 4775");
        var nexia = await W("Nexia 3", WalletType.Virtual, 800_000, icon: "car", color: "#F59E0B");
        var proj = await W("Loyiha hamyoni", WalletType.Project, 6_000_000, icon: "project", color: "#8B5CF6");
        var usd = await W("Dollar jamg'arma", WalletType.Savings, 1_200, "USD", icon: "savings", color: "#14B8A6");

        var cats = await db.Categories.AsNoTracking().Where(c => c.UserId == uid).ToDictionaryAsync(c => c.Name, c => c.Id, ct);
        var sources = await db.IncomeSources.AsNoTracking().Where(c => c.UserId == uid).ToDictionaryAsync(c => c.Name, c => c.Id, ct);

        async Task<Guid> Project(string name, string color) =>
            (await db.Projects.AddAsync(new Project { UserId = uid, Name = name, Color = color }, ct)).Entity.Id;
        var pNazorat = await Project("Raqamli Nazorat", "#3B82F6");
        var pQassob = await Project("Qassobxona", "#EF4444");
        var pMuloqot = await Project("Raqamli Muloqot", "#8B5CF6");
        var pShaxsiy = await Project("Shaxsiy", "#22C55E");
        await db.SaveChangesAsync(ct);

        var today = DateTimeOffset.UtcNow;
        DateTimeOffset Ago(int d, int h = 10) => new DateTimeOffset(today.UtcDateTime.Date.AddDays(-d).AddHours(h), TimeSpan.Zero);
        var n = 0;
        string K() => $"demo:{++n:D3}";

        // incomes
        await fin.IncomeAsync(uid, new IncomeRequest(karta.Id, 8_000_000, sources["Ish haqi"], null, "Oylik", pShaxsiy, Ago(40), null, K()), ct);
        await fin.IncomeAsync(uid, new IncomeRequest(karta.Id, 8_000_000, sources["Ish haqi"], null, "Oylik", pShaxsiy, Ago(10), null, K()), ct);
        await fin.IncomeAsync(uid, new IncomeRequest(proj.Id, 12_500_000, sources["Biznes"], null, "Buyurtma to'lovi", pNazorat, Ago(25), "Mijoz to'lovi", K()), ct);
        await fin.IncomeAsync(uid, new IncomeRequest(naqd.Id, 3_400_000, sources["Biznes"], null, "Sotuv", pQassob, Ago(6), "Hafta savdosi", K()), ct);

        // expenses
        async Task E(Wallet w, decimal amt, string cat, int daysAgo, Guid? p = null, string? memo = null) =>
            await fin.ExpenseAsync(uid, new ExpenseRequest(w.Id, amt, cats[cat], null, p, Ago(daysAgo, 14), memo, K()), ct);
        await E(karta, 320_000, "Kommunal", 35, pShaxsiy, "Elektr + gaz");
        await E(karta, 180_000, "Kommunal", 5, pShaxsiy, "Suv, chiqindi");
        await E(spark, 150_000, "Transport", 30, null, "Metan");
        await E(spark, 140_000, "Transport", 14, null, "Metan");
        await E(nexia, 90_000, "Transport", 3, null, "Benzin");
        await E(naqd, 210_000, "Oziq-ovqat", 28, pShaxsiy, "Bozor");
        await E(naqd, 175_000, "Oziq-ovqat", 12, pShaxsiy, "Bozor");
        await E(karta, 95_000, "Oziq-ovqat", 2, pShaxsiy, "Korzinka");
        await E(proj, 2_800_000, "Xodim", 20, pNazorat, "Dasturchi maoshi");
        await E(proj, 1_900_000, "Xodim", 18, pQassob, "Sotuvchi maoshi");
        await E(proj, 3_500_000, "Uskuna", 15, pQassob, "Sovutgich");
        await E(proj, 650_000, "Ta'mirlash", 9, pMuloqot, "Server ta'miri");
        await E(karta, 120_000, "Boshqa", 1, pShaxsiy);

        // transfers
        await fin.TransferAsync(uid, new TransferRequest(karta.Id, spark.Id, 600_000, null, null, null, Ago(22), "Kartaga", K()), ct);
        await fin.TransferAsync(uid, new TransferRequest(naqd.Id, karta.Id, 500_000, null, null, null, Ago(8), "Naqd kartaga", K()), ct);
        await fin.TransferAsync(uid, new TransferRequest(usd.Id, karta.Id, 100, null, 12_700m, null, Ago(4), "Dollar sotildi", K()), ct);

        // debts
        var borrow = await fin.CreateDebtAsync(uid, new DebtRequest(DebtDirection.Borrowed, null, "Akmal aka", karta.Id, 2_000_000,
            Today(30), "Mashina ehtiyot qismi", pShaxsiy, Ago(16), null, K()), ct);
        await fin.RepayAsync(uid, borrow.Debt!.Id, new RepayRequest(karta.Id, 500_000, Ago(7), "1-qism", K()), ct);
        await fin.CreateDebtAsync(uid, new DebtRequest(DebtDirection.Lent, null, "Bobur", naqd.Id, 700_000,
            Today(14), "Do'stga", null, Ago(11), null, K()), ct);

        // budget limit for demo
        var comm = await db.Categories.FirstAsync(c => c.UserId == uid && c.Name == "Kommunal", ct);
        comm.MonthlyLimit = 400_000;
        comm.LimitCurrency = "UZS";
        await db.SaveChangesAsync(ct);

        DateTimeOffset Today(int plusDays) => DateTimeOffset.UtcNow.AddDays(plusDays);
    }
}
