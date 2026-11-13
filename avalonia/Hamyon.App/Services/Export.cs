using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Hamyon.App.Localization;
using Hamyon.App.Models;
using SkiaSharp;

namespace Hamyon.App.Services;

/// <summary>
/// Saving a file the user chooses where to put (Android / iOS share-save dialog, desktop "Save as").
/// The view layer plugs the platform picker in; null = not available.
/// </summary>
public static class Files
{
    /// <summary>(suggested file name, write the content) → saved?</summary>
    public static Func<string, Func<Stream, Task>, Task<bool>>? Saver { get; set; }
}

/// <summary>Operations of a period as CSV (opens in Excel) or as a printable PDF table.</summary>
public static class Export
{
    private static string KindName(OpKind k) => L.T(k switch
    {
        OpKind.Income => "op_income", OpKind.Expense => "op_expense", OpKind.Transfer => "op_transfer",
        OpKind.Lend => "op_lend", _ => "op_borrow",
    });

    /// <summary>What the operation moved to / from (category, source, wallet or person).</summary>
    private static string Counterpart(OperationRow o) => o.Kind switch
    {
        OpKind.Income => o.SourceName ?? "",
        OpKind.Expense => o.CategoryName ?? "",
        OpKind.Transfer => o.ToWalletName ?? "",
        _ => o.Person ?? "",
    };

    private static string Num(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture);

    /// <summary>
    /// UTF-8 with BOM and ';' separators so Excel (Uzbek / Russian locales) opens it straight into columns.
    /// Amounts are plain numbers (dot decimals) so they stay numeric.
    /// </summary>
    public static byte[] Csv(IReadOnlyList<OperationRow> ops)
    {
        var sb = new StringBuilder();
        string Cell(string? s) => s is null ? "" : s.Contains(';') || s.Contains('"') || s.Contains('\n') ? $"\"{s.Replace("\"", "\"\"")}\"" : s;
        sb.AppendLine(string.Join(';', L.T("csv_date"), L.T("csv_type"), L.T("csv_amount"), L.T("currency"), L.T("csv_in_uzs"), L.T("csv_rate"),
            L.T("csv_wallet"), L.T("csv_counterpart"), L.T("csv_note")));
        foreach (var o in ops.OrderBy(o => o.Date).ThenBy(o => o.Id))
        {
            sb.AppendLine(string.Join(';',
                o.Date.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                Cell(KindName(o.Kind)),
                Num(o.Amount),
                o.Currency,
                o.BaseAmount is { } b ? Num(b) : "",
                o.Rate is { } r ? Num(r) : "",
                Cell(o.WalletName),
                Cell(Counterpart(o)),
                Cell(o.Note)));
        }
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
    }

    /// <summary>A4 PDF: title, period, income / expense totals per currency, then a dated table; pages break as needed.</summary>
    public static void Pdf(Stream output, IReadOnlyList<OperationRow> ops, string title, string period)
    {
        const float W = 595, H = 842, M = 40;
        using var doc = SKDocument.CreatePdf(output, new SKDocumentPdfMetadata { Title = title, Creator = "Raqamli Hamyon", Producer = "Raqamli Hamyon" });
        using var regular = new SKFont(SKTypeface.FromFamilyName(null, SKFontStyle.Normal) ?? SKTypeface.Default, 9.5f);
        using var bold = new SKFont(SKTypeface.FromFamilyName(null, SKFontStyle.Bold) ?? SKTypeface.Default, 9.5f);
        using var big = new SKFont(bold.Typeface, 20);
        using var ink = new SKPaint { Color = new SKColor(0x1C, 0x0C, 0x0E), IsAntialias = true };
        using var muted = new SKPaint { Color = new SKColor(0x6E, 0x5A, 0x58), IsAntialias = true };
        using var green = new SKPaint { Color = new SKColor(0x11, 0x9B, 0x6A), IsAntialias = true };
        using var red = new SKPaint { Color = new SKColor(0xD1, 0x3B, 0x3B), IsAntialias = true };
        using var garnet = new SKPaint { Color = new SKColor(0x8E, 0x1F, 0x2E), IsAntialias = true };
        using var line = new SKPaint { Color = new SKColor(0xE4, 0xD6, 0xD2), StrokeWidth = 0.7f, IsAntialias = true };

        // columns: date | type | wallet | to / from | note | amount (right-aligned)
        float[] x = [M, M + 62, M + 128, M + 236, M + 344, W - M];
        SKCanvas canvas = null!;
        float y = 0;
        var page = 0;

        void Text(string s, float left, float top, SKFont font, SKPaint paint, float max = 0)
        {
            if (max > 0) while (s.Length > 1 && font.MeasureText(s) > max) s = s[..^2] + "…";
            canvas.DrawText(s, left, top, font, paint);
        }
        void Right(string s, float right, float top, SKFont font, SKPaint paint) =>
            canvas.DrawText(s, right - font.MeasureText(s), top, font, paint);

        void NewPage()
        {
            if (page > 0) doc.EndPage();
            page++;
            canvas = doc.BeginPage(W, H);
            canvas.DrawRect(0, 0, W, 6, garnet);
            y = M;
            if (page == 1)
            {
                Text(title, M, y + 14, big, ink);
                y += 30;
                Text(period, M, y, regular, muted);
                y += 22;
                foreach (var (label, kind, paint) in new[] { (L.T("incomes"), OpKind.Income, green), (L.T("expenses"), OpKind.Expense, red) })
                {
                    var sums = ops.Where(o => o.Kind == kind)
                        .GroupBy(o => o.BaseAmount is null ? o.Currency : "UZS")
                        .Select(g => Money.Format(g.Sum(o => o.BaseAmount ?? o.Amount), g.Key));
                    Text(label, M, y, bold, muted);
                    Text(string.Join("  ·  ", sums.DefaultIfEmpty("0")), M + 110, y, bold, paint);
                    y += 16;
                }
                y += 12;
            }
            string[] head = [L.T("csv_date"), L.T("csv_type"), L.T("csv_wallet"), L.T("csv_counterpart"), L.T("csv_note")];
            for (var i = 0; i < head.Length; i++) Text(head[i].ToUpperInvariant(), x[i], y, bold, muted);
            Right(L.T("csv_amount").ToUpperInvariant(), x[5], y, bold, muted);
            y += 6;
            canvas.DrawLine(M, y, W - M, y, line);
            y += 14;
        }

        NewPage();
        if (ops.Count == 0) Text(L.T("no_data"), M, y + 10, regular, muted);
        foreach (var o in ops.OrderBy(o => o.Date).ThenBy(o => o.Id))
        {
            if (y > H - M - 20) NewPage();
            Text(o.Date.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture), x[0], y, regular, ink);
            Text(KindName(o.Kind), x[1], y, regular, ink, x[2] - x[1] - 6);
            Text(o.WalletName ?? "", x[2], y, regular, ink, x[3] - x[2] - 6);
            Text(Counterpart(o), x[3], y, regular, ink, x[4] - x[3] - 6);
            Text(o.Note ?? "", x[4], y, regular, muted, 100);
            var (sign, paint) = o.Kind switch
            {
                OpKind.Income or OpKind.Borrow => ("+", green),
                OpKind.Expense or OpKind.Lend => ("−", red),
                _ => ("", ink),
            };
            var amount = o.BaseAmount is { } b ? Money.Format(b, "UZS") : Money.Format(o.Amount, o.Currency);
            Right(sign + amount, x[5], y, bold, paint);
            y += 6;
            canvas.DrawLine(M, y, W - M, y, line);
            y += 13;
        }
        doc.EndPage();
        doc.Close();
    }
}
