using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Hamyon.Api.Data.Migrations;

/// <summary>
/// Baseline schema. Authored from the EF model's CREATE script (0001_initial.sql, embedded) because the
/// dotnet-ef tool is not required to build/run the project. Later changes are added as new migrations.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20261015000000_Initial")]
public sealed class Initial : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        var asm = typeof(Initial).Assembly;
        var name = asm.GetManifestResourceNames().Single(n => n.EndsWith("0001_initial.sql", StringComparison.Ordinal));
        using var reader = new StreamReader(asm.GetManifestResourceStream(name)!);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        foreach (var t in new[] { "LedgerLines", "JournalEntries", "Attachments", "AuditLogs", "Debts", "Projects", "People",
                     "IncomeSources", "Categories", "Wallets", "LedgerAccounts", "RefreshTokens", "Users" })
            migrationBuilder.Sql($"DROP TABLE IF EXISTS \"{t}\" CASCADE;");
    }
}