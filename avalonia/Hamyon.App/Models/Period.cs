using System;
using Hamyon.App.Localization;

namespace Hamyon.App.Models;

/// <summary>The accounting period choices (the period sheet lists them in this order).</summary>
public enum PeriodKind { Week, Month, Quarter, HalfYear, Year, All, Custom }

public readonly record struct Period(PeriodKind Kind, DateTime From, DateTime To)
{
    /// <summary>The period of this kind that contains <paramref name="now"/> (Custom = that one day).</summary>
    public static Period Of(PeriodKind kind, DateTime now)
    {
        var d = now.Date;
        var monday = d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
        return kind switch
        {
            PeriodKind.Week => Span(kind, monday, monday.AddDays(7)),
            PeriodKind.Month => Months(kind, new DateTime(d.Year, d.Month, 1), 1),
            PeriodKind.Quarter => Months(kind, new DateTime(d.Year, (d.Month - 1) / 3 * 3 + 1, 1), 3),
            PeriodKind.HalfYear => Months(kind, new DateTime(d.Year, d.Month <= 6 ? 1 : 7, 1), 6),
            PeriodKind.Year => Months(kind, new DateTime(d.Year, 1, 1), 12),
            PeriodKind.Custom => Custom(d, d),
            _ => new(kind, DateTime.MinValue, DateTime.MaxValue),
        };
    }

    /// <summary>From the start of <paramref name="from"/>'s day to the end of <paramref name="to"/>'s day (swapped if reversed).</summary>
    public static Period Custom(DateTime from, DateTime to)
    {
        if (to < from) (from, to) = (to, from);
        return Span(PeriodKind.Custom, from.Date, to.Date.AddDays(1));
    }

    private static Period Months(PeriodKind kind, DateTime start, int months) => Span(kind, start, start.AddMonths(months));
    private static Period Span(PeriodKind kind, DateTime start, DateTime endExclusive) => new(kind, start, endExclusive.AddTicks(-1));

    /// <summary>The same kind of period one step earlier (-1) or later (+1). "All" does not move.</summary>
    public Period Shift(int dir) => Kind switch
    {
        PeriodKind.Week => Span(Kind, From.AddDays(7 * dir), From.AddDays(7 * dir + 7)),
        PeriodKind.Month => Months(Kind, From.AddMonths(dir), 1),
        PeriodKind.Quarter => Months(Kind, From.AddMonths(3 * dir), 3),
        PeriodKind.HalfYear => Months(Kind, From.AddMonths(6 * dir), 6),
        PeriodKind.Year => Months(Kind, From.AddYears(dir), 12),
        PeriodKind.Custom => Span(Kind, From.AddDays(Days * dir), From.AddDays(Days * dir + Days)),
        _ => this,
    };

    public bool CanShift => Kind != PeriodKind.All;

    /// <summary>A later period would start after today.</summary>
    public bool IsLatest => !CanShift || To >= DateTime.Today;

    /// <summary>Whole days in the period.</summary>
    public int Days => Kind == PeriodKind.All ? int.MaxValue : (int)Math.Round((To - From).TotalDays);

    public bool Contains(DateTime t) => t >= From && t <= To;

    /// <summary>Old cycle for the home chip: week → month → year → all → week.</summary>
    public PeriodKind Next() => Kind switch
    {
        PeriodKind.Week => PeriodKind.Month,
        PeriodKind.Month => PeriodKind.Year,
        PeriodKind.Year => PeriodKind.All,
        _ => PeriodKind.Week,
    };

    /// <summary>"01 OKT. – 31 DEK." (the year is added when it is not the current one).</summary>
    public string Label
    {
        get
        {
            if (Kind == PeriodKind.All) return L.T("all_time");
            var years = From.Year != To.Year || To.Year != DateTime.Today.Year;
            return $"{F(From, From.Year != To.Year)} – {F(To, years)}";
        }
    }

    /// <summary>Header title: "Noyabr 2026" for a month, "2026" for a year, otherwise the range.</summary>
    public string Title => Kind switch
    {
        PeriodKind.Month => $"{L.Month(From.Month)} {From.Year}",
        PeriodKind.Year => $"{From.Year}",
        _ => Label,
    };

    private static string F(DateTime d, bool year) => $"{d.Day:00} {L.MonthShort(d.Month).ToUpperInvariant()}." + (year ? $" {d.Year}" : "");
}
