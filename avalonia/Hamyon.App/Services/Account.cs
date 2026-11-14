using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Hamyon.App.Services;

/// <summary>A server answer that is not a success: the server's error code and message.</summary>
public sealed class ApiException(string code, string message, int status) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

/// <summary>
/// The account on hamyon.raqamlinazorat.uz: sign up / sign in with email and password, keep the session (access token
/// refreshed automatically with the refresh token), sign out. Tokens live in the app preferences on this phone.
/// JSON is built by hand (System.Text.Json.Nodes) so it keeps working in a trimmed release build.
/// </summary>
public sealed class Account
{
    public const string DefaultBaseUrl = "https://hamyon.raqamlinazorat.uz";

    private readonly HttpClient _http;
    private readonly Func<string, string?> _get;
    private readonly Action<string, string> _set;
    private readonly SemaphoreSlim _refresh = new(1, 1);

    public Account(Func<string, string?> get, Action<string, string> set, HttpMessageHandler? handler = null, string? baseUrl = null)
    {
        _get = get;
        _set = set;
        _http = new HttpClient(handler ?? new HttpClientHandler()) { BaseAddress = new Uri(baseUrl ?? DefaultBaseUrl), Timeout = TimeSpan.FromSeconds(30) };
    }

    public bool SignedIn => !string.IsNullOrEmpty(_get("acct_refresh"));
    public string? Email => _get("acct_email");
    public string? UserId => _get("acct_user");

    /// <summary>Raised when the session ends (sign out, or the server no longer accepts the refresh token).</summary>
    public event Action? SignedOut;

    public Task RegisterAsync(string email, string password, string name, string locale, CancellationToken ct = default) =>
        AuthAsync("/api/auth/register", new JsonObject { ["email"] = email.Trim(), ["password"] = password, ["displayName"] = name.Trim(), ["locale"] = locale }, ct);

    public Task LoginAsync(string email, string password, CancellationToken ct = default) =>
        AuthAsync("/api/auth/login", new JsonObject { ["email"] = email.Trim(), ["password"] = password }, ct);

    public async Task LogoutAsync()
    {
        var refresh = _get("acct_refresh");
        Clear();
        if (string.IsNullOrEmpty(refresh)) return;
        try { await RawAsync(HttpMethod.Post, "/api/auth/logout", new JsonObject { ["refreshToken"] = refresh }, null, CancellationToken.None); }
        catch (Exception) { /* offline: the token just expires on the server */ }
    }

    /// <summary>Deletes the account and all its data on the server, then ends the session (data on this phone stays).</summary>
    public async Task DeleteAccountAsync(CancellationToken ct = default)
    {
        await SendAsync(HttpMethod.Delete, "/api/me", null, ct);
        Clear();
    }

    /// <summary>An authenticated call. Refreshes the access token when it is about to expire, and once on a 401.</summary>
    public async Task<JsonNode?> SendAsync(HttpMethod method, string path, JsonNode? body = null, CancellationToken ct = default)
    {
        if (!SignedIn) throw new ApiException("auth.signed_out", "Not signed in.", 401);
        if (DateTimeOffset.TryParse(_get("acct_exp"), out var exp) && exp < DateTimeOffset.UtcNow.AddSeconds(30)) await RefreshAsync(null, ct);
        var token = _get("acct_access");
        try
        {
            return await RawAsync(method, path, body, token, ct);
        }
        catch (ApiException e) when (e.Status == 401)
        {
            // the server refused this token (it may say "not expired" here, but the server decides): renew it once
            await RefreshAsync(token, ct);
            return await RawAsync(method, path, body, _get("acct_access"), ct);
        }
    }

    private async Task AuthAsync(string path, JsonObject body, CancellationToken ct)
    {
        var res = await RawAsync(HttpMethod.Post, path, body, null, ct) ?? throw new ApiException("server_error", "Empty answer.", 500);
        Store(res);
    }

    /// <param name="rejected">the token the server just refused; null = renewing ahead of its expiry</param>
    private async Task RefreshAsync(string? rejected, CancellationToken ct)
    {
        await _refresh.WaitAsync(ct);
        try
        {
            // another call renewed it meanwhile
            if (rejected is not null && _get("acct_access") != rejected) return;
            if (rejected is null && DateTimeOffset.TryParse(_get("acct_exp"), out var exp) && exp > DateTimeOffset.UtcNow.AddSeconds(30)) return;
            var token = _get("acct_refresh");
            if (string.IsNullOrEmpty(token)) throw new ApiException("auth.signed_out", "Not signed in.", 401);
            JsonNode? res;
            try
            {
                res = await RawAsync(HttpMethod.Post, "/api/auth/refresh", new JsonObject { ["refreshToken"] = token }, null, ct);
            }
            catch (ApiException e) when (e.Status is 400 or 401)
            {
                // the server ended the session (signed out elsewhere, password changed, token reuse)
                Clear();
                throw new ApiException("auth.signed_out", e.Message, 401);
            }
            Store(res!);
        }
        finally
        {
            _refresh.Release();
        }
    }

    private void Store(JsonNode res)
    {
        _set("acct_access", (string?)res["accessToken"] ?? "");
        _set("acct_refresh", (string?)res["refreshToken"] ?? "");
        _set("acct_exp", (string?)res["accessExpiresAt"] ?? DateTimeOffset.UtcNow.AddMinutes(10).ToString("o"));
        if (res["user"] is JsonObject u)
        {
            _set("acct_email", (string?)u["email"] ?? "");
            _set("acct_user", (string?)u["id"] ?? "");
        }
    }

    private void Clear()
    {
        foreach (var k in new[] { "acct_access", "acct_refresh", "acct_exp" }) _set(k, "");
        SignedOut?.Invoke();
    }

    private async Task<JsonNode?> RawAsync(HttpMethod method, string path, JsonNode? body, string? bearer, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        if (bearer is not null) req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearer);
        using var res = await _http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (res.IsSuccessStatusCode) return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);

        string code = "http_" + (int)res.StatusCode, message = res.ReasonPhrase ?? "";
        try
        {
            if (JsonNode.Parse(text) is JsonObject err)
            {
                code = (string?)err["code"] ?? code;
                message = (string?)err["message"] ?? message;
            }
        }
        catch (Exception) { /* not JSON (proxy page) */ }
        throw new ApiException(code, message, (int)res.StatusCode == 0 ? (int)HttpStatusCode.BadGateway : (int)res.StatusCode);
    }
}
