using System.Globalization;
using System.Text;

namespace Hamyon.Api.Reports;

/// <summary>
/// Dependency-free PDF writer (Helvetica, WinAnsi). Characters outside Latin-1 (Cyrillic, uzbek apostrophes)
/// are transliterated, because embedding a TrueType font is not possible without a font file/library.
/// </summary>
public static class PdfReport
{
    private const double PageW = 842, PageH = 595, Margin = 36; // A4 landscape

    public static byte[] Build(ExportTable t)
    {
        var pages = new List<StringBuilder>();
        StringBuilder page = null!;
        double y = 0;

        void NewPage()
        {
            page = new StringBuilder();
            pages.Add(page);
            y = PageH - Margin;
        }

        void Text(double x, double yy, string s, double size = 9, bool bold = false)
        {
            page.Append($"BT /{(bold ? "F2" : "F1")} {size.ToString("0.#", CultureInfo.InvariantCulture)} Tf " +
                        $"{x.ToString("0.##", CultureInfo.InvariantCulture)} {yy.ToString("0.##", CultureInfo.InvariantCulture)} Td " +
                        $"({Escape(s)}) Tj ET\n");
        }

        void Rect(double x, double yy, double w, double h, double r, double g, double b)
        {
            page.Append($"{r.ToString("0.##", CultureInfo.InvariantCulture)} {g.ToString("0.##", CultureInfo.InvariantCulture)} " +
                        $"{b.ToString("0.##", CultureInfo.InvariantCulture)} rg " +
                        $"{x.ToString("0.##", CultureInfo.InvariantCulture)} {yy.ToString("0.##", CultureInfo.InvariantCulture)} " +
                        $"{w.ToString("0.##", CultureInfo.InvariantCulture)} {h.ToString("0.##", CultureInfo.InvariantCulture)} re f 0 g\n");
        }

        var lang = t.Language;
        NewPage();
        Text(Margin, y - 14, t.Title, 18, true);
        y -= 30;
        Text(Margin, y - 10, $"{ExportService.T(lang, "generated")}: {t.GeneratedAt:yyyy-MM-dd HH:mm} UTC", 9);
        y -= 16;
        var filterText = t.FilterLines.Count == 0 ? ExportService.T(lang, "none") : string.Join("; ", t.FilterLines);
        Text(Margin, y - 10, $"{ExportService.T(lang, "filters")}: {Fit(filterText, 150)}", 9);
        y -= 22;

        // Totals per currency
        Text(Margin, y - 10, ExportService.T(lang, "totals"), 11, true);
        y -= 18;
        foreach (var tot in t.Totals)
        {
            Text(Margin, y - 9,
                $"{tot.Currency}:  {ExportService.T(lang, "income")} {Money(tot.Income)}   |   {ExportService.T(lang, "expense")} {Money(tot.Expense)}" +
                $"   |   {ExportService.T(lang, "net")} {Money(tot.NetFlow)}", 10);
            y -= 14;
        }

        // Chart: monthly income vs expense, one block per currency (never mixed)
        foreach (var cur in t.Series.Select(s => s.Currency).Distinct())
        {
            var pts = t.Series.Where(s => s.Currency == cur).TakeLast(12).ToList();
            if (pts.Count == 0) continue;
            if (y < 170) { NewPage(); }
            y -= 8;
            Text(Margin, y - 10, $"{ExportService.T(lang, "chart")} ({cur})", 10, true);
            y -= 16;
            var max = (double)Math.Max(1m, pts.Max(p => Math.Max(p.Income, p.Expense)));
            const double chartH = 80, barW = 16, gap = 22;
            var baseY = y - chartH;
            for (var i = 0; i < pts.Count; i++)
            {
                var x = Margin + 10 + i * (barW * 2 + gap);
                var hi = (double)pts[i].Income / max * chartH;
                var he = (double)pts[i].Expense / max * chartH;
                Rect(x, baseY, barW, Math.Max(0.5, hi), 0.13, 0.7, 0.35);
                Rect(x + barW, baseY, barW, Math.Max(0.5, he), 0.92, 0.3, 0.3);
                Text(x - 2, baseY - 10, pts[i].Period, 6.5);
            }
            y = baseY - 24;
        }

        // Table
        if (y < 120) NewPage();
        y -= 6;
        string[] cols = ["date", "type", "wallet", "amount", "currency", "category", "person", "memo"];
        double[] xs = [Margin, 110, 180, 270, 350, 395, 520, 630];
        int[] widths = [16, 14, 20, 16, 4, 22, 20, 36];

        void Header()
        {
            Rect(Margin - 2, y - 12, PageW - 2 * Margin + 4, 15, 0.87, 0.91, 0.96);
            for (var i = 0; i < cols.Length; i++) Text(xs[i], y - 9, ExportService.T(lang, cols[i]), 8, true);
            y -= 18;
        }

        Header();
        foreach (var r in t.Rows)
        {
            if (y < Margin + 12) { NewPage(); Header(); }
            var v = new[]
            {
                r.Date.UtcDateTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture), r.Type, r.Wallet,
                Money(r.Amount), r.Currency, r.Category ?? r.Source ?? "", r.Person ?? "", r.Memo ?? "",
            };
            for (var i = 0; i < v.Length; i++) Text(xs[i], y - 8, Fit(v[i], widths[i]), 8);
            y -= 12;
        }

        return Assemble(pages);
    }

