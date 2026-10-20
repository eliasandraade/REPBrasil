using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.Tests.Api;

public sealed class AccountSecurityTests
{
    [Theory]
    [InlineData(null, "/")]
    [InlineData("", "/")]
    [InlineData("/conta", "/conta")]
    [InlineData("/dados?x=ibge.population", "/dados?x=ibge.population")]
    [InlineData("//evil.example/path", "/")]
    [InlineData("https://evil.example/path", "/")]
    [InlineData("javascript:alert(1)", "/")]
    [InlineData("/\\evil.example/path", "/")]
    [InlineData("/conta\\..\\x", "/")]
    [InlineData("/conta\r\nSet-Cookie: x=1", "/")]
    [InlineData("/conta\t", "/")]
    public void NormalizeReturnTo_AllowsOnlyLocalAbsolutePaths(string? value, string expected)
    {
        Assert.Equal(expected, AccountService.NormalizeReturnTo(value));
    }

    [Theory]
    [InlineData("40001", true)]
    [InlineData("40P01", true)]
    [InlineData("23505", false)]
    [InlineData("57014", false)]
    public void Login_retries_only_collisions_that_a_repeated_transaction_resolves(string sqlState, bool retried) =>
        Assert.Equal(retried, AccountService.IsSerializationConflict(new PostgresException("colisão", "ERROR", "ERROR", sqlState)));

    [Fact]
    public void Login_retry_waits_longer_each_round_up_to_a_ceiling()
    {
        var waits = Enumerable.Range(1, 7).Select(round => AccountService.RetryDelay(round).TotalMilliseconds).ToArray();
        Assert.InRange(waits[0], 15, 40);
        Assert.InRange(waits[3], 120, 145);
        Assert.All(waits[5..], wait => Assert.InRange(wait, 400, 425));
        Assert.True(waits.Sum() < 1500, $"pior caso {waits.Sum()} ms");
    }

    private sealed class FixedEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "RepBrasil.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    private sealed class NoHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("no network in this test");
    }

    private static AuthExternalService LogDelivery(string environment) => new(
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:PublicBaseUrl"] = "https://api.example.test",
            ["Auth:MagicLink:Delivery"] = "log",
        }).Build(),
        new NoHttpClientFactory(),
        new FixedEnvironment(environment),
        NullLogger<AuthExternalService>.Instance);

    private static readonly MagicLinkChallenge Challenge = new("pessoa@example.test", "token", "/conta", DateTimeOffset.UtcNow.AddMinutes(15));

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task Magic_link_is_never_written_to_logs_outside_development(string environment)
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            LogDelivery(environment).SendMagicLinkAsync(Challenge, CancellationToken.None));
    }

    [Fact]
    public async Task Magic_link_log_delivery_remains_available_for_local_development()
    {
        await LogDelivery(Environments.Development).SendMagicLinkAsync(Challenge, CancellationToken.None);
    }

    [Fact]
    public void NormalizeReturnTo_RejectsOversizedValue()
    {
        Assert.Equal("/", AccountService.NormalizeReturnTo("/" + new string('a', 513)));
    }

    [Theory]
    [InlineData("same-secret", "same-secret", true)]
    [InlineData("same-secret", "other-secret", false)]
    [InlineData("", "", false)]
    [InlineData(null, "secret", false)]
    [InlineData("secret", null, false)]
    public void SecureEquals_RequiresNonEmptyExactMatch(string? left, string? right, bool expected)
    {
        Assert.Equal(expected, AccountService.SecureEquals(left, right));
    }
}
