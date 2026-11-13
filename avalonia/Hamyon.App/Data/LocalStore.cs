using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Hamyon.App.Models;
using Microsoft.Data.Sqlite;

namespace Hamyon.App.Data;

/// <summary>
/// The whole book lives in one SQLite file on the device (store build: no server). Money is integer minor units.
/// Balances are always computed from operations, never stored, so they can't drift.
/// </summary>
public sealed class LocalStore
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
        if (Scalar(c, "SELECT COUNT(*) FROM wallets") == 0) Seed(c);
    }

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
        Exec(c, """
            INSERT INTO wallets(name, icon, color, currency, sort) VALUES
              ('Naqd', 'cash', '#1FCB8B', 'UZS', 1),
              ('Bank kartasi', 'card', '#4D8DFF', 'UZS', 2),
              ('Dollar jamg''arma', 'savings', '#14B8A6', 'USD', 3);
            INSERT INTO sources(name, icon, color, sort) VALUES
              ('Ish haqi', 'salary', '#1FCB8B', 1),
              ('Biznes', 'business', '#22A06B', 2),
              ('Boshqa kirim', 'other', '#84CC16', 3);
            INSERT INTO categories(name, icon, color, sort) VALUES
              ('Oziq-ovqat', 'food', '#F97316', 1),
              ('Transport', 'transport', '#3B82F6', 2),
              ('Kommunal', 'utilities', '#14B8A6', 3),
              ('Uy', 'home', '#8B5CF6', 4),
              ('Sog''liq', 'health', '#EF4444', 5),
              ('Ko''ngilochar', 'fun', '#EC4899', 6),
              ('Boshqa', 'other', '#64748B', 7);
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
            SELECT CAST({part} AS INTEGER), SUM(amount_minor) FROM operations
            WHERE kind = $k AND currency = $cur AND date >= $from AND date <= $to
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
            SELECT {column}, currency, SUM(amount_minor) FROM operations
            WHERE kind = $k AND {column} IS NOT NULL AND date >= $from AND date <= $to
            GROUP BY {column}, currency
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
            INSERT INTO operations(kind, amount_minor, currency, wallet_id, to_wallet_id, to_amount_minor, source_id, category_id, date, note, person)
            VALUES ($kind, $amount, $cur, $w, $tw, $ta, $s, $c, $d, $n, $p);
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
        return (long)cmd.ExecuteScalar()!;
    }

    /// <summary>One operation as the history list shows it, with the names of both ends.</summary>
    public IReadOnlyList<OperationRow> Operations(DateTime from, DateTime to) =>
        Read($"""
            SELECT o.id, o.kind, o.amount_minor, o.currency, o.to_amount_minor, o.date, o.note,
                   w.name, tw.name, tw.currency, s.name, s.icon, s.color, c.name, c.icon, c.color, o.person
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
                Str(r, 10), Str(r, 11), Str(r, 12), Str(r, 13), Str(r, 14), Str(r, 15), Str(r, 16)));

    /// <summary>Removes an operation; balances are computed from operations, so they follow at once.</summary>
    public void DeleteOperation(long id)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM operations WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
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
