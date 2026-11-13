using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Hamyon.App.Models;

public static class Money
{
    /// <summary>Minor units per major unit; every supported currency has 2 decimals.</summary>
    public const long Scale = 100;

    public static long ToMinor(decimal amount) => (long)decimal.Round(amount * Scale, 0, MidpointRounding.AwayFromZero);
    public static decimal FromMinor(long minor) => minor / (decimal)Scale;

    /// <summary>"29 955 USD", "3 317 414,50 UZS" — space groups, comma decimals (Uzbek style).</summary>
    public static string Format(decimal amount, string currency)
    {
        var s = amount.ToString("#,0.##", CultureInfo.InvariantCulture).Replace(",", " ").Replace(".", ",");
        return $"{s} {currency}";
    }

    /// <summary>Several currencies are never added together: one entry per currency, joined with a dot.</summary>
    public static string Format(IReadOnlyDictionary<string, decimal> byCurrency) =>
        byCurrency.Count == 0 ? "0" : string.Join(" · ", byCurrency.OrderBy(k => k.Key).Select(k => Format(k.Value, k.Key)));
}
