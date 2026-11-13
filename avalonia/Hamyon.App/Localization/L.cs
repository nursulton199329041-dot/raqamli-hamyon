using System;
using System.Collections.Generic;
using Avalonia.Markup.Xaml;

namespace Hamyon.App.Localization;

public enum Lang { Uz = 0, Ru = 1, En = 2 }

/// <summary>
/// UI strings in Uzbek, Russian and English. Views read them once when built ({l:T key}); a language change rebuilds
/// the shell, so no per-string change tracking is needed. User data (wallet and category names) is never translated.
/// </summary>
public static class L
{
    public static Lang Current { get; set; } = Lang.Uz;

    public static string T(string key) =>
        S.TryGetValue(key, out var v) ? v[(int)Current] : key;

    public static string T(string key, params object[] args) => string.Format(T(key), args);

    public static string Month(int m) => MonthsFull[(int)Current][m - 1];
    public static string MonthShort(int m) => MonthsShort[(int)Current][m - 1];
    public static string Weekday(DayOfWeek d) => Weekdays[(int)Current][(int)d];

    private static readonly string[][] MonthsFull =
    [
        ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
        ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    ];
    private static readonly string[][] MonthsShort =
    [
        ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"],
        ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    ];
    private static readonly string[][] Weekdays =
    [
        ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"],
        ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
        ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    ];

