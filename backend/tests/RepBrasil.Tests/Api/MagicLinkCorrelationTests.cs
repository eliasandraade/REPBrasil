using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace RepBrasil.Tests.Api;

public sealed class MagicLinkCorrelationTests
{
    [Fact]
    public async Task Consume_without_browser_correlation_fails_closed_before_database_access()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("AllowedOrigins", "https://www.apprepbrasil.com.br");
            builder.UseSetting("Auth:FrontendBaseUrl", "https://www.apprepbrasil.com.br");
            builder.UseSetting("ConnectionStrings:Postgres", "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=1");
            builder.UseSetting("Migrate:SkipStartupApply", "true");
        });

        var response = await factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        }).GetAsync("/api/v1/auth/magic-link/consume?token=stolen-token");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("https://www.apprepbrasil.com.br/entrar?erro=link-invalido", response.Headers.Location?.AbsoluteUri);
    }
}
