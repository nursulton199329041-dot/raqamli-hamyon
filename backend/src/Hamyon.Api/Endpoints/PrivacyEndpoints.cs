using System.Net;

namespace Hamyon.Api.Endpoints;

/// <summary>
/// Public privacy policy page for the stores: GET /privacy (?lang=uz|ru|en, Uzbek by default).
/// The contact address comes from configuration (Privacy:Contact) so it can change without a release.
/// </summary>
public static class PrivacyEndpoints
{
    public static void MapPrivacy(this IEndpointRouteBuilder app)
    {
        app.MapGet("/privacy", (string? lang, IConfiguration cfg) =>
        {
            var l = lang?.ToLowerInvariant() is "ru" or "en" ? lang.ToLowerInvariant() : "uz";
            var contact = cfg["Privacy:Contact"];
            return Results.Content(Page(l, string.IsNullOrWhiteSpace(contact) ? null : contact.Trim()), "text/html; charset=utf-8");
        }).ExcludeFromDescription().AllowAnonymous();
    }

    private static string Page(string lang, string? contact)
    {
        var (title, updated, items, contactTitle, contactText) = lang switch
        {
            "ru" => ("Raqamli Hamyon — Политика конфиденциальности", "Обновлено: 14 ноября 2026", Ru, "Связь", "Вопросы и запросы на удаление данных:"),
            "en" => ("Raqamli Hamyon — Privacy policy", "Updated: 14 November 2026", En, "Contact", "Questions and data deletion requests:"),
            _ => ("Raqamli Hamyon — Maxfiylik siyosati", "Oxirgi yangilanish: 2026-yil 14-noyabr", Uz, "Bog‘lanish", "Savollar va ma’lumotni o‘chirish so‘rovlari bo‘yicha:"),
        };
        var body = string.Concat(items.Select(i => $"<h2>{Enc(i.H)}</h2><p>{Enc(i.P)}</p>"));
        var mail = contact is null ? "" : $"<h2>{Enc(contactTitle)}</h2><p>{Enc(contactText)} <a href=\"mailto:{Enc(contact)}\">{Enc(contact)}</a></p>";
        return $$"""
            <!doctype html><html lang="{{lang}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>{{Enc(title)}}</title>
            <style>
              :root { color-scheme: dark; }
              body { margin: 0; background: #0A0607; color: #FBF5F2; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
              main { max-width: 760px; margin: 0 auto; padding: 32px 18px 64px; }
              h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 26px 0 6px; color: #F2C14E; }
              p { margin: 0; color: #E6DCD8; } .muted { color: #BFAEA9; font-size: 14px; } a { color: #F2C14E; }
              nav { margin: 0 0 22px; } nav a { margin-right: 14px; }
            </style></head><body><main>
            <nav><a href="?lang=uz">O‘zbekcha</a><a href="?lang=ru">Русский</a><a href="?lang=en">English</a></nav>
            <h1>{{Enc(title)}}</h1><p class="muted">{{Enc(updated)}}</p>
            {{body}}{{mail}}
            </main></body></html>
            """;
    }

    private static string Enc(string s) => WebUtility.HtmlEncode(s);

    private sealed record Item(string H, string P);

