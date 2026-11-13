using System;
using System.Collections.Generic;
using System.Globalization;

namespace Hamyon.App.Models;

/// <summary>
/// The money keypad's calculator: "150000+25000", "12,5×4". Decimal only (no floating point), × and ÷ before + and −,
/// result rounded to 2 decimals (away from zero). A trailing operator is ignored while the user is still typing.
/// </summary>
public static class Calc
{
    public const string Ops = "+−×÷";

    /// <summary>Value of the expression, or null when it is empty / malformed / divides by zero.</summary>
    public static decimal? Evaluate(string expr)
    {
        if (string.IsNullOrWhiteSpace(expr)) return null;
        var tokens = Tokenize(expr.TrimEnd(Ops.ToCharArray()));
        if (tokens is null || tokens.Count == 0) return null;
        try
        {
            // first pass: × and ÷
            var terms = new List<decimal> { (decimal)tokens[0] };
            var addOps = new List<char>();
            for (var i = 1; i < tokens.Count; i += 2)
            {
                var op = (char)tokens[i];
                var n = (decimal)tokens[i + 1];
                switch (op)
                {
                    case '×': terms[^1] *= n; break;
                    case '÷':
                        if (n == 0) return null;
                        terms[^1] /= n;
                        break;
                    default: addOps.Add(op); terms.Add(n); break;
                }
            }
            // second pass: + and −
            var total = terms[0];
            for (var i = 0; i < addOps.Count; i++) total = addOps[i] == '+' ? total + terms[i + 1] : total - terms[i + 1];
            return decimal.Round(total, 2, MidpointRounding.AwayFromZero);
        }
        catch (OverflowException)
        {
            return null;
        }
    }

    /// <summary>Applies one keypad key to the expression text and returns the new text.</summary>
    public static string Press(string expr, string key)
    {
        switch (key)
        {
            case "C": return "";
            case "⌫": return expr.Length > 0 ? expr[..^1] : expr;
            case "=": return Evaluate(expr) is { } v ? Plain(v) : expr;
        }
        var last = expr.Length > 0 ? expr[^1] : '\0';
        if (key.Length == 1 && Ops.Contains(key[0]))
        {
            if (expr.Length == 0) return expr;                       // no leading operator
            return Ops.Contains(last) ? expr[..^1] + key : expr + key; // replace a trailing operator
        }
        if (key == ",")
        {
            var lastNumber = LastNumber(expr);
            if (lastNumber.Contains(',')) return expr;
            return lastNumber.Length == 0 ? expr + "0," : expr + ",";
        }
        // digits ("0".."9", "000"): at most 2 decimals, at most 15 digits in one number
        var current = LastNumber(expr);
        var comma = current.IndexOf(',');
        if (comma >= 0 && current.Length - comma - 1 + key.Length > 2) return expr;
        if (current.Replace(",", "").Length + key.Length > 15) return expr;
        if (current == "0" && key != ",") return expr[..^1] + (key == "000" ? "0" : key);
        if (current.Length == 0 && key == "000") return expr + "0";
        return expr + key;
    }

    /// <summary>Plain number text the keypad can keep editing: 175000, 12,5.</summary>
    public static string Plain(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture).Replace('.', ',');

    private static string LastNumber(string expr)
    {
        var i = expr.Length;
        while (i > 0 && !Ops.Contains(expr[i - 1])) i--;
        return expr[i..];
    }

    private static List<object>? Tokenize(string expr)
    {
        var list = new List<object>();
        var num = "";
        foreach (var ch in expr)
        {
            if (char.IsDigit(ch) || ch == ',') { num += ch; continue; }
            if (!Ops.Contains(ch) || num.Length == 0) return null;
            if (!TryNum(num, out var n)) return null;
            list.Add(n);
            list.Add(ch);
            num = "";
        }
        if (num.Length == 0 || !TryNum(num, out var last)) return null;
        list.Add(last);
        return list;
    }

    private static bool TryNum(string s, out decimal n) =>
        decimal.TryParse(s.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out n);
}
