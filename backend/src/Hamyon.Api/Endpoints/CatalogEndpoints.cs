using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Api.Ledger;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Endpoints;

public static class CatalogEndpoints
{
    public static void MapCatalogs(this IEndpointRouteBuilder app)
    {
        MapWallets(app);
        MapCategories(app);
        MapIncomeSources(app);
        MapPeople(app);
        MapProjects(app);
    }

    private static void MapWallets(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/wallets").WithTags("Wallets").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, bool? includeArchived, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var q = from w in db.Wallets.AsNoTracking()
                    join a in db.LedgerAccounts.AsNoTracking() on w.LedgerAccountId equals a.Id
                    where w.UserId == uid && (includeArchived == true || !w.IsArchived)
                    orderby w.SortOrder, w.CreatedAt
                    select new WalletDto(w.Id, w.Name, w.Type, w.Currency, a.Balance, w.Icon, w.Color, w.BankName,
                        w.MaskedNumber, w.Note, w.AllowOverdraft, w.IsArchived, w.SortOrder);
            return Results.Ok(await q.ToListAsync(ct));
        });

        g.MapPost("/", async (WalletRequest r, HttpContext ctx, FinanceService fin, AppDbContext db, CancellationToken ct) =>
        {
            var w = await fin.CreateWalletAsync(ctx.User.UserId(), r, ct);
            var bal = await db.LedgerAccounts.AsNoTracking().Where(a => a.Id == w.LedgerAccountId).Select(a => a.Balance).FirstAsync(ct);
            return Results.Created($"/api/wallets/{w.Id}", ToDto(w, bal));
        }).Validate<WalletRequest>();

        g.MapPatch("/{id:guid}", async (Guid id, WalletUpdateRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var w = await PatchWalletAsync(db, ctx.User.UserId(), id, r, ct);
            var bal = await db.LedgerAccounts.AsNoTracking().Where(a => a.Id == w.LedgerAccountId).Select(a => a.Balance).FirstAsync(ct);
            return Results.Ok(ToDto(w, bal));
        });

        g.MapPost("/{id:guid}/adjust", async (Guid id, AdjustRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.AdjustBalanceAsync(ctx.User.UserId(), id, r.NewBalance, r.Memo,
                r.ClientKey ?? Common.HeaderKey(ctx), ct)));
    }

    internal static async Task<Wallet> PatchWalletAsync(AppDbContext db, Guid uid, Guid id, WalletUpdateRequest r, CancellationToken ct)
    {
        var w = await db.Wallets.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Wallet");
        if (!string.IsNullOrWhiteSpace(r.Name)) w.Name = r.Name.Trim();
        if (r.Icon is not null) w.Icon = r.Icon;
        if (r.Color is not null) w.Color = r.Color;
        if (r.BankName is not null) w.BankName = r.BankName;
        if (r.MaskedNumber is not null)
        {
            if (r.MaskedNumber.Count(char.IsDigit) > 6)
                throw new DomainException("wallet.masked_only", "Store only the masked identifier (last digits).");
            w.MaskedNumber = r.MaskedNumber;
        }
        if (r.Note is not null) w.Note = r.Note;
        if (r.SortOrder is not null) w.SortOrder = r.SortOrder.Value;
        if (r.IsArchived is not null) w.IsArchived = r.IsArchived.Value;
        if (r.AllowOverdraft is not null)
        {
            w.AllowOverdraft = r.AllowOverdraft.Value;
            await db.LedgerAccounts.Where(a => a.Id == w.LedgerAccountId)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.AllowNegative, w.AllowOverdraft), ct);
        }
        await db.SaveChangesAsync(ct);
        return w;
    }

    private static WalletDto ToDto(Wallet w, decimal balance) => new(w.Id, w.Name, w.Type, w.Currency, balance, w.Icon,
        w.Color, w.BankName, w.MaskedNumber, w.Note, w.AllowOverdraft, w.IsArchived, w.SortOrder);

    private static void MapCategories(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/categories").WithTags("Categories").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = await db.Categories.AsNoTracking().Where(c => c.UserId == uid && !c.IsArchived)
                .OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync(ct);
            return Results.Ok(list.Select(Map));
        });

        g.MapPost("/", async (CategoryRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var (c, _) = await CreateCategoryAsync(db, ctx.User.UserId(), r, ct);
            return Results.Created($"/api/categories/{c.Id}", Map(c));
        });

        g.MapPut("/{id:guid}", async (Guid id, CategoryRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var c = await db.Categories.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Category");
            await ValidateCategoryAsync(r, uid, db, ct);
            if (r.ParentId == id) throw new DomainException("category.cycle", "A category cannot be its own parent.");
            c.Name = r.Name.Trim();
            c.Icon = r.Icon ?? c.Icon;
            c.Color = r.Color ?? c.Color;
            c.ParentId = r.ParentId;
            c.MonthlyLimit = r.MonthlyLimit;
            c.LimitCurrency = r.MonthlyLimit is null ? null : Currencies.Normalize(r.LimitCurrency ?? c.LimitCurrency ?? "UZS");
            if (r.SortOrder is not null) c.SortOrder = r.SortOrder.Value;
            await db.SaveChangesAsync(ct);
            return Results.Ok(Map(c));
        });

        // Categories referenced by history are archived, never physically deleted.
        g.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var c = await db.Categories.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Category");
            c.IsArchived = true;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    /// <summary>Creates a category; with a client id an already existing one is returned instead (created = false).</summary>
    internal static async Task<(Category Category, bool Created)> CreateCategoryAsync(AppDbContext db, Guid uid, CategoryRequest r,
        CancellationToken ct)
    {
        if (r.Id == Guid.Empty) throw new DomainException("sync.id_invalid", "Id cannot be empty.");
        if (r.Id is not null)
        {
            var existing = await db.Categories.FirstOrDefaultAsync(c => c.Id == r.Id && c.UserId == uid, ct);
            if (existing is not null) return (existing, false);
        }
        await ValidateCategoryAsync(r, uid, db, ct);
        var c = new Category
        {
            Id = r.Id ?? Guid.NewGuid(), UserId = uid, Name = r.Name.Trim(), Icon = r.Icon ?? "tag", Color = r.Color ?? "#EF4444",
            ParentId = r.ParentId, MonthlyLimit = r.MonthlyLimit,
            LimitCurrency = r.MonthlyLimit is null ? null : Currencies.Normalize(r.LimitCurrency ?? "UZS"),
            SortOrder = r.SortOrder ?? 0,
        };
        db.Categories.Add(c);
        await db.SaveChangesAsync(ct);
        return (c, true);
    }

    private static async Task ValidateCategoryAsync(CategoryRequest r, Guid uid, AppDbContext db, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80)
            throw new DomainException("category.name_invalid", "Category name is required (max 80).");
        if (r.MonthlyLimit is < 0) throw new DomainException("category.limit_invalid", "Limit cannot be negative.");
        if (r.ParentId is not null && !await db.Categories.AnyAsync(c => c.Id == r.ParentId && c.UserId == uid, ct))
            throw new NotFoundException("Parent category");
    }

    private static CategoryDto Map(Category c) => new(c.Id, c.Name, c.Icon, c.Color, c.ParentId, c.MonthlyLimit,
        c.LimitCurrency, c.IsArchived, c.SortOrder);

    internal static async Task<(IncomeSource Source, bool Created)> CreateSourceAsync(AppDbContext db, Guid uid, IncomeSourceRequest r,
        CancellationToken ct)
    {
        if (r.Id == Guid.Empty) throw new DomainException("sync.id_invalid", "Id cannot be empty.");
        if (r.Id is not null)
        {
            var existing = await db.IncomeSources.FirstOrDefaultAsync(c => c.Id == r.Id && c.UserId == uid, ct);
            if (existing is not null) return (existing, false);
        }
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80)
            throw new DomainException("source.name_invalid", "Name is required (max 80).");
        var s = new IncomeSource
        {
            Id = r.Id ?? Guid.NewGuid(), UserId = uid, Name = r.Name.Trim(), Icon = r.Icon ?? "briefcase",
            Color = r.Color ?? "#22C55E", SortOrder = r.SortOrder ?? 0,
        };
        db.IncomeSources.Add(s);
        await db.SaveChangesAsync(ct);
        return (s, true);
    }

    private static void MapIncomeSources(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/income-sources").WithTags("IncomeSources").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = await db.IncomeSources.AsNoTracking().Where(c => c.UserId == uid && !c.IsArchived)
                .OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync(ct);
            return Results.Ok(list.Select(s => new IncomeSourceDto(s.Id, s.Name, s.Icon, s.Color, s.IsArchived, s.SortOrder)));
        });

        g.MapPost("/", async (IncomeSourceRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var (s, _) = await CreateSourceAsync(db, ctx.User.UserId(), r, ct);
            return Results.Created($"/api/income-sources/{s.Id}", new IncomeSourceDto(s.Id, s.Name, s.Icon, s.Color, s.IsArchived, s.SortOrder));
        });

        g.MapPut("/{id:guid}", async (Guid id, IncomeSourceRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var s = await db.IncomeSources.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Income source");
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80)
                throw new DomainException("source.name_invalid", "Name is required (max 80).");
            s.Name = r.Name.Trim();
            s.Icon = r.Icon ?? s.Icon;
            s.Color = r.Color ?? s.Color;
            if (r.SortOrder is not null) s.SortOrder = r.SortOrder.Value;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new IncomeSourceDto(s.Id, s.Name, s.Icon, s.Color, s.IsArchived, s.SortOrder));
        });

        g.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var s = await db.IncomeSources.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Income source");
            s.IsArchived = true;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static void MapPeople(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/people").WithTags("People").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = await db.People.AsNoTracking().Where(p => p.UserId == uid).OrderBy(p => p.Name).ToListAsync(ct);
            return Results.Ok(list.Select(p => new PersonDto(p.Id, p.Name, p.Phone, p.Note)));
        });

        g.MapPost("/", async (PersonRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 100)
                throw new DomainException("person.name_invalid", "Name is required (max 100).");
            var p = new Person { UserId = ctx.User.UserId(), Name = r.Name.Trim(), Phone = r.Phone, Note = r.Note };
            db.People.Add(p);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/people/{p.Id}", new PersonDto(p.Id, p.Name, p.Phone, p.Note));
        });

        g.MapPut("/{id:guid}", async (Guid id, PersonRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var p = await db.People.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Person");
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 100)
                throw new DomainException("person.name_invalid", "Name is required (max 100).");
            p.Name = r.Name.Trim();
            p.Phone = r.Phone;
            p.Note = r.Note;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new PersonDto(p.Id, p.Name, p.Phone, p.Note));
        });
    }

    private static void MapProjects(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projects").WithTags("Projects").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = await db.Projects.AsNoTracking().Where(p => p.UserId == uid && !p.IsArchived).OrderBy(p => p.Name).ToListAsync(ct);
            return Results.Ok(list.Select(Map));
        });

        g.MapPost("/", async (ProjectRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80)
                throw new DomainException("project.name_invalid", "Name is required (max 80).");
            var cur = Currencies.Normalize(r.Currency);
            if (!Currencies.IsSupported(cur)) throw new DomainException("currency.unsupported", "Unsupported currency.");
            var p = new Project
            {
                UserId = ctx.User.UserId(), Name = r.Name.Trim(), Icon = r.Icon ?? "folder",
                Color = r.Color ?? "#8B5CF6", Currency = cur, Note = r.Note,
            };
            db.Projects.Add(p);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/projects/{p.Id}", Map(p));
        });

        g.MapPut("/{id:guid}", async (Guid id, ProjectRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Project");
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 80)
                throw new DomainException("project.name_invalid", "Name is required (max 80).");
            p.Name = r.Name.Trim();
            p.Icon = r.Icon ?? p.Icon;
            p.Color = r.Color ?? p.Color;
            p.Note = r.Note;
            await db.SaveChangesAsync(ct);
            return Results.Ok(Map(p));
        });

        g.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct) ?? throw new NotFoundException("Project");
            p.IsArchived = true;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static ProjectDto Map(Project p) => new(p.Id, p.Name, p.Icon, p.Color, p.Currency, p.Note, p.IsArchived);
}

public sealed record AdjustRequest(decimal NewBalance, string? Memo, string? ClientKey);
