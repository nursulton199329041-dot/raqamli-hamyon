using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Hamyon.Api.Data.Migrations;

/// <summary>
/// Document store for the device-book sync (<c>/api/books</c>). Additive: no existing table changes.
/// SQL in 0003_book_docs.sql (embedded), same authoring approach as <see cref="Initial"/>.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20261114000000_BookDocs")]
public sealed class BookDocs : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        var asm = typeof(BookDocs).Assembly;
        var name = asm.GetManifestResourceNames().Single(n => n.EndsWith("0003_book_docs.sql", StringComparison.Ordinal));
        using var reader = new StreamReader(asm.GetManifestResourceStream(name)!);
        migrationBuilder.Sql(reader.ReadToEnd());
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""DROP TABLE "BookDocs"; DROP SEQUENCE "BookDocs_Seq_seq";""");
    }
}
