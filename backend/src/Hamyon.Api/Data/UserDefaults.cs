using Hamyon.Domain;

namespace Hamyon.Api.Data;

/// <summary>Default categories and income sources created for every new account (user may edit/archive them).</summary>
public static class UserDefaults
{
    private static readonly (string Name, string Icon, string Color)[] Categories =
    [
        ("Oziq-ovqat", "food", "#F97316"),
        ("Transport", "transport", "#3B82F6"),
        ("Kommunal", "utilities", "#14B8A6"),
        ("Uy", "home", "#8B5CF6"),
        ("Oylik", "salary", "#EAB308"),
        ("Xodim", "staff", "#EC4899"),
        ("Uskuna", "equipment", "#64748B"),
        ("Ta'mirlash", "repair", "#F43F5E"),
        ("Telefon va internet", "phone", "#06B6D4"),
        ("Loyiha xarajatlari", "project", "#A855F7"),
        ("Ko'ngilochar", "fun", "#F59E0B"),
        ("Boshqa", "other", "#94A3B8"),
    ];

    private static readonly (string Name, string Icon, string Color)[] Sources =
    [
        ("Ish haqi", "salary", "#22C55E"),
        ("Biznes", "business", "#16A34A"),
        ("Boshqa kirim", "other", "#84CC16"),
    ];

    public static void Seed(AppDbContext db, Guid userId)
    {
        var i = 0;
        foreach (var (name, icon, color) in Categories)
            db.Categories.Add(new Category { UserId = userId, Name = name, Icon = icon, Color = color, SortOrder = i++ });
        i = 0;
        foreach (var (name, icon, color) in Sources)
            db.IncomeSources.Add(new IncomeSource { UserId = userId, Name = name, Icon = icon, Color = color, SortOrder = i++ });
    }
}
