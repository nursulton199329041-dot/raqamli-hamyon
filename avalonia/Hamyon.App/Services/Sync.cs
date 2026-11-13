using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Hamyon.App.Data;

namespace Hamyon.App.Services;

public sealed record SyncReport(int Pulled, int Pushed, int NewProfiles);

/// <summary>
/// Two-way sync of every profile book with the account. Order per book: pull first (other devices' changes, later
/// change wins), then push what changed here. Profiles created on another device appear here with the same id.
/// Safe to run any time and to interrupt: nothing is marked sent until the server accepted it, and the pull cursor only
/// advances after the changes are stored.
/// </summary>
public sealed class SyncEngine(Account account, ProfileStore profiles)
{
    private const int PushBatch = 400;

    public async Task<SyncReport> SyncAllAsync(CancellationToken ct = default)
    {
        int pulled = 0, pushed = 0, adopted = 0;

        // profiles that exist on the account but not on this phone yet
        if (await account.SendAsync(HttpMethod.Get, "/api/books", null, ct) is JsonArray books)
            foreach (var id in books.Select(b => (string?)b?["bookId"]).OfType<string>())
            {
                if (profiles.Items().Exists(p => p.Id == id)) continue;
                var meta = await MetaOfAsync(id, ct);
                profiles.Adopt(id, meta?.Name ?? "Profil", meta?.Color ?? "#8B5CF6", meta?.At ?? LocalStore.Iso(DateTimeOffset.UtcNow));
                adopted++;
            }

        foreach (var p in profiles.Items())
        {
            var (inc, outc) = await SyncBookAsync(p, ct);
            pulled += inc;
            pushed += outc;
        }
        profiles.SetPref("sync_last", DateTimeOffset.UtcNow.ToString("o"));
        return new SyncReport(pulled, pushed, adopted);
    }

    /// <summary>After signing in: send everything once (this phone's data may never have been on this account).</summary>
    public void ResetForNewSession()
    {
        foreach (var p in profiles.Items())
        {
            var store = new LocalStore(profiles.PathOf(p.Id));
            store.MarkAllForResend();
            store.SetSetting("sync_cursor", "0");
            store.SetSetting("meta_sent", "");
        }
    }

    private async Task<(int Pulled, int Pushed)> SyncBookAsync(Profile p, CancellationToken ct)
    {
        var store = new LocalStore(profiles.PathOf(p.Id));

        // ---- pull: everything after our cursor ----
        _ = long.TryParse(store.GetSetting("sync_cursor"), out var cursor);
        var incoming = new List<SyncDoc>();
        while (true)
        {
            var page = await account.SendAsync(HttpMethod.Get, $"/api/books/pull?bookId={Uri.EscapeDataString(p.Id)}&since={cursor}", null, ct);
            if (page?["docs"] is JsonArray docs)
                foreach (var d in docs.OfType<JsonObject>())
                {
                    var doc = new SyncDoc((string)d["kind"]!, (string)d["uid"]!, (string?)d["data"] ?? "{}",
                        LocalStore.NormalizeTime((string?)d["updatedAt"] ?? ""), (bool?)d["deleted"] == true);
                    if (doc.Kind == "meta") ApplyMeta(p, doc); else incoming.Add(doc);
                }
            cursor = (long?)page?["cursor"] ?? cursor;
            if ((bool?)page?["more"] != true) break;
        }
        var pulled = incoming.Count == 0 ? 0 : store.ApplyRemote(incoming);
        store.SetSetting("sync_cursor", cursor.ToString());

        // ---- push: what changed here (+ the profile's name / colour when it changed) ----
        var pending = store.PendingChanges();
        var metaAt = profiles.MetaChangedAt(p.Id);
        if (store.GetSetting("meta_sent") != metaAt)
        {
            var current = profiles.Items().Find(x => x.Id == p.Id) ?? p;
            pending.Insert(0, new SyncDoc("meta", "meta", new JsonObject { ["name"] = current.Name, ["color"] = current.Color }.ToJsonString(), metaAt, false));
        }
        var pushed = 0;
        foreach (var batch in pending.Chunk(PushBatch))
        {
            var body = new JsonObject
            {
                ["bookId"] = p.Id,
                ["docs"] = new JsonArray(batch.Select(d => (JsonNode)new JsonObject
                {
                    ["kind"] = d.Kind, ["uid"] = d.Uid, ["data"] = d.Data, ["updatedAt"] = d.UpdatedAt, ["deleted"] = d.Deleted,
                }).ToArray()),
            };
            await account.SendAsync(HttpMethod.Post, "/api/books/push", body, ct);
            store.MarkSent(batch.Where(d => d.Kind != "meta"));
            if (batch.Any(d => d.Kind == "meta")) store.SetSetting("meta_sent", metaAt);
            pushed += batch.Length;
        }
        return (pulled, pushed);
    }

    /// <summary>A profile renamed / recoloured on another device (later change wins).</summary>
    private void ApplyMeta(Profile p, SyncDoc d)
    {
        if (d.Deleted || string.CompareOrdinal(d.UpdatedAt, profiles.MetaChangedAt(p.Id)) <= 0) return;
        var j = JsonNode.Parse(d.Data);
        profiles.Update(p.Id, (string?)j?["name"] ?? p.Name, (string?)j?["color"] ?? p.Color, d.UpdatedAt);
    }

    private async Task<(string Name, string Color, string At)?> MetaOfAsync(string bookId, CancellationToken ct)
    {
        var page = await account.SendAsync(HttpMethod.Get, $"/api/books/pull?bookId={Uri.EscapeDataString(bookId)}&since=0", null, ct);
        var meta = (page?["docs"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(d => (string?)d["kind"] == "meta");
        if (meta is null) return null;
        var j = JsonNode.Parse((string?)meta["data"] ?? "{}");
        return ((string?)j?["name"] ?? "Profil", (string?)j?["color"] ?? "#8B5CF6", LocalStore.NormalizeTime((string?)meta["updatedAt"] ?? ""));
    }
}
