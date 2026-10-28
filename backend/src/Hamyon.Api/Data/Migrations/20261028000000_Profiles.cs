using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Hamyon.Api.Data.Migrations;

/// <summary>
/// Financial profiles (existing data moves into one "Asosiy" profile per account) and conversion rate date/source on
/// journal entries. SQL in 0002_profiles.sql (embedded), same authoring approach as <see cref="Initial"/>.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20261028000000_Profiles")]
public sealed class Profiles : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        var asm = typeof(Profiles).Assembly;
        var name = asm.GetManifestResourceNames().Single(n => n.EndsWith("0002_profiles.sql", StringComparison.Ordinal));
        using var reader = new StreamReader(asm.GetManifestResourceStream(name)!);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Merging profiles back would mix separate books; roll back by restoring the pre-migration dump instead.
        throw new NotSupportedException("Restore the pre-migration backup to undo this migration.");
    }
}
