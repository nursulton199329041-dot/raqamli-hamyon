using System;

namespace Hamyon.App.Models;

public enum PeriodKind { Week, Month, Year, All }

public readonly record struct Period(PeriodKind Kind, DateTime From, DateTime To)
{
    private static readonly string[] MonthsUz = ["YAN", "FEV", "MAR", "APR", "MAY", "IYN", "IYL", "AVG", "SEN", "OKT", "NOY", "DEK"];

    public static Period Of(PeriodKind kind, DateTime now)
    {
        var d = now.Date;
        return kind switch
        {
            PeriodKind.Week => FromStart(kind, d.AddDays(-(((int)d.DayOfWeek + 6) % 7)), 7),
            PeriodKind.Month => new(kind, new DateTime(d.Year, d.Month, 1), new DateTime(d.Year, d.Month, 1).AddMonths(1).AddTicks(-1)),
            PeriodKind.Year => new(kind, new DateTime(d.Year, 1, 1), new DateTime(d.Year + 1, 1, 1).AddTicks(-1)),
            _ => new(kind, DateTime.MinValue, DateTime.MaxValue),
        };
    }

    private static Period FromStart(PeriodKind kind, DateTime start, int days) => new(kind, start, start.AddDays(days).AddTicks(-1));

    public PeriodKind Next() => Kind switch
    {
        PeriodKind.Week => PeriodKind.Month,
        PeriodKind.Month => PeriodKind.Year,
        PeriodKind.Year => PeriodKind.All,
        _ => PeriodKind.Week,
    };

    /// <summary>"01 NOY. – 30 NOY." (same shape as the React Native app's period chip).</summary>
    public string Label => Kind == PeriodKind.All
        ? "BUTUN DAVR"
        : $"{F(From)} – {F(To)}";

    private static string F(DateTime d) => $"{d.Day:00} {MonthsUz[d.Month - 1]}.";
}
