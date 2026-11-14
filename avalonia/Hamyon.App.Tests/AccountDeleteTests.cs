using System.Net;
using Hamyon.App.Services;
using Hamyon.App.ViewModels;
using Xunit;

namespace Hamyon.App.Tests;

public sealed class AccountDeleteTests
{
    private sealed class Server : HttpMessageHandler
    {
        public readonly List<string> Calls = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            Calls.Add($"{r.Method} {r.RequestUri!.AbsolutePath}");
            if (r.RequestUri.AbsolutePath == "/api/auth/login")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"accessToken":"a","refreshToken":"r","accessExpiresAt":"2099-01-01T00:00:00Z","user":{"id":"u1","email":"a@b.uz"}}"""),
                });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
        }
    }

    [Fact]
    public async Task Delete_asks_first_then_removes_the_account_on_the_server_and_signs_out()
    {
        var prefs = new Dictionary<string, string>();
        var server = new Server();
        var account = new Account(k => prefs.GetValueOrDefault(k), (k, v) => prefs[k] = v, server, "https://test.local");
        await account.LoginAsync("a@b.uz", "password1");
        var vm = new AccountViewModel(account, () => Task.CompletedTask, () => { }, () => "", () => { });

        vm.AskDeleteCommand.Execute(null);
        Assert.True(vm.ConfirmDelete);
        Assert.DoesNotContain("DELETE /api/me", server.Calls); // nothing happens on the first tap

        await vm.DeleteAccountCommand.ExecuteAsync(null);
        Assert.Contains("DELETE /api/me", server.Calls);
        Assert.False(account.SignedIn);
        Assert.False(vm.SignedIn);
        Assert.False(string.IsNullOrEmpty(vm.Notice));
    }
}
