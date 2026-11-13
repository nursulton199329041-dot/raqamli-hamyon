using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Hamyon.App.Data;

/// <summary>One synced row as the server stores it: opaque JSON keyed by the row's stable uid.</summary>
public sealed record SyncDoc(string Kind, string Uid, string Data, string UpdatedAt, bool Deleted);

/// <summary>
/// The book side of the sync: collect what changed here (triggers mark it), mark what the server took, and apply what
/// other devices changed. Rows reference each other by uid in documents (local integer ids differ per device).
/// Conflicts: the later change wins (by UTC change time), the same rule the server uses.
/// </summary>
public sealed partial class LocalStore
{
    /// <summary>"2026-11-14T08:05:01.123Z" — the canonical change-time text (sorts like time).</summary>
    public static string Iso(DateTimeOffset t) => t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static string NormalizeTime(string t) =>
        DateTimeOffset.TryParse(t, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? Iso(d) : t;

    // ---- outgoing ----

    /// <summary>Everything changed on this device and not yet accepted by the server (deletions first).</summary>
    public List<SyncDoc> PendingChanges()
    {
        using var c = Open();
        var docs = new List<SyncDoc>();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT kind, uid, deleted_at FROM tombstones ORDER BY deleted_at";
            using var r = cmd.ExecuteReader();
            while (r.Read()) docs.Add(new SyncDoc(r.GetString(0), r.GetString(1), "{}", r.GetString(2), true));
        }
        ReadDocs(c, """
            SELECT uid, updated_at, name, icon, color, currency, opening_minor, sort, archived FROM wallets WHERE dirty = 1
            """, r => new SyncDoc("wallet", r.GetString(0), new JsonObject
            {
                ["name"] = r.GetString(2), ["icon"] = r.GetString(3), ["color"] = r.GetString(4), ["currency"] = r.GetString(5),
                ["opening"] = r.GetInt64(6), ["sort"] = r.GetInt64(7), ["archived"] = r.GetInt64(8) != 0,
            }.ToJsonString(), r.GetString(1), false), docs);
        foreach (var (table, kind) in new[] { ("sources", "source"), ("categories", "category") })
            ReadDocs(c, $"SELECT uid, updated_at, name, icon, color, sort, archived FROM {table} WHERE dirty = 1",
                r => new SyncDoc(kind, r.GetString(0), new JsonObject
                {
                    ["name"] = r.GetString(2), ["icon"] = r.GetString(3), ["color"] = r.GetString(4),
                    ["sort"] = r.GetInt64(5), ["archived"] = r.GetInt64(6) != 0,
                }.ToJsonString(), r.GetString(1), false), docs);
        ReadDocs(c, """
            SELECT o.uid, o.updated_at, o.kind, o.amount_minor, o.currency, w.uid, tw.uid, o.to_amount_minor, s.uid, k.uid,
                   o.date, o.note, o.person, o.base_minor, o.fx_rate
            FROM operations o
            LEFT JOIN wallets w ON w.id = o.wallet_id LEFT JOIN wallets tw ON tw.id = o.to_wallet_id
            LEFT JOIN sources s ON s.id = o.source_id LEFT JOIN categories k ON k.id = o.category_id
            WHERE o.dirty = 1
            """, r => new SyncDoc("operation", r.GetString(0), new JsonObject
            {
                ["kind"] = r.GetInt32(2), ["amount"] = r.GetInt64(3), ["currency"] = r.GetString(4),
                ["wallet"] = Str(r, 5), ["toWallet"] = Str(r, 6), ["toAmount"] = r.IsDBNull(7) ? null : r.GetInt64(7),
                ["source"] = Str(r, 8), ["category"] = Str(r, 9), ["date"] = r.GetString(10), ["note"] = Str(r, 11),
                ["person"] = Str(r, 12), ["base"] = r.IsDBNull(13) ? null : r.GetInt64(13), ["rate"] = Str(r, 14),
            }.ToJsonString(), r.GetString(1), false), docs);
        return docs;
    }

