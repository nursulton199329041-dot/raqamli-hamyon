using System;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Hamyon.App.Data;

namespace Hamyon.App.Services;

/// <summary>
/// Exchange rates to so'm. Saving never waits for the network: the sheet shows the best rate known on the phone
/// (last official rate saved, else the last rate used in the book) and replaces it with the Central Bank's rate for
/// the day when that arrives. The user can always type a rate by hand.
/// </summary>
public static class Rates
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(6) };

    /// <summary>Official rate source; tests swap it for a stub so they never touch the network.</summary>
    public static Func<string, DateTime, Task<decimal?>> Fetch { get; set; } = FetchCbuAsync;

    public static decimal? Saved(LocalStore store, string currency) =>
        decimal.TryParse(store.GetSetting("rate_" + currency), NumberStyles.Number, CultureInfo.InvariantCulture, out var r) && r > 0 ? r : null;

    public static void Save(LocalStore store, string currency, decimal rate) =>
        store.SetSetting("rate_" + currency, rate.ToString(CultureInfo.InvariantCulture));

    /// <summary>Best rate already on the phone: last official one, else the last one used in the book.</summary>
    public static decimal? Known(LocalStore store, string currency) => Saved(store, currency) ?? store.LastUsedRate(currency);

    /// <summary>Central Bank of Uzbekistan rate for the day (UZS per 1 unit), or null when offline / not published.</summary>
    public static async Task<decimal?> FetchCbuAsync(string currency, DateTime day)
    {
        try
        {
            var url = $"https://cbu.uz/uz/arkhiv-kursov-valyut/json/{currency}/{day:yyyy-MM-dd}/";
            using var stream = await Http.GetStreamAsync(url);
            using var doc = await JsonDocument.ParseAsync(stream);
            if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() == 0) return null;
            var text = doc.RootElement[0].GetProperty("Rate").GetString();
            return decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var rate) && rate > 0 ? rate : null;
        }
        catch (Exception)
        {
            return null; // offline, timeout, unexpected format: the known rate stays
        }
    }
}
