using RepBrasil.API.Accounts;
using RepBrasil.API.Controllers;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.Tests.Api;

/// <summary>Peças do Super Admin sem banco: regra de acesso no catálogo, redação de erros e métricas por rota.</summary>
public sealed class AdminUnitTests
{
    private static AccessDescription Describe<T>(string method, string http) =>
        AccessOperationFilter.Describe(typeof(T).GetMethod(method)!, http);

    [Fact]
    public void Catalog_access_comes_from_the_attributes_that_enforce_it()
    {
        Assert.Equal("superadmin", Describe<AdminController>(nameof(AdminController.Overview), "GET").Kind);
        Assert.True(Describe<AdminController>(nameof(AdminController.Suspend), "POST").Csrf);
        var folder = Describe<AccountController>(nameof(AccountController.MoveSaved), "POST");
        Assert.Equal(("capability", PlanCatalog.SavedFolders, PlanCatalog.Professional, true), (folder.Kind, folder.Capability, folder.RequiredPlan, folder.Csrf));
        Assert.Equal(("session", false), (Describe<AccountController>(nameof(AccountController.Me), "GET").Kind, Describe<AccountController>(nameof(AccountController.Me), "GET").Csrf));
        Assert.Equal("public", Describe<PlansController>(nameof(PlansController.Plans), "GET").Kind);
        Assert.Equal("public", Describe<SupportController>(nameof(SupportController.Create), "POST").Kind);
        var alerts = Describe<AccountController>(nameof(AccountController.PublishAlert), "POST");
        Assert.Equal(("header", "X-Alerts-Token"), (alerts.Kind, alerts.Header));
    }

    private const string FakeCredential = "valor-ficticio-de-teste";

    /// <summary>
    /// Mensagens de erro com uma credencial fictícia interpolada: o teste precisa só do formato que a redação mascara,
    /// e um valor literal nesse formato seria (com razão) apontado pela varredura de segredos do repositório.
    /// </summary>
    public static TheoryData<string, string> LeakyErrors() => new()
    {
        { $"connection failed: Host=db;Password={FakeCredential};Database=x", "Password=***" },
        { $"GET https://user:{FakeCredential}@lake.internal/v1 failed", "https://***@lake.internal" },
        { $"token: {FakeCredential} rejected", "token=***" },
    };

    [Theory]
    [MemberData(nameof(LeakyErrors))]
    public void Ingestion_errors_are_masked_before_reaching_the_screen(string raw, string expected)
    {
        var redacted = AdminDiagnosticsService.Redact(raw)!;
        Assert.Contains(expected, redacted);
        Assert.DoesNotContain(FakeCredential, redacted);
    }

    [Fact]
    public void Long_errors_are_truncated_and_empty_errors_stay_empty()
    {
        Assert.Null(AdminDiagnosticsService.Redact("  "));
        Assert.Equal(201, AdminDiagnosticsService.Redact(new string('x', 500))!.Length);
    }

    [Fact]
    public void Route_metrics_count_errors_and_compute_p95_from_recent_calls()
    {
        var metrics = new RequestMetrics();
        for (var i = 1; i <= 100; i++) metrics.Record("GET", "api/v1/plans", i == 100 ? 503 : 200, i);
        metrics.Record("GET", "api/v1/plans", 404, 1);
        var plans = Assert.Single(metrics.Snapshot());
        Assert.Equal((101L, 1L, 1L), (plans.Calls, plans.ClientErrors, plans.ServerErrors));
        Assert.Equal(95, plans.P95Ms);
    }
}