    /// <summary>The server took these: clear their flags unless the row changed again meanwhile.</summary>
    public void MarkSent(IEnumerable<SyncDoc> sent)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var d in sent)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = d.Deleted
                ? "DELETE FROM tombstones WHERE kind = $k AND uid = $u AND deleted_at = $t"
                : $"UPDATE {TableOf(d.Kind)} SET dirty = 0 WHERE uid = $u AND updated_at = $t";
            cmd.Parameters.AddWithValue("$k", d.Kind);
            cmd.Parameters.AddWithValue("$u", d.Uid);
            cmd.Parameters.AddWithValue("$t", d.UpdatedAt);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    /// <summary>Queue every row to be sent again (new session / another account); change times stay as they are.</summary>
    public void MarkAllForResend()
    {
        using var c = Open();
        foreach (var (table, _) in SyncTables) Exec(c, $"UPDATE {table} SET dirty = 1 WHERE dirty = 0");
    }

    // ---- incoming ----

    /// <summary>
    /// Applies other devices' changes (catalog before operations, so references resolve). Change tracking is off while
    /// applying, so nothing bounces back. Returns how many rows changed here.
    /// </summary>
    public int ApplyRemote(IEnumerable<SyncDoc> docs)
    {
        var order = new Dictionary<string, int> { ["wallet"] = 0, ["source"] = 1, ["category"] = 2, ["operation"] = 3 };
        using var c = Open();
        using var tx = c.BeginTransaction();
        Exec(c, "UPDATE sync_ctl SET applying = 1");
        var changed = 0;
        try
        {
            foreach (var d in docs.Where(d => order.ContainsKey(d.Kind)).OrderBy(d => order[d.Kind]))
                if (ApplyOne(c, d with { UpdatedAt = NormalizeTime(d.UpdatedAt) })) changed++;
        }
        finally
        {
            Exec(c, "UPDATE sync_ctl SET applying = 0");
        }
        tx.Commit();
        return changed;
    }

    private static bool ApplyOne(SqliteConnection c, SyncDoc d)
    {
        var table = TableOf(d.Kind);
        // this device changed the row later and hasn't sent it yet: keep ours, it goes up on the push
        string? localAt = null;
        var localDirty = false;
        using (var q = c.CreateCommand())
        {
            q.CommandText = $"SELECT updated_at, dirty FROM {table} WHERE uid = $u";
            q.Parameters.AddWithValue("$u", d.Uid);
            using var r = q.ExecuteReader();
            if (r.Read()) { localAt = r.IsDBNull(0) ? null : r.GetString(0); localDirty = r.GetInt64(1) == 1; }
        }
        if (localAt is not null && localDirty && string.CompareOrdinal(localAt, d.UpdatedAt) > 0) return false;
        if (localAt is not null && !localDirty && localAt == d.UpdatedAt) return false; // already have exactly this

        if (d.Deleted)
        {
            // operations disappear; catalog rows are archived (history keeps pointing at them)
            using var del = c.CreateCommand();
            del.CommandText = d.Kind == "operation"
                ? "DELETE FROM operations WHERE uid = $u"
                : $"UPDATE {table} SET archived = 1, updated_at = $t, dirty = 0 WHERE uid = $u";
            del.Parameters.AddWithValue("$u", d.Uid);
            del.Parameters.AddWithValue("$t", d.UpdatedAt);
            return del.ExecuteNonQuery() > 0;
        }

        var j = JsonNode.Parse(d.Data)!.AsObject();
        using var cmd = c.CreateCommand();
        cmd.Parameters.AddWithValue("$u", d.Uid);
        cmd.Parameters.AddWithValue("$t", d.UpdatedAt);
        switch (d.Kind)
        {
            case "wallet":
                cmd.CommandText = """
                    INSERT INTO wallets(uid, updated_at, dirty, name, icon, color, currency, opening_minor, sort, archived)
                    VALUES ($u, $t, 0, $n, $i, $c, $cur, $o, $s, $a)
                    ON CONFLICT(uid) DO UPDATE SET updated_at = $t, dirty = 0, name = $n, icon = $i, color = $c,
                      currency = $cur, opening_minor = $o, sort = $s, archived = $a
                    """;
                cmd.Parameters.AddWithValue("$cur", (string?)j["currency"] ?? "UZS");
                cmd.Parameters.AddWithValue("$o", (long?)j["opening"] ?? 0);
                break;
            case "source":
            case "category":
                cmd.CommandText = $"""
                    INSERT INTO {table}(uid, updated_at, dirty, name, icon, color, sort, archived)
                    VALUES ($u, $t, 0, $n, $i, $c, $s, $a)
                    ON CONFLICT(uid) DO UPDATE SET updated_at = $t, dirty = 0, name = $n, icon = $i, color = $c, sort = $s, archived = $a
                    """;
                break;
            default:
                cmd.CommandText = """
                    INSERT INTO operations(uid, updated_at, dirty, kind, amount_minor, currency, wallet_id, to_wallet_id, to_amount_minor,
                                           source_id, category_id, date, note, person, base_minor, fx_rate)
                    VALUES ($u, $t, 0, $k, $amt, $cur, $w, $tw, $ta, $src, $cat, $d, $note, $p, $base, $rate)
                    ON CONFLICT(uid) DO UPDATE SET updated_at = $t, dirty = 0, kind = $k, amount_minor = $amt, currency = $cur,
                      wallet_id = $w, to_wallet_id = $tw, to_amount_minor = $ta, source_id = $src, category_id = $cat, date = $d,
                      note = $note, person = $p, base_minor = $base, fx_rate = $rate
                    """;
                cmd.Parameters.AddWithValue("$k", (int?)j["kind"] ?? 0);
                cmd.Parameters.AddWithValue("$amt", (long?)j["amount"] ?? 0);
                cmd.Parameters.AddWithValue("$cur", (string?)j["currency"] ?? "UZS");
                cmd.Parameters.AddWithValue("$w", IdOf(c, "wallets", (string?)j["wallet"]));
                cmd.Parameters.AddWithValue("$tw", IdOf(c, "wallets", (string?)j["toWallet"]));
                cmd.Parameters.AddWithValue("$ta", (object?)(long?)j["toAmount"] ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$src", IdOf(c, "sources", (string?)j["source"]));
                cmd.Parameters.AddWithValue("$cat", IdOf(c, "categories", (string?)j["category"]));
                cmd.Parameters.AddWithValue("$d", (string?)j["date"] ?? DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));
                cmd.Parameters.AddWithValue("$note", (object?)(string?)j["note"] ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$p", (object?)(string?)j["person"] ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$base", (object?)(long?)j["base"] ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$rate", (object?)(string?)j["rate"] ?? DBNull.Value);
                return cmd.ExecuteNonQuery() > 0;
        }
        cmd.Parameters.AddWithValue("$n", (string?)j["name"] ?? "?");
        cmd.Parameters.AddWithValue("$i", (string?)j["icon"] ?? "other");
        cmd.Parameters.AddWithValue("$c", (string?)j["color"] ?? "#64748B");
        cmd.Parameters.AddWithValue("$s", (long?)j["sort"] ?? 0);
        cmd.Parameters.AddWithValue("$a", (bool?)j["archived"] == true ? 1 : 0);
        return cmd.ExecuteNonQuery() > 0;
    }

    private static object IdOf(SqliteConnection c, string table, string? uid)
    {
        if (uid is null) return DBNull.Value;
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT id FROM {table} WHERE uid = $u";
        cmd.Parameters.AddWithValue("$u", uid);
        return cmd.ExecuteScalar() ?? DBNull.Value;
    }

    private static string TableOf(string kind) => kind switch
    {
        "wallet" => "wallets", "source" => "sources", "category" => "categories", "operation" => "operations",
        _ => throw new ArgumentException("unknown kind " + kind),
    };

    private static void ReadDocs(SqliteConnection c, string sql, Func<SqliteDataReader, SyncDoc> map, List<SyncDoc> into)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        using var r = cmd.ExecuteReader();
        while (r.Read()) into.Add(map(r));
    }
}