    private static readonly Dictionary<string, string[]> S = new()
    {
        // shell
        ["tab_home"] = ["BOSH", "ГЛАВНАЯ", "HOME"],
        ["tab_history"] = ["TARIX", "ИСТОРИЯ", "HISTORY"],
        ["tab_reports"] = ["HISOBOT", "ОТЧЁТЫ", "REPORTS"],
        ["tab_settings"] = ["SOZLAMALAR", "НАСТРОЙКИ", "SETTINGS"],
        ["app"] = ["RAQAMLI HAMYON", "ЦИФРОВОЙ КОШЕЛЁК", "DIGITAL WALLET"],
        ["back"] = ["Orqaga", "Назад", "Back"],
        ["cancel"] = ["Bekor qilish", "Отмена", "Cancel"],
        ["save"] = ["SAQLASH", "СОХРАНИТЬ", "SAVE"],
        ["delete"] = ["O‘CHIRISH", "УДАЛИТЬ", "DELETE"],

        // home
        ["total_balance"] = ["UMUMIY BALANS", "ОБЩИЙ БАЛАНС", "TOTAL BALANCE"],
        ["income_sources"] = ["KIRIM MANBALARI", "ИСТОЧНИКИ ДОХОДА", "INCOME SOURCES"],
        ["wallets"] = ["HAMYONLAR", "КОШЕЛЬКИ", "WALLETS"],
        ["expense_categories"] = ["XARAJAT TOIFALARI", "КАТЕГОРИИ РАСХОДОВ", "EXPENSE CATEGORIES"],
        ["all_time"] = ["BUTUN DAVR", "ЗА ВСЁ ВРЕМЯ", "ALL TIME"],
        ["debts_card"] = ["QARZLAR", "ДОЛГИ", "DEBTS"],
        ["owed_to_me"] = ["Menga qarzdor", "Мне должны", "Owed to me"],
        ["i_owe"] = ["Men qarzdorman", "Я должен", "I owe"],

        // operation sheet
        ["op_income"] = ["Kirim", "Доход", "Income"],
        ["op_expense"] = ["Xarajat", "Расход", "Expense"],
        ["op_transfer"] = ["O‘tkazma", "Перевод", "Transfer"],
        ["op_lend"] = ["Qarz berdim", "Дал в долг", "Lent"],
        ["op_borrow"] = ["Qarz oldim", "Взял в долг", "Borrowed"],
        ["amount"] = ["SUMMA", "СУММА", "AMOUNT"],
        ["from_source"] = ["KIRIM MANBASI", "ИСТОЧНИК", "SOURCE"],
        ["from_wallet"] = ["QAYSI HAMYONDAN", "ИЗ КОШЕЛЬКА", "FROM WALLET"],
        ["to_wallet"] = ["QAYSI HAMYONGA", "В КОШЕЛЁК", "TO WALLET"],
        ["category"] = ["TOIFA", "КАТЕГОРИЯ", "CATEGORY"],
        ["person"] = ["KIM", "КТО", "WHO"],
        ["person_hint"] = ["Ism (masalan, Akmal)", "Имя (например, Акмал)", "Name (e.g. Akmal)"],
        ["received_amount"] = ["QABUL QILINADIGAN SUMMA", "СУММА ПОЛУЧЕНИЯ", "RECEIVED AMOUNT"],
        ["date"] = ["SANA", "ДАТА", "DATE"],
        ["note_hint"] = ["Izoh (ixtiyoriy)", "Комментарий (необязательно)", "Note (optional)"],
        ["today"] = ["Bugun", "Сегодня", "Today"],
        ["yesterday"] = ["Kecha", "Вчера", "Yesterday"],
        ["err_amount"] = ["Summani kiriting", "Введите сумму", "Enter the amount"],
        ["err_pick_expense"] = ["Hamyon va toifani tanlang", "Выберите кошелёк и категорию", "Choose a wallet and a category"],
        ["err_pick"] = ["Ikkala tomonni tanlang", "Выберите обе стороны", "Choose both sides"],
        ["err_funds"] = ["Hamyonda yetarli mablag‘ yo‘q ({0})", "Недостаточно средств в кошельке ({0})", "Not enough money in the wallet ({0})"],
        ["err_other_wallet"] = ["Boshqa hamyonni tanlang", "Выберите другой кошелёк", "Choose another wallet"],
        ["err_to_amount"] = ["Qabul qilinadigan summani kiriting ({0})", "Введите сумму получения ({0})", "Enter the received amount ({0})"],
        ["err_person"] = ["Kimligini yozing", "Укажите, кто", "Enter who"],
        ["err_wallet"] = ["Hamyonni tanlang", "Выберите кошелёк", "Choose a wallet"],

        // exchange rate (expense from a non-so'm wallet)
        ["rate_label"] = ["KURS: 1 {0} =", "КУРС: 1 {0} =", "RATE: 1 {0} ="],
        ["rate_hint_cbu"] = ["Markaziy bank kursi", "Курс Центробанка", "Central Bank rate"],
        ["rate_hint_last"] = ["Oxirgi ma’lum kurs", "Последний известный курс", "Last known rate"],
        ["rate_hint_manual"] = ["Kursni kiriting", "Введите курс", "Enter the rate"],
        ["err_rate"] = ["{0} kursini kiriting", "Введите курс {0}", "Enter the {0} rate"],

        // history
        ["search"] = ["Qidirish", "Поиск", "Search"],
        ["saldo"] = ["SALDO", "САЛЬДО", "NET"],
        ["incomes"] = ["TUSHUMLAR", "ПОСТУПЛЕНИЯ", "INCOME"],
        ["expenses"] = ["CHIQIMLAR", "РАСХОДЫ", "EXPENSES"],
        ["no_ops_month"] = ["Bu oyda operatsiya yo‘q", "В этом месяце операций нет", "No operations this month"],
        ["lent_to"] = ["Qarz berildi: {0}", "Дал в долг: {0}", "Lent to {0}"],
        ["borrowed_from"] = ["Qarz olindi: {0}", "Взял в долг: {0}", "Borrowed from {0}"],

        // reports
        ["r_expenses"] = ["Xarajatlar", "Расходы", "Expenses"],
        ["r_incomes"] = ["Kirimlar", "Доходы", "Income"],
        ["r_month"] = ["Oy", "Месяц", "Month"],
        ["r_year"] = ["Yil", "Год", "Year"],
        ["r_quarter"] = ["Chorak", "Квартал", "Quarter"],
        ["avg_daily"] = ["KUNIGA O‘RTACHA", "В СРЕДНЕМ ЗА ДЕНЬ", "DAILY AVERAGE"],
        ["top_category"] = ["ENG KATTA TOIFA", "КРУПНЕЙШАЯ КАТЕГОРИЯ", "TOP CATEGORY"],
        ["top_source"] = ["ENG KATTA MANBA", "КРУПНЕЙШИЙ ИСТОЧНИК", "TOP SOURCE"],
        ["breakdown"] = ["TAQSIMOT", "РАСПРЕДЕЛЕНИЕ", "BREAKDOWN"],
        ["no_data"] = ["Bu davr uchun ma’lumot yo‘q", "Нет данных за этот период", "No data for this period"],

        // settings
        ["language"] = ["TIL", "ЯЗЫК", "LANGUAGE"],
        ["accent"] = ["ASOSIY RANG", "ОСНОВНОЙ ЦВЕТ", "ACCENT COLOUR"],
        ["data"] = ["MA’LUMOTLAR", "ДАННЫЕ", "DATA"],
        ["manage_wallets"] = ["Hamyonlar", "Кошельки", "Wallets"],
        ["manage_categories"] = ["Xarajat toifalari", "Категории расходов", "Expense categories"],
        ["manage_sources"] = ["Kirim manbalari", "Источники дохода", "Income sources"],
        ["debts"] = ["Qarzlar", "Долги", "Debts"],
        ["wipe"] = ["Ma’lumotlarni o‘chirish", "Удалить данные", "Delete all data"],
        ["wipe_hint"] = ["Hamma yozuvlar o‘chadi, ilova boshidan boshlanadi", "Все записи удалятся, приложение начнётся заново", "All records are removed and the app starts over"],
        ["wipe_confirm"] = ["Ha, hammasini o‘chirish", "Да, удалить всё", "Yes, delete everything"],
        ["wipe_sure"] = ["Rostdan ham? Buni qaytarib bo‘lmaydi.", "Вы уверены? Это нельзя отменить.", "Are you sure? This cannot be undone."],
        ["local_note"] = ["Ma’lumotlar faqat shu telefonda saqlanadi.", "Данные хранятся только на этом телефоне.", "Your data is stored only on this phone."],
        ["version"] = ["Versiya", "Версия", "Version"],

        ["home_screen"] = ["BOSH SAHIFA", "ГЛАВНЫЙ ЭКРАН", "HOME SCREEN"],
        ["home_screen_hint"] = ["Belgilanganlari bosh sahifada ko‘rinadi", "Отмеченное показывается на главной", "Ticked blocks are shown on Home"],
        ["show_balance"] = ["Umumiy balans", "Общий баланс", "Total balance"],
        ["show_sources"] = ["Kirim manbalari", "Источники дохода", "Income sources"],
        ["show_wallets"] = ["Hamyonlar", "Кошельки", "Wallets"],
        ["show_categories"] = ["Xarajat toifalari", "Категории расходов", "Expense categories"],
        ["show_debts"] = ["Qarzlar kartasi", "Карточка долгов", "Debts card"],
        ["profiles_row"] = ["Profillar", "Профили", "Profiles"],

        // settings rows (like the reference app)
        ["main_currency"] = ["Asosiy valyuta", "Основная валюта", "Main currency"],
        ["main_currency_name"] = ["O‘zbek so‘mi", "Узбекский сум", "Uzbek som"],
        ["debts_switch_hint"] = ["Bosh sahifada qarzlar kartasi", "Карточка долгов на главной", "Debts card on Home"],
        ["panel_settings"] = ["Panel sozlamasi", "Настройка панели", "Home screen"],
        ["export"] = ["Eksport (CSV, PDF)", "Экспорт (CSV, PDF)", "Export (CSV, PDF)"],
        ["update_balances"] = ["Hamyon balanslarini yangilash", "Обновить балансы кошельков", "Update wallet balances"],
        ["update_balances_hint"] = ["Ba’zi operatsiyalarni o‘tkazib yuborgan bo‘lsangiz, joriy balansni to‘g‘rilang", "Если пропустили часть операций — скорректируйте текущие балансы", "Missed some operations? Correct the current balances"],
        ["wipe_ops"] = ["Faqat operatsiyalarni o‘chirish", "Удалить только операции", "Delete operations only"],
        ["wipe_all"] = ["Hammasini o‘chirish", "Удалить всё", "Delete everything"],
        ["wipe_hint2"] = ["Hamma ma’lumotni yoki faqat operatsiyalarni o‘chirib, boshidan boshlang", "Удалить все данные или только операции и начать сначала", "Delete all data or only operations and start over"],
        ["language_row"] = ["Til", "Язык", "Language"],
        ["password"] = ["Parol", "Пароль", "Password"],
        ["password_hint"] = ["Ilovani ochishda 4 xonali kod so‘raladi", "4-значный код при открытии приложения", "4-digit code when the app opens"],
        ["theme_row"] = ["Asosiy rang", "Основной цвет", "Accent colour"],
        ["security"] = ["XAVFSIZLIK VA KO‘RINISH", "БЕЗОПАСНОСТЬ И ВИД", "SECURITY AND LOOK"],
        ["catalog"] = ["KATALOG", "СПРАВОЧНИКИ", "CATALOG"],
        ["bio_android"] = ["Barmoq izi / yuz", "Отпечаток / лицо", "Fingerprint / face"],
        ["pin_enter"] = ["Kodni kiriting", "Введите код", "Enter your code"],
        ["pin_new"] = ["Yangi kod kiriting", "Придумайте код", "Set a new code"],
        ["pin_repeat"] = ["Kodni takrorlang", "Повторите код", "Repeat the code"],
        ["pin_mismatch"] = ["Kodlar mos kelmadi, qaytadan", "Коды не совпали, ещё раз", "Codes don’t match, try again"],
        ["pin_wrong"] = ["Kod noto‘g‘ri", "Неверный код", "Wrong code"],
        ["pin_bio_reason"] = ["Raqamli Hamyon’ni ochish", "Открыть Raqamli Hamyon", "Unlock Raqamli Hamyon"],
        ["exp_period"] = ["DAVR", "ПЕРИОД", "PERIOD"],
        ["exp_format"] = ["FORMAT", "ФОРМАТ", "FORMAT"],
        ["exp_this_month"] = ["Shu oy", "Этот месяц", "This month"],
        ["exp_last_month"] = ["O‘tgan oy", "Прошлый месяц", "Last month"],
        ["exp_this_year"] = ["Shu yil", "Этот год", "This year"],
        ["exp_all"] = ["Butun davr", "За всё время", "All time"],
        ["exp_save"] = ["SAQLASH", "СОХРАНИТЬ", "SAVE"],
        ["exp_done"] = ["Saqlandi: {0}", "Сохранено: {0}", "Saved: {0}"],
        ["exp_failed"] = ["Saqlab bo‘lmadi.", "Не удалось сохранить.", "Could not save."],
        ["exp_unavailable"] = ["Bu qurilmada fayl saqlash mavjud emas", "Сохранение файлов недоступно", "Saving files is not available here"],
        ["csv_date"] = ["Sana", "Дата", "Date"],
        ["csv_type"] = ["Tur", "Тип", "Type"],
        ["csv_amount"] = ["Summa", "Сумма", "Amount"],
        ["csv_in_uzs"] = ["So‘mda", "В сумах", "In UZS"],
        ["csv_rate"] = ["Kurs", "Курс", "Rate"],
        ["csv_wallet"] = ["Hamyon", "Кошелёк", "Wallet"],
        ["csv_counterpart"] = ["Toifa / manba / kim", "Категория / источник / кто", "Category / source / who"],
        ["csv_note"] = ["Izoh", "Примечание", "Note"],

        // account & sync
        ["acct_row"] = ["Hisob", "Аккаунт", "Account"],
        ["acct_row_hint"] = ["Kiring — ma’lumotlar telefonlar o‘rtasida sinxronlanadi", "Войдите — данные синхронизируются между телефонами", "Sign in to sync your data across phones"],
        ["acct_title"] = ["HISOB", "АККАУНТ", "ACCOUNT"],
        ["acct_intro"] = ["Bitta hisobga kirgan barcha telefonlarda ma’lumotlar bir xil bo‘ladi. Internet bo‘lmasa ham ilova ishlayveradi.", "На всех телефонах с этим аккаунтом данные одинаковые. Без интернета приложение тоже работает.", "Every phone signed in to this account has the same data. The app works offline too."],
        ["acct_email"] = ["EMAIL", "EMAIL", "EMAIL"],
        ["acct_password"] = ["PAROL", "ПАРОЛЬ", "PASSWORD"],
        ["acct_password_hint"] = ["Kamida 8 belgi", "Не менее 8 символов", "At least 8 characters"],
        ["acct_signin"] = ["KIRISH", "ВОЙТИ", "SIGN IN"],
        ["acct_register"] = ["RO‘YXATDAN O‘TISH", "ЗАРЕГИСТРИРОВАТЬСЯ", "SIGN UP"],
        ["acct_no_account"] = ["Hisobingiz yo‘qmi? Ro‘yxatdan o‘ting", "Нет аккаунта? Зарегистрируйтесь", "No account? Sign up"],
        ["acct_have_account"] = ["Hisobingiz bormi? Kiring", "Уже есть аккаунт? Войдите", "Have an account? Sign in"],
        ["acct_signed_in_as"] = ["Kirgansiz", "Вы вошли как", "Signed in as"],
        ["acct_sync_now"] = ["HOZIR SINXRONLASH", "СИНХРОНИЗИРОВАТЬ", "SYNC NOW"],
        ["acct_sign_out"] = ["Hisobdan chiqish", "Выйти из аккаунта", "Sign out"],
        ["acct_sign_out_hint"] = ["Ma’lumotlar telefonda qoladi, faqat sinxronlash to‘xtaydi", "Данные останутся на телефоне, синхронизация остановится", "Data stays on the phone; syncing stops"],
        ["acct_err_email"] = ["Email manzilni to‘g‘ri yozing", "Введите корректный email", "Enter a valid email"],
        ["acct_err_password"] = ["Parol kamida 8 belgi bo‘lsin", "Пароль — не менее 8 символов", "Password must be at least 8 characters"],
        ["acct_err_invalid"] = ["Email yoki parol noto‘g‘ri", "Неверный email или пароль", "Wrong email or password"],
        ["acct_err_taken"] = ["Bu email bilan hisob allaqachon bor — kiring", "Аккаунт с этим email уже есть — войдите", "This email already has an account — sign in"],
        ["acct_err_locked"] = ["Ko‘p urinish. Biroz kutib, qayta urinib ko‘ring", "Слишком много попыток. Подождите немного", "Too many attempts. Please wait a little"],
        ["acct_err_offline"] = ["Server bilan aloqa yo‘q. Internetni tekshiring", "Нет связи с сервером. Проверьте интернет", "Can’t reach the server. Check the internet"],
        ["acct_err_server"] = ["Serverda xatolik. Keyinroq urinib ko‘ring", "Ошибка сервера. Попробуйте позже", "Server error. Try again later"],
        ["sync_running"] = ["Sinxronlanmoqda…", "Синхронизация…", "Syncing…"],
        ["sync_done"] = ["Sinxronlandi: {0}", "Синхронизировано: {0}", "Synced: {0}"],
        ["sync_offline"] = ["Internet yo‘q — o‘zgarishlar keyin yuboriladi", "Нет интернета — изменения отправятся позже", "Offline — changes will be sent later"],
        ["sync_signed_out"] = ["Hisobdan chiqildi — qayta kiring", "Сессия завершена — войдите снова", "Signed out — please sign in again"],

        // catalog editor
        ["add"] = ["QO‘SHISH", "ДОБАВИТЬ", "ADD"],
        ["new_wallet"] = ["Yangi hamyon", "Новый кошелёк", "New wallet"],
        ["new_category"] = ["Yangi toifa", "Новая категория", "New category"],
        ["new_source"] = ["Yangi manba", "Новый источник", "New source"],
        ["edit"] = ["Tahrirlash", "Изменить", "Edit"],
        ["name"] = ["NOMI", "НАЗВАНИЕ", "NAME"],
        ["currency"] = ["VALYUTA", "ВАЛЮТА", "CURRENCY"],
        ["opening_balance"] = ["BOSHLANG‘ICH BALANS", "НАЧАЛЬНЫЙ БАЛАНС", "OPENING BALANCE"],
        ["icon"] = ["IKONKA", "ИКОНКА", "ICON"],
        ["color"] = ["RANG", "ЦВЕТ", "COLOUR"],
        ["archive"] = ["ARXIVLASH", "В АРХИВ", "ARCHIVE"],
        ["err_name"] = ["Nomini yozing", "Введите название", "Enter a name"],
        ["err_archive_balance"] = ["Balansi 0 bo‘lmagan hamyonni arxivlab bo‘lmaydi", "Нельзя архивировать кошелёк с ненулевым балансом", "A wallet with a non-zero balance can't be archived"],

        // item page
        ["current_balance"] = ["JORIY BALANS", "ТЕКУЩИЙ БАЛАНС", "CURRENT BALANCE"],
        ["search_notes"] = ["Izohlar bo‘yicha qidirish", "Поиск по примечаниям", "Search notes"],
        ["no_data_hint"] = ["Operatsiyani pastdagi ＋ tugmasi yoki bosh sahifada surib qo‘shing", "Добавьте операцию кнопкой ＋ внизу или перетаскиванием на главной", "Add an operation with ＋ below or by dragging on Home"],
        ["filter"] = ["Filtr", "Фильтр", "Filter"],
        ["select_all"] = ["Hammasi", "Выбрать все", "Select all"],
        ["clear_all"] = ["Olib tashlash", "Снять все", "Clear all"],
        ["apply_filter"] = ["Filtrni qo‘llash", "Применить фильтр", "Apply filter"],
        ["incomes_title"] = ["Kirimlar", "Доходы", "Income"],
        ["expenses_title"] = ["Xarajatlar", "Расходы", "Expenses"],

        // profiles
        ["profiles"] = ["PROFILLAR", "ПРОФИЛИ", "PROFILES"],
        ["profiles_hint"] = ["Har bir profilning o‘z hamyonlari, toifalari va yozuvlari bor.", "У каждого профиля свои кошельки, категории и записи.", "Each profile has its own wallets, categories and records."],
        ["new_profile"] = ["YANGI PROFIL", "НОВЫЙ ПРОФИЛЬ", "NEW PROFILE"],
        ["profile_hint"] = ["Masalan: Oila, Biznes", "Например: Семья, Бизнес", "e.g. Family, Business"],

        // debts
        ["no_debts"] = ["Ochiq qarzlar yo‘q", "Открытых долгов нет", "No open debts"],
        ["debt_they_owe"] = ["sizga qarzdor", "должен вам", "owes you"],
        ["debt_you_owe"] = ["siz qarzdorsiz", "вы должны", "you owe"],
        ["repay"] = ["Qaytarildi", "Возврат", "Repaid"],
    };
}

/// <summary>XAML: Text="{l:T total_balance}".</summary>
public sealed class TExtension(string key) : MarkupExtension
{
    public string Key { get; } = key;
    public override object ProvideValue(IServiceProvider serviceProvider) => L.T(Key);
}