    private static readonly Item[] Uz =
    [
        new("Ilova haqida", "Raqamli Hamyon shaxsiy va oilaviy moliyani hisobga olish uchun mo‘ljallangan."),
        new("Hisobsiz foydalanish", "Ilova ro‘yxatdan o‘tmasdan to‘liq ishlaydi. Bunda hamyonlar, operatsiyalar, toifalar, qarzlar, byudjetlar va sozlamalar faqat qurilmangizda saqlanadi va hech qayerga yuborilmaydi."),
        new("Hisob va sinxronlash (ixtiyoriy)", "Sozlamalar → “Hisob” orqali email va parol bilan kirsangiz, ma’lumotlaringiz bir nechta qurilmada bir xil bo‘lishi uchun serverimizga (hamyon.raqamlinazorat.uz) yuboriladi va saqlanadi: email, ism va ilovaga kiritgan moliyaviy yozuvlaringiz. Parol serverda faqat xeshlangan holda saqlanadi. Barcha uzatishlar HTTPS orqali shifrlanadi."),
        new("Ma’lumotdan foydalanish", "Ma’lumotlar faqat sinxronlash va hisobingizni yuritish uchun ishlatiladi. Ular sotilmaydi, reklama yoki analitika uchun ishlatilmaydi va uchinchi shaxslarga berilmaydi."),
        new("Valyuta kursi", "Valyuta kursini olish uchun ilova O‘zbekiston Respublikasi Markaziy bankining ochiq sahifasiga (cbu.uz) murojaat qiladi. Bunda shaxsiy ma’lumot yuborilmaydi."),
        new("Xavfsizlik", "Ilovaga PIN-kod, barmoq izi yoki Face ID bilan kirishni yoqish mumkin. PIN-kod qurilmada xeshlangan holda saqlanadi."),
        new("Reklama va kuzatuv", "Ilovada reklama, analitika yoki kuzatuv vositalari yo‘q."),
        new("Ma’lumotni o‘chirish", "Qurilmadagi ma’lumotlarni Sozlamalar → “Ma’lumotlarni o‘chirish” orqali yoki ilovani o‘chirib yuborib o‘chirasiz. Serverdagi hisobingiz va undagi barcha ma’lumotlarni o‘chirishni so‘rasangiz, 30 kun ichida o‘chiriladi."),
        new("Bolalar", "Ilova 18 yoshdan kichiklarga mo‘ljallanmagan va ulardan ataylab ma’lumot yig‘maydi."),
    ];

    private static readonly Item[] Ru =
    [
        new("О приложении", "Raqamli Hamyon предназначено для учёта личных и семейных финансов."),
        new("Без аккаунта", "Приложение полностью работает без регистрации. Кошельки, операции, категории, долги, бюджеты и настройки хранятся только на вашем устройстве и никуда не отправляются."),
        new("Аккаунт и синхронизация (по желанию)", "Если вы войдёте через Настройки → «Аккаунт» по email и паролю, данные отправляются и хранятся на нашем сервере (hamyon.raqamlinazorat.uz), чтобы они были одинаковыми на нескольких устройствах: email, имя и ваши финансовые записи. Пароль хранится только в виде хеша. Передача шифруется (HTTPS)."),
        new("Использование данных", "Данные используются только для синхронизации и ведения аккаунта. Они не продаются, не используются для рекламы или аналитики и не передаются третьим лицам."),
        new("Курс валют", "Для курса валют приложение обращается к открытой странице Центрального банка Узбекистана (cbu.uz) без передачи личных данных."),
        new("Безопасность", "Можно включить вход по PIN-коду, отпечатку или Face ID. PIN хранится на устройстве в виде хеша."),
        new("Реклама и отслеживание", "В приложении нет рекламы, аналитики и средств отслеживания."),
        new("Удаление данных", "Данные на устройстве удаляются через Настройки → «Удалить данные» или удалением приложения. Аккаунт и все данные на сервере удаляются по запросу в течение 30 дней."),
        new("Дети", "Приложение не предназначено для лиц младше 18 лет и намеренно не собирает их данные."),
    ];

    private static readonly Item[] En =
    [
        new("About", "Raqamli Hamyon is an app for tracking personal and family finances."),
        new("Without an account", "The app works fully without signing up. Wallets, operations, categories, debts, budgets and settings stay on your device only and are not sent anywhere."),
        new("Account and sync (optional)", "If you sign in with email and password (Settings → Account), your data is sent to and stored on our server (hamyon.raqamlinazorat.uz) so it is the same on several devices: email, name and the financial records you enter. Passwords are stored only as hashes. All traffic is encrypted (HTTPS)."),
        new("How data is used", "Data is used only for sync and your account. It is not sold, not used for ads or analytics, and not shared with third parties."),
        new("Exchange rates", "For exchange rates the app reads the public page of the Central Bank of Uzbekistan (cbu.uz); no personal data is sent."),
        new("Security", "You can lock the app with a PIN, fingerprint or Face ID. The PIN is stored on the device as a hash."),
        new("Ads and tracking", "There are no ads, analytics or tracking tools."),
        new("Deleting data", "Delete data on the device in Settings → “Delete data” or by uninstalling the app. Your account and all its data on the server are deleted on request within 30 days."),
        new("Children", "The app is not intended for anyone under 18 and does not knowingly collect their data."),
    ];
}
