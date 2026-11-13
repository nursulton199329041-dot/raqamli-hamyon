using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Hamyon.App.Models;
using Microsoft.Data.Sqlite;

namespace Hamyon.App.Data;

/// <summary>
/// The whole book lives in one SQLite file on the device (store build: no server). Money is integer minor units.
/// Balances are always computed from operations, never stored, so they can't drift.
/// </summary>
public sealed partial class LocalStore
{
    private readonly string _cs;

    public LocalStore(string? path = null)
    {
        path ??= DefaultPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _cs = new SqliteConnectionStringBuilder { DataSource = path, ForeignKeys = true }.ToString();
        Migrate();
    }

    public static string DefaultPath() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RaqamliHamyon", "hamyon.db");

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_cs);
        c.Open();
        return c;
    }

    private void Migrate()
    {
        using var c = Open();
        Exec(c, """
            CREATE TABLE IF NOT EXISTS wallets (
              id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
              currency TEXT NOT NULL, opening_minor INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
              archived INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS sources (
              id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS categories (
              id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS operations (
              id INTEGER PRIMARY KEY, kind INTEGER NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
              wallet_id INTEGER REFERENCES wallets(id), to_wallet_id INTEGER REFERENCES wallets(id), to_amount_minor INTEGER,
              source_id INTEGER REFERENCES sources(id), category_id INTEGER REFERENCES categories(id),
              date TEXT NOT NULL, note TEXT);
            CREATE INDEX IF NOT EXISTS ix_operations_date ON operations(date);
            """);

        // additive, versioned upgrades: a book created by an older build keeps every record
        if (Scalar(c, "PRAGMA user_version") < 1)
        {
            using var tx = c.BeginTransaction();
            if (!HasColumn(c, "sources", "archived")) Exec(c, "ALTER TABLE sources ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
            if (!HasColumn(c, "categories", "archived")) Exec(c, "ALTER TABLE categories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
            if (!HasColumn(c, "operations", "person")) Exec(c, "ALTER TABLE operations ADD COLUMN person TEXT");
            Exec(c, "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
            Exec(c, "PRAGMA user_version = 1");
            tx.Commit();
        }
        if (Scalar(c, "PRAGMA user_version") < 2)
        {
            // foreign-currency income / expense: the so'm equivalent and the rate used (kept as decimal text)
            using var tx = c.BeginTransaction();
            if (!HasColumn(c, "operations", "base_minor")) Exec(c, "ALTER TABLE operations ADD COLUMN base_minor INTEGER");
            if (!HasColumn(c, "operations", "fx_rate")) Exec(c, "ALTER TABLE operations ADD COLUMN fx_rate TEXT");
            Exec(c, "PRAGMA user_version = 2");
            tx.Commit();
        }
        if (Scalar(c, "PRAGMA user_version") < 3)
        {
            // sync: every row gets a stable uid, a change time and a "not yet sent" flag; deletions leave tombstones.
            // Triggers keep these up to date for every write, so no change can be forgotten by a code path.
            using var tx = c.BeginTransaction();
            foreach (var (table, kind) in SyncTables)
            {
                if (!HasColumn(c, table, "uid")) Exec(c, $"ALTER TABLE {table} ADD COLUMN uid TEXT");
                if (!HasColumn(c, table, "updated_at")) Exec(c, $"ALTER TABLE {table} ADD COLUMN updated_at TEXT");
                if (!HasColumn(c, table, "dirty")) Exec(c, $"ALTER TABLE {table} ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1");
            }
            // the default catalog gets the same uids on every device, so two phones don't end up with two "Naqd"s
            foreach (var (table, uid, name) in SeedUids)
                Exec(c, $"UPDATE {table} SET uid = '{uid}' WHERE id = (SELECT MIN(id) FROM {table} WHERE name = '{name.Replace("'", "''")}' AND uid IS NULL) " +
                        $"AND NOT EXISTS (SELECT 1 FROM {table} WHERE uid = '{uid}')");
            foreach (var (table, _) in SyncTables)
            {
                Exec(c, $"UPDATE {table} SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL");
                Exec(c, $"UPDATE {table} SET updated_at = {Now}, dirty = 1 WHERE updated_at IS NULL");
                Exec(c, $"CREATE UNIQUE INDEX IF NOT EXISTS ux_{table}_uid ON {table}(uid)");
            }
            Exec(c, """
                CREATE TABLE IF NOT EXISTS tombstones (kind TEXT NOT NULL, uid TEXT NOT NULL, deleted_at TEXT NOT NULL, PRIMARY KEY (kind, uid));
                CREATE TABLE IF NOT EXISTS sync_ctl (applying INTEGER NOT NULL);
                INSERT INTO sync_ctl SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM sync_ctl);
                """);
            foreach (var (table, kind) in SyncTables)
                Exec(c, $"""
                    CREATE TRIGGER IF NOT EXISTS {table}_sync_ins AFTER INSERT ON {table} WHEN (SELECT applying FROM sync_ctl) = 0
                    BEGIN
                      UPDATE {table} SET uid = COALESCE(NEW.uid, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, {Now}), dirty = 1 WHERE id = NEW.id;
                      DELETE FROM tombstones WHERE kind = '{kind}' AND uid = NEW.uid;
                    END;
                    CREATE TRIGGER IF NOT EXISTS {table}_sync_upd AFTER UPDATE ON {table}
                      WHEN (SELECT applying FROM sync_ctl) = 0 AND NEW.dirty = OLD.dirty
                    BEGIN
                      UPDATE {table} SET updated_at = {Now}, dirty = 1 WHERE id = NEW.id;
                    END;
                    CREATE TRIGGER IF NOT EXISTS {table}_sync_del AFTER DELETE ON {table} WHEN (SELECT applying FROM sync_ctl) = 0
                    BEGIN
                      INSERT OR REPLACE INTO tombstones(kind, uid, deleted_at) VALUES ('{kind}', OLD.uid, {Now});
                    END;
                    """);
            Exec(c, "PRAGMA user_version = 3");
            tx.Commit();
        }
        Exec(c, "UPDATE sync_ctl SET applying = 0"); // a crash while applying remote changes must not leave tracking off
        if (Scalar(c, "SELECT COUNT(*) FROM wallets") == 0) Seed(c);
    }

    /// <summary>Synced tables and the document kind each one is sent as.</summary>
    public static readonly (string Table, string Kind)[] SyncTables =
        [("wallets", "wallet"), ("sources", "source"), ("categories", "category"), ("operations", "operation")];

    /// <summary>UTC ISO-8601 with milliseconds — sortable as text, and what the server compares.</summary>
    private const string Now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

    /// <summary>Seeded rows are dated far back, so any real edit on any device wins over a fresh default.</summary>
    private const string SeedTime = "'2000-01-01T00:00:00.000Z'";

    private static readonly (string Table, string Uid, string Name)[] SeedUids =
    [
        ("wallets", "seed-w-cash", "Naqd"), ("wallets", "seed-w-card", "Bank kartasi"), ("wallets", "seed-w-usd", "Dollar jamg'arma"),
        ("sources", "seed-s-salary", "Ish haqi"), ("sources", "seed-s-business", "Biznes"), ("sources", "seed-s-other", "Boshqa kirim"),
        ("categories", "seed-c-food", "Oziq-ovqat"), ("categories", "seed-c-transport", "Transport"), ("categories", "seed-c-utilities", "Kommunal"),
        ("categories", "seed-c-home", "Uy"), ("categories", "seed-c-health", "Sog'liq"), ("categories", "seed-c-fun", "Ko'ngilochar"),
        ("categories", "seed-c-other", "Boshqa"),
    ];

    private static bool HasColumn(SqliteConnection c, string table, string column)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = $n";
        cmd.Parameters.AddWithValue("$n", column);
        return (long)cmd.ExecuteScalar()! > 0;
    }

    /// <summary>A fresh book starts with the same defaults as the React Native app.</summary>
    private static void Seed(SqliteConnection c)
    {
        // fixed uids + an old date: the same defaults on every device merge, and never overwrite a real edit
        Exec(c, $"""
            INSERT INTO wallets(name, icon, color, currency, sort, uid, updated_at) VALUES
              ('Naqd', 'cash', '#1FCB8B', 'UZS', 1, 'seed-w-cash', {SeedTime}),
              ('Bank kartasi', 'card', '#4D8DFF', 'UZS', 2, 'seed-w-card', {SeedTime}),
              ('Dollar jamg''arma', 'savings', '#14B8A6', 'USD', 3, 'seed-w-usd', {SeedTime});
            INSERT INTO sources(name, icon, color, sort, uid, updated_at) VALUES
              ('Ish haqi', 'salary', '#1FCB8B', 1, 'seed-s-salary', {SeedTime}),
              ('Biznes', 'business', '#22A06B', 2, 'seed-s-business', {SeedTime}),
              ('Boshqa kirim', 'other', '#84CC16', 3, 'seed-s-other', {SeedTime});
            INSERT INTO categories(name, icon, color, sort, uid, updated_at) VALUES
              ('Oziq-ovqat', 'food', '#F97316', 1, 'seed-c-food', {SeedTime}),
              ('Transport', 'transport', '#3B82F6', 2, 'seed-c-transport', {SeedTime}),
              ('Kommunal', 'utilities', '#14B8A6', 3, 'seed-c-utilities', {SeedTime}),
              ('Uy', 'home', '#8B5CF6', 4, 'seed-c-home', {SeedTime}),
              ('Sog''liq', 'health', '#EF4444', 5, 'seed-c-health', {SeedTime}),
              ('Ko''ngilochar', 'fun', '#EC4899', 6, 'seed-c-fun', {SeedTime}),
              ('Boshqa', 'other', '#64748B', 7, 'seed-c-other', {SeedTime});
            """);
    }

    public IReadOnlyList<Wallet> Wallets()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        // balance = opening + income and borrowed in - expense, lent and transfer out + transfer in (wallet's own currency)
        cmd.CommandText = """
            SELECT w.id, w.name, w.icon, w.color, w.currency,
              w.opening_minor
              + COALESCE((SELECT SUM(amount_minor) FROM operations o WHERE o.kind IN (1, 5) AND o.wallet_id = w.id), 0)
              - COALESCE((SELECT SUM(amount_minor) FROM operations o WHERE o.kind IN (2, 3, 4) AND o.wallet_id = w.id), 0)
              + COALESCE((SELECT SUM(COALESCE(to_amount_minor, amount_minor)) FROM operations o WHERE o.kind = 3 AND o.to_wallet_id = w.id), 0)
            FROM wallets w WHERE w.archived = 0 ORDER BY w.sort, w.id
            """;
        var list = new List<Wallet>();
        using var r = cmd.ExecuteReader();
        while (r.Read())
            list.Add(new Wallet(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), Money.FromMinor(r.GetInt64(5))));
        return list;
    }

    public IReadOnlyList<IncomeSource> Sources() =>
        Read("SELECT id, name, icon, color FROM sources WHERE archived = 0 ORDER BY sort, id", r => new IncomeSource(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3)));

    public IReadOnlyList<Category> Categories() =>
        Read("SELECT id, name, icon, color FROM categories WHERE archived = 0 ORDER BY sort, id", r => new Category(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3)));

    // ---- catalog editing (archived items keep their history; nothing is hard-deleted) ----

    public long AddWallet(string name, string icon, string color, string currency, decimal opening) =>
        Insert("INSERT INTO wallets(name, icon, color, currency, opening_minor, sort) VALUES ($n, $i, $c, $cur, $o, (SELECT COALESCE(MAX(sort), 0) + 1 FROM wallets)); SELECT last_insert_rowid();",
            ("$n", name), ("$i", icon), ("$c", color), ("$cur", currency), ("$o", Money.ToMinor(opening)));

    /// <summary>Renames / recolours a wallet. The currency never changes once operations exist in it.</summary>
    public void UpdateWallet(long id, string name, string icon, string color) =>
        Run("UPDATE wallets SET name = $n, icon = $i, color = $c WHERE id = $id", ("$n", name), ("$i", icon), ("$c", color), ("$id", id));

    public void ArchiveWallet(long id) => Run("UPDATE wallets SET archived = 1 WHERE id = $id", ("$id", id));

    /// <summary>table: "categories" or "sources".</summary>
    public long AddNamed(string table, string name, string icon, string color) =>
        Insert($"INSERT INTO {Named(table)}(name, icon, color, sort) VALUES ($n, $i, $c, (SELECT COALESCE(MAX(sort), 0) + 1 FROM {Named(table)})); SELECT last_insert_rowid();",
            ("$n", name), ("$i", icon), ("$c", color));

    public void UpdateNamed(string table, long id, string name, string icon, string color) =>
        Run($"UPDATE {Named(table)} SET name = $n, icon = $i, color = $c WHERE id = $id", ("$n", name), ("$i", icon), ("$c", color), ("$id", id));

    public void ArchiveNamed(string table, long id) => Run($"UPDATE {Named(table)} SET archived = 1 WHERE id = $id", ("$id", id));

    private static string Named(string table) => table is "categories" or "sources" ? table : throw new ArgumentException(table);

    // ---- debts: kind 4 = I lent (money leaves the wallet), kind 5 = I borrowed / got it back (money comes in) ----

    /// <summary>Open debts per person and currency: positive = they owe me, negative = I owe them.</summary>
    public IReadOnlyList<(string Person, string Currency, decimal Balance)> Debts() =>
        Read("""
            SELECT MIN(person), currency, SUM(CASE WHEN kind = 4 THEN amount_minor ELSE -amount_minor END) AS bal
            FROM operations WHERE kind IN (4, 5) AND person IS NOT NULL
            GROUP BY lower(trim(person)), currency HAVING bal <> 0
            ORDER BY abs(bal) DESC
            """, r => (r.GetString(0), r.GetString(1), Money.FromMinor(r.GetInt64(2))));

    // ---- settings ----

    public string? GetSetting(string key)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        return cmd.ExecuteScalar() as string;
    }

    public void SetSetting(string key, string value) =>
        Run("INSERT INTO settings(key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ("$k", key), ("$v", value));

    /// <summary>Deletes all operations; wallets, categories and sources stay (balances return to the opening ones).</summary>
    public void WipeOperations() => Run("DELETE FROM operations");

    /// <summary>Deletes every record and starts a fresh book with the default catalog. Settings (language, colour) stay.</summary>
    public void Wipe()
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        Exec(c, "DELETE FROM operations; DELETE FROM wallets; DELETE FROM sources; DELETE FROM categories;");
        Seed(c);
        tx.Commit();
    }

    private void Run(string sql, params (string, object)[] args)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        cmd.ExecuteNonQuery();
    }

    private long Insert(string sql, params (string, object)[] args)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        return (long)cmd.ExecuteScalar()!;
    }

    /// <summary>
    /// Income or expense of one currency summed per day of month (byMonth = false, key 1..31) or per month (key 1..12).
    /// </summary>
    public Dictionary<int, decimal> Series(OpKind kind, Period p, string currency, bool byMonth)
    {
        // ISO dates: "yyyy-MM-dd..." -> month = chars 6-7, day = chars 9-10
        var part = byMonth ? "substr(date, 6, 2)" : "substr(date, 9, 2)";
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"""
            SELECT CAST({part} AS INTEGER), SUM(COALESCE(base_minor, amount_minor)) FROM operations
            WHERE kind = $k AND (CASE WHEN base_minor IS NOT NULL THEN 'UZS' ELSE currency END) = $cur AND date >= $from AND date <= $to
            GROUP BY 1
            """;
        cmd.Parameters.AddWithValue("$k", (int)kind);
        cmd.Parameters.AddWithValue("$cur", currency);
        cmd.Parameters.AddWithValue("$from", Iso(p.From));
        cmd.Parameters.AddWithValue("$to", Iso(p.To));
        var map = new Dictionary<int, decimal>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) map[r.GetInt32(0)] = Money.FromMinor(r.GetInt64(1));
        return map;
    }

    /// <summary>Income per source (kind 1) or expense per category (kind 2) in the period: id -> currency -> amount.</summary>
    public Dictionary<long, Dictionary<string, decimal>> Totals(OpKind kind, Period p)
    {
        var column = kind == OpKind.Income ? "source_id" : "category_id";
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"""
            SELECT {column}, CASE WHEN base_minor IS NOT NULL THEN 'UZS' ELSE currency END AS cur, SUM(COALESCE(base_minor, amount_minor)) FROM operations
            WHERE kind = $k AND {column} IS NOT NULL AND date >= $from AND date <= $to
            GROUP BY {column}, cur
            """;
        cmd.Parameters.AddWithValue("$k", (int)kind);
        cmd.Parameters.AddWithValue("$from", Iso(p.From));
        cmd.Parameters.AddWithValue("$to", Iso(p.To));
        var map = new Dictionary<long, Dictionary<string, decimal>>();
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var id = r.GetInt64(0);
            if (!map.TryGetValue(id, out var byCur)) map[id] = byCur = new();
            byCur[r.GetString(1)] = Money.FromMinor(r.GetInt64(2));
        }
        return map;
    }

    public long AddOperation(Operation op)
    {
        if (op.Amount <= 0) throw new ArgumentException("Summa musbat bo'lishi kerak", nameof(op));
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO operations(kind, amount_minor, currency, wallet_id, to_wallet_id, to_amount_minor, source_id, category_id, date, note, person, base_minor, fx_rate)
            VALUES ($kind, $amount, $cur, $w, $tw, $ta, $s, $c, $d, $n, $p, $base, $rate);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$kind", (int)op.Kind);
        cmd.Parameters.AddWithValue("$amount", Money.ToMinor(op.Amount));
        cmd.Parameters.AddWithValue("$cur", op.Currency);
        cmd.Parameters.AddWithValue("$w", (object?)op.WalletId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$tw", (object?)op.ToWalletId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$ta", op.ToAmount is { } ta ? Money.ToMinor(ta) : DBNull.Value);
        cmd.Parameters.AddWithValue("$s", (object?)op.SourceId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$c", (object?)op.CategoryId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$d", Iso(op.Date));
        cmd.Parameters.AddWithValue("$n", (object?)op.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$p", (object?)op.Person?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$base", op.BaseAmount is { } b ? Money.ToMinor(b) : DBNull.Value);
        cmd.Parameters.AddWithValue("$rate", op.Rate is { } rt ? rt.ToString(CultureInfo.InvariantCulture) : DBNull.Value);
        return (long)cmd.ExecuteScalar()!;
    }

    /// <summary>One operation as the history list shows it, with the names of both ends.</summary>
    public IReadOnlyList<OperationRow> Operations(DateTime from, DateTime to) =>
        Read($"""
            SELECT o.id, o.kind, o.amount_minor, o.currency, o.to_amount_minor, o.date, o.note,
                   w.name, tw.name, tw.currency, s.name, s.icon, s.color, c.name, c.icon, c.color, o.person, o.base_minor, o.fx_rate,
                   o.wallet_id, o.to_wallet_id, o.source_id, o.category_id
            FROM operations o
            LEFT JOIN wallets w ON w.id = o.wallet_id
            LEFT JOIN wallets tw ON tw.id = o.to_wallet_id
            LEFT JOIN sources s ON s.id = o.source_id
            LEFT JOIN categories c ON c.id = o.category_id
            WHERE o.date >= '{Iso(from)}' AND o.date <= '{Iso(to)}'
            ORDER BY o.date DESC, o.id DESC
            """,
            r => new OperationRow(
                r.GetInt64(0), (OpKind)r.GetInt32(1), Money.FromMinor(r.GetInt64(2)), r.GetString(3),
                r.IsDBNull(4) ? null : Money.FromMinor(r.GetInt64(4)),
                DateTime.ParseExact(r.GetString(5), "yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
                r.IsDBNull(6) ? null : r.GetString(6),
                Str(r, 7), Str(r, 8), Str(r, 9),
                Str(r, 10), Str(r, 11), Str(r, 12), Str(r, 13), Str(r, 14), Str(r, 15), Str(r, 16),
                r.IsDBNull(17) ? null : Money.FromMinor(r.GetInt64(17)),
                r.IsDBNull(18) ? null : decimal.Parse(r.GetString(18), CultureInfo.InvariantCulture),
                Id(r, 19), Id(r, 20), Id(r, 21), Id(r, 22)));

    /// <summary>The rate of the latest converted operation in that currency (fallback when no official rate is known).</summary>
    public decimal? LastUsedRate(string currency)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT fx_rate FROM operations WHERE currency = $cur AND fx_rate IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1";
        cmd.Parameters.AddWithValue("$cur", currency);
        return cmd.ExecuteScalar() is string v ? decimal.Parse(v, CultureInfo.InvariantCulture) : null;
    }

    /// <summary>Removes an operation; balances are computed from operations, so they follow at once.</summary>
    public void DeleteOperation(long id)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM operations WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    private static long? Id(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetInt64(i);

    /// <summary>Sets a wallet's current balance by moving its opening balance: history stays untouched.</summary>
    public void SetWalletBalance(long id, decimal balance)
    {
        var current = Wallets().FirstOrDefault(w => w.Id == id) ?? throw new ArgumentException("no wallet", nameof(id));
        Run("UPDATE wallets SET opening_minor = opening_minor + $d WHERE id = $id", ("$d", Money.ToMinor(balance - current.Balance)), ("$id", id));
    }

    private static string? Str(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);

    // invariant culture: the time separator must be ':' whatever the phone's language is
    private static string Iso(DateTime d) => d == DateTime.MaxValue ? "9999-12-31T23:59:59" : d.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    private List<T> Read<T>(string sql, Func<SqliteDataReader, T> map)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        using var r = cmd.ExecuteReader();
        var list = new List<T>();
        while (r.Read()) list.Add(map(r));
        return list;
    }

    private static void Exec(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static long Scalar(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return (long)cmd.ExecuteScalar()!;
    }
}