    private static string Money(decimal d) => d.ToString("#,##0.00", CultureInfo.InvariantCulture).Replace(',', ' ');

    private static string Fit(string s, int max)
    {
        var a = Ascii(s);
        return a.Length <= max ? a : a[..(max - 1)] + "~";
    }

    private static string Escape(string s) =>
        Ascii(s).Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");

    private static readonly Dictionary<char, string> Translit = new()
    {
        ['а'] = "a", ['б'] = "b", ['в'] = "v", ['г'] = "g", ['д'] = "d", ['е'] = "e", ['ё'] = "yo", ['ж'] = "zh", ['з'] = "z",
        ['и'] = "i", ['й'] = "y", ['к'] = "k", ['л'] = "l", ['м'] = "m", ['н'] = "n", ['о'] = "o", ['п'] = "p", ['р'] = "r",
        ['с'] = "s", ['т'] = "t", ['у'] = "u", ['ф'] = "f", ['х'] = "kh", ['ц'] = "ts", ['ч'] = "ch", ['ш'] = "sh",
        ['щ'] = "shch", ['ъ'] = "", ['ы'] = "y", ['ь'] = "", ['э'] = "e", ['ю'] = "yu", ['я'] = "ya",
        ['ў'] = "o'", ['қ'] = "q", ['ғ'] = "g'", ['ҳ'] = "h",
        ['ʻ'] = "'", ['ʼ'] = "'", ['’'] = "'", ['‘'] = "'", ['–'] = "-", ['—'] = "-", ['•'] = "*", ['…'] = "...",
    };

    private static string Ascii(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            if (ch is >= ' ' and <= '~') { sb.Append(ch); continue; }
            var lower = char.ToLowerInvariant(ch);
            if (Translit.TryGetValue(lower, out var rep))
                sb.Append(char.IsUpper(ch) && rep.Length > 0 ? char.ToUpperInvariant(rep[0]) + rep[1..] : rep);
            else sb.Append('?');
        }
        return sb.ToString();
    }

    private static byte[] Assemble(List<StringBuilder> pages)
    {
        var objs = new List<byte[]>();
        int Add(string s) { objs.Add(Encoding.ASCII.GetBytes(s)); return objs.Count; }

        // 1 catalog, 2 pages, 3 font regular, 4 font bold, then per page: page + content
        Add("<< /Type /Catalog /Pages 2 0 R >>");
        Add(""); // placeholder for pages (needs kids)
        Add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
        Add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

        var kids = new List<int>();
        foreach (var p in pages)
        {
            var content = Encoding.ASCII.GetBytes(p.ToString());
            var pageId = objs.Count + 1;
            var contentId = pageId + 1;
            Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PageW} {PageH}] " +
                $"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {contentId} 0 R >>");
            var head = Encoding.ASCII.GetBytes($"<< /Length {content.Length} >>\nstream\n");
            var tail = Encoding.ASCII.GetBytes("\nendstream");
            objs.Add(head.Concat(content).Concat(tail).ToArray());
            kids.Add(pageId);
        }
        objs[1] = Encoding.ASCII.GetBytes($"<< /Type /Pages /Kids [{string.Join(' ', kids.Select(k => $"{k} 0 R"))}] /Count {kids.Count} >>");

        using var ms = new MemoryStream();
        void W(string s) => ms.Write(Encoding.ASCII.GetBytes(s));
        W("%PDF-1.4\n");
        var offsets = new List<long>();
        for (var i = 0; i < objs.Count; i++)
        {
            offsets.Add(ms.Position);
            W($"{i + 1} 0 obj\n");
            ms.Write(objs[i]);
            W("\nendobj\n");
        }
        var xref = ms.Position;
        W($"xref\n0 {objs.Count + 1}\n0000000000 65535 f \n");
        foreach (var o in offsets) W($"{o:D10} 00000 n \n");
        W($"trailer\n<< /Size {objs.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF");
        return ms.ToArray();
    }
}
