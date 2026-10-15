using Hamyon.Api.Reports;
using Hamyon.Domain;

namespace Hamyon.Api.Endpoints;

public static class ReportEndpoints
{
    public static void MapReports(this IEndpointRouteBuilder app)
    {
        var a = app.MapGroup("/api/analytics").WithTags("Analytics").RequireAuthorization();

        a.MapGet("/summary", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q, CancellationToken ct) =>
            Results.Ok(await svc.SummaryAsync(ctx.User.UserId(), q, ct)));

        a.MapGet("/timeseries", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q,
            string? granularity, CancellationToken ct) =>
        {
            var g = granularity is "day" or "week" or "month" or "year" ? granularity : "day";
            return Results.Ok(await svc.TimeSeriesAsync(ctx.User.UserId(), q, g, ct));
        });

        a.MapGet("/breakdown", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q,
            string? by, CancellationToken ct) =>
        {
            var key = by is "wallet" or "project" or "person" or "source" ? by : "category";
            return Results.Ok(await svc.BreakdownAsync(ctx.User.UserId(), q, key, ct));
        });

        a.MapGet("/budgets", async (HttpContext ctx, AnalyticsService svc, CancellationToken ct) =>
            Results.Ok(await svc.BudgetsAsync(ctx.User.UserId(), DateTimeOffset.UtcNow, ct)));

        app.MapGet("/api/reports/export", async (HttpContext ctx, ExportService export, [AsParameters] TransactionQuery q,
            string? format, string? lang, CancellationToken ct) =>
        {
            var table = await export.BuildAsync(ctx.User.UserId(), q, lang ?? "uz", ct);
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmm");
            switch ((format ?? "csv").ToLowerInvariant())
            {
                case "xlsx":
                    return Results.File(ExportService.ToXlsx(table),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"hamyon-{stamp}.xlsx");
                case "pdf":
                    return Results.File(PdfReport.Build(table), "application/pdf", $"hamyon-{stamp}.pdf");
                case "csv":
                    return Results.File(ExportService.ToCsv(table), "text/csv; charset=utf-8", $"hamyon-{stamp}.csv");
                default:
                    throw new DomainException("export.format", "Format must be csv, xlsx or pdf.");
            }
        }).WithTags("Reports").RequireAuthorization();
    }
}
