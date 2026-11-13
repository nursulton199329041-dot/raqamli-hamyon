using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Data.Sqlite;

namespace Hamyon.App.Data;

public sealed record Profile(string Id, string Name, string Color);

/// <summary>
/// Profiles ("Shaxsiy", "Oila", "Biznes"...) are separate books: each its own SQLite file with its own wallets,
/// categories and operations, so nothing can leak between them. A small index file lists them, remembers the current
/// one and the app-wide preferences (language, accent colour). The first profile is the book that existed before
/// profiles did (hamyon.db), so an upgrade keeps every record.
/// </summary>
public sealed class ProfileStore
{
    public const string MainId = "main";
    private readonly string _dir;
    private readonly string _cs;

    public ProfileStore(string? dir = null)
    {
        _dir = dir ?? Path.GetDirectoryName(LocalStore.DefaultPath())!;
        Directory.CreateDirectory(_dir);
        _cs = new SqliteConnectionStringBuilder { DataSource = Path.Combine(_dir, "profiles.db") }.ToString();
        using var c = Open();
        Exec(c, """
            CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """);
        if (Count(c) == 0)
        {
            Exec(c, $"INSERT INTO profiles(id, name, color, sort) VALUES ('{MainId}', 'Asosiy', '#F2C14E', 1)");
            // language / accent used to live in the main book: carry them over once
            var main = new LocalStore(PathOf(MainId));
            foreach (var key in new[] { "lang", "accent" })
                if (main.GetSetting(key) is { } v) SetPref(key, v);
        }
    }

    public string PathOf(string id) => Path.Combine(_dir, id == MainId ? "hamyon.db" : $"book-{id}.db");

    public List<Profile> Items()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, name, color FROM profiles ORDER BY sort, name";
        using var r = cmd.ExecuteReader();
        var list = new List<Profile>();
        while (r.Read()) list.Add(new Profile(r.GetString(0), r.GetString(1), r.GetString(2)));
        return list;
    }

    public string CurrentId
    {
        get
        {
            var id = GetPref("current");
            return id is not null && Items().Exists(p => p.Id == id) ? id : MainId;
        }
        set => SetPref("current", value);
    }

    public Profile Current => Items().Find(p => p.Id == CurrentId) ?? Items()[0];

    public LocalStore OpenCurrent() => new(PathOf(CurrentId));

    /// <summary>A new, empty book with the default catalog.</summary>
    public Profile Create(string name, string color)
    {
        var id = Guid.NewGuid().ToString("N")[..10];
        using (var c = Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "INSERT INTO profiles(id, name, color, sort) VALUES ($id, $n, $c, (SELECT COALESCE(MAX(sort), 0) + 1 FROM profiles))";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$n", name);
            cmd.Parameters.AddWithValue("$c", color);
            cmd.ExecuteNonQuery();
        }
        _ = new LocalStore(PathOf(id)); // creates and seeds the file
        return new Profile(id, name, color);
    }

    public void Update(string id, string name, string color)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE profiles SET name = $n, color = $c WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$n", name);
        cmd.Parameters.AddWithValue("$c", color);
        cmd.ExecuteNonQuery();
    }

    public string? GetPref(string key)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM prefs WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        return cmd.ExecuteScalar() as string;
    }

    public void SetPref(string key, string value)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO prefs(key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value);
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_cs);
        c.Open();
        return c;
    }

    private static long Count(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM profiles";
        return (long)cmd.ExecuteScalar()!;
    }

    private static void Exec(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}
