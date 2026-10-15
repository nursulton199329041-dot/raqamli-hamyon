using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Wallet> Wallets => Set<Wallet>();
    public DbSet<LedgerAccount> LedgerAccounts => Set<LedgerAccount>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<LedgerLine> LedgerLines => Set<LedgerLine>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<IncomeSource> IncomeSources => Set<IncomeSource>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Debt> Debts => Set<Debt>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        const string money = "numeric(19,4)";

        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.NormalizedEmail).IsUnique();
            e.HasIndex(x => new { x.ExternalIssuer, x.ExternalSubjectId }).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.NormalizedEmail).HasMaxLength(254);
            e.Property(x => x.DisplayName).HasMaxLength(100);
            e.Property(x => x.Locale).HasMaxLength(8);
            e.Property(x => x.DefaultCurrency).HasMaxLength(3);
        });

        b.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.FamilyId);
        });

        b.Entity<Wallet>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.IsArchived });
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.Icon).HasMaxLength(40);
            e.Property(x => x.Color).HasMaxLength(9);
            e.Property(x => x.BankName).HasMaxLength(80);
            e.Property(x => x.MaskedNumber).HasMaxLength(24);
            e.Property(x => x.Note).HasMaxLength(500);
        });

        b.Entity<LedgerAccount>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Kind, x.RefId, x.Currency }).IsUnique();
            e.Property(x => x.Balance).HasColumnType(money);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.Name).HasMaxLength(120);
        });

        b.Entity<JournalEntry>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.IdempotencyKey }).IsUnique();
            e.HasIndex(x => new { x.UserId, x.OccurredAt });
            e.HasIndex(x => x.WalletId);
            e.HasIndex(x => x.ProjectId);
            e.HasIndex(x => x.ReversalOfId);
            e.Property(x => x.Amount).HasColumnType(money);
            e.Property(x => x.ToAmount).HasColumnType(money);
            e.Property(x => x.FxRate).HasColumnType("numeric(19,8)");
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.ToCurrency).HasMaxLength(3);
            e.Property(x => x.IdempotencyKey).HasMaxLength(100);
            e.Property(x => x.RequestFingerprint).HasMaxLength(64);
            e.Property(x => x.Reason).HasMaxLength(200);
            e.Property(x => x.Memo).HasMaxLength(1000);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.JournalEntryId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<LedgerLine>(e =>
        {
            e.HasIndex(x => x.LedgerAccountId);
            e.HasIndex(x => new { x.UserId, x.ProjectId });
            e.Property(x => x.Amount).HasColumnType(money);
            e.Property(x => x.Currency).HasMaxLength(3);
        });

        b.Entity<Category>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.MonthlyLimit).HasColumnType(money);
            e.Property(x => x.LimitCurrency).HasMaxLength(3);
        });

        b.Entity<IncomeSource>(e => { e.HasIndex(x => x.UserId); e.Property(x => x.Name).HasMaxLength(80); });
        b.Entity<Person>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Phone).HasMaxLength(32);
            e.Property(x => x.Note).HasMaxLength(500);
        });
        b.Entity<Project>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Currency).HasMaxLength(3);
        });

        b.Entity<Debt>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Status });
            e.Property(x => x.Principal).HasColumnType(money);
            e.Property(x => x.Outstanding).HasColumnType(money);
            e.Property(x => x.Currency).HasMaxLength(3);
        });

        b.Entity<Attachment>(e =>
        {
            e.HasIndex(x => x.JournalEntryId);
            e.Property(x => x.FileName).HasMaxLength(200);
            e.Property(x => x.ContentType).HasMaxLength(100);
            e.Property(x => x.Sha256).HasMaxLength(64);
            e.Property(x => x.StorageKey).HasMaxLength(200);
        });

        b.Entity<AuditLog>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.At });
            e.Property(x => x.Action).HasMaxLength(80);
            e.Property(x => x.EntityType).HasMaxLength(40);
            e.Property(x => x.Detail).HasMaxLength(2000);
            e.Property(x => x.Ip).HasMaxLength(64);
        });
    }
}
