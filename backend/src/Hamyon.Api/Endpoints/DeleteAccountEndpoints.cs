using System.Net;
using Hamyon.Api.Auth;
using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Domain;

namespace Hamyon.Api.Endpoints;

/// <summary>
/// Public account deletion page (the stores require a web way to delete an account): GET /delete-account shows a form,
/// POST checks the email and password (same lockout as sign-in) and deletes the account with all its data at once.
/// </summary>
public static class DeleteAccountEndpoints
{
    public static void MapDeleteAccountPage(this IEndpointRouteBuilder app)
    {
        app.MapGet("/delete-account", (string? lang) => Html(Page(Lang(lang), null, false)))
            .ExcludeFromDescription().AllowAnonymous();

        app.MapPost("/delete-account", async (HttpContext ctx, AuthService auth, AppDbContext db, CancellationToken ct) =>
        {
            var form = await ctx.Request.ReadFormAsync(ct);
            var lang = Lang(form["lang"]);
            var t = Texts(lang);
            string email = form["email"].ToString().Trim(), password = form["password"].ToString();
            if (email.Length == 0 || password.Length == 0 || form["confirm"] != "on")
                return Html(Page(lang, t.Missing, false));
            try
            {
                var signedIn = await auth.LoginAsync(new LoginRequest(email, password), ctx.Connection.RemoteIpAddress?.ToString(), ct);
                await AuthEndpoints.DeleteAccountAsync(db, signedIn.User.Id, ct);
                return Html(Page(lang, t.Done, true));
            }
            catch (DomainException e)
            {
                return Html(Page(lang, e.Code == "auth.locked" ? t.Locked : t.Wrong, false));
            }
        }).ExcludeFromDescription().AllowAnonymous().DisableAntiforgery().RequireRateLimiting("auth");
    }

    private static IResult Html(string body) => Results.Content(body, "text/html; charset=utf-8");

    private static string Lang(string? l) => l?.ToLowerInvariant() is "ru" or "en" ? l.ToLowerInvariant() : "uz";

    private sealed record T(string Title, string Intro, string Email, string Password, string Confirm, string Button,
        string Missing, string Wrong, string Locked, string Done, string Google);

    private static T Texts(string lang) => lang switch
    {
        "ru" => new("Удаление аккаунта — Raqamli Hamyon",
            "Аккаунт и все синхронизированные данные (кошельки, операции, категории, профили) будут удалены с сервера сразу и навсегда. Данные на вашем телефоне останутся, пока вы не удалите их в приложении.",
            "Email", "Пароль", "Я понимаю, что это нельзя отменить", "Удалить аккаунт",
            "Введите email и пароль и отметьте согласие.", "Неверный email или пароль.", "Слишком много попыток. Попробуйте позже.",
            "Готово: аккаунт и все его данные удалены с сервера.",
            "Если вы входили через Google, удалите аккаунт в приложении: Настройки → Аккаунт → Удалить аккаунт."),
        "en" => new("Delete account — Raqamli Hamyon",
            "Your account and all synced data (wallets, operations, categories, profiles) are deleted from the server at once and for good. Data on your phone stays until you delete it in the app.",
            "Email", "Password", "I understand this cannot be undone", "Delete account",
            "Enter your email and password and tick the box.", "Wrong email or password.", "Too many attempts. Please try again later.",
            "Done: the account and all its data have been deleted from the server.",
            "If you signed in with Google, delete the account in the app: Settings → Account → Delete account."),
        _ => new("Hisobni o‘chirish — Raqamli Hamyon",
            "Hisobingiz va undagi barcha sinxronlangan ma’lumotlar (hamyonlar, operatsiyalar, toifalar, profillar) serverdan darhol va butunlay o‘chiriladi. Telefoningizdagi ma’lumotlar ilovada o‘chirmaguningizcha qoladi.",
            "Email", "Parol", "Buni qaytarib bo‘lmasligini tushunaman", "Hisobni o‘chirish",
            "Email va parolni kiriting hamda roziligingizni belgilang.", "Email yoki parol noto‘g‘ri.", "Ko‘p urinish bo‘ldi. Keyinroq qayta urinib ko‘ring.",
            "Tayyor: hisob va undagi barcha ma’lumotlar serverdan o‘chirildi.",
            "Google orqali kirgan bo‘lsangiz, hisobni ilovada o‘chiring: Sozlamalar → Hisob → Hisobni o‘chirish."),
    };

    private static string Page(string lang, string? message, bool done)
    {
        var t = Texts(lang);
        string E(string s) => WebUtility.HtmlEncode(s);
        var msg = message is null ? "" : $"<p class=\"msg {(done ? "ok" : "err")}\">{E(message)}</p>";
        var form = done ? "" : $$"""
            <form method="post" action="/delete-account">
              <input type="hidden" name="lang" value="{{lang}}">
              <label>{{E(t.Email)}}<input type="email" name="email" autocomplete="email" required></label>
              <label>{{E(t.Password)}}<input type="password" name="password" autocomplete="current-password" required></label>
              <label class="chk"><input type="checkbox" name="confirm"> {{E(t.Confirm)}}</label>
              <button type="submit">{{E(t.Button)}}</button>
            </form>
            <p class="muted">{{E(t.Google)}}</p>
            """;
        return $$"""
            <!doctype html><html lang="{{lang}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>{{E(t.Title)}}</title>
            <style>
              :root { color-scheme: dark; }
              body { margin: 0; background: #0A0607; color: #FBF5F2; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
              main { max-width: 520px; margin: 0 auto; padding: 32px 18px 64px; }
              h1 { font-size: 24px; margin: 0 0 10px; } p { color: #E6DCD8; } .muted { color: #BFAEA9; font-size: 14px; }
              nav a, a { color: #F2C14E; margin-right: 14px; }
              label { display: block; margin: 14px 0 0; color: #BFAEA9; font-size: 14px; }
              input[type=email], input[type=password] { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 12px 14px;
                border-radius: 14px; border: 1px solid #4a3337; background: #1a0e11; color: #FBF5F2; font-size: 16px; }
              .chk { color: #FBF5F2; } button { margin-top: 18px; width: 100%; padding: 14px; border: 0; border-radius: 26px;
                background: #FF6B6B; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; }
              .msg { padding: 12px 14px; border-radius: 14px; } .err { background: #3a1416; color: #FF9A9A; } .ok { background: #10301f; color: #6EE7A8; }
            </style></head><body><main>
            <nav><a href="?lang=uz">O‘zbekcha</a><a href="?lang=ru">Русский</a><a href="?lang=en">English</a></nav>
            <h1>{{E(t.Title)}}</h1><p>{{E(t.Intro)}}</p>
            {{msg}}{{form}}
            </main></body></html>
            """;
    }
}
