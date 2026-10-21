using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Interfaces;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Accounts;

/// <summary>Estado de um componente: <c>ok</c>, <c>down</c> ou <c>not_configured</c>, com a latência medida.</summary>
public sealed record ComponentHealth(string Name, string Status, double? LatencyMs, string? Detail);

public sealed record FreshnessRow(string Source, long Rows, DateTimeOffset? LatestAt);

public sealed record IngestionRunRow(string Source, string Status, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt, string? Error);

public sealed record DerivedRefreshRow(string View, DateTimeOffset RefreshedAt, int BuRuns, DateTimeOffset? BuLastFinishedAt);

public sealed record AdminOverview(
    DateTimeOffset GeneratedAt,
    object Api,
    IReadOnlyList<ComponentHealth> Components,
    IReadOnlyList<string> PendingMigrations,
    IReadOnlyList<FreshnessRow> Freshness,
    IReadOnlyList<DerivedRefreshRow> DerivedViews,
    IReadOnlyList<IngestionRunRow> RecentIngestions,
    object Users,
    object Subscriptions,
    object Alerts,
    object Support,
    object Http);

/// <summary>
/// Diagnóstico do Super Admin. Só mede componentes que existem e nunca devolve segredo: nada de cadeia de
/// conexão, token, chave ou variável sensível; erros de ingestão saem truncados e com credenciais mascaradas.
/// </summary>
public sealed partial class AdminDiagnosticsService(
    ApplicationDbContext db,
    IElectoralLakeClient lake,
    IHttpClientFactory httpFactory,
    IConfiguration configuration,
    IHostEnvironment environment,
    RequestMetrics metrics,
    AdminService admin)
{
    public const string FrontendProbeClient = "admin-frontend-probe";
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(5);

    public async Task<AdminOverview> OverviewAsync(CancellationToken ct)
    {
        var lakeProbe = ProbeLakeAsync(ct);
        var frontendProbe = ProbeFrontendAsync(ct);

        var database = await ProbeDatabaseAsync(ct);
        var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
        var applied = (await db.Database.GetAppliedMigrationsAsync(ct)).LastOrDefault();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            var freshness = await FreshnessAsync(ct);
            var derived = await DerivedAsync(ct);
            var ingestions = await IngestionsAsync(ct);
            var counters = await CountersAsync(ct);
            var users = await UserSummaryAsync(ct);
            var http = metrics.Snapshot();
            return new(
                DateTimeOffset.UtcNow,
                new
                {
                    environment = environment.EnvironmentName,
                    revision = Environment.GetEnvironmentVariable("RAILWAY_GIT_COMMIT_SHA") ?? Environment.GetEnvironmentVariable("REPBRASIL_REVISION"),
                    startedAt = metrics.StartedAt,
                    uptimeSeconds = (long)(DateTimeOffset.UtcNow - metrics.StartedAt).TotalSeconds,
                    runtime = Environment.Version.ToString(),
                    latestMigration = applied,
                },
                [database, await lakeProbe, await frontendProbe],
                pending,
                freshness,
                derived,
                ingestions,
                users,
                counters.Subscriptions,
                counters.Alerts,
                counters.Support,
                new
                {
                    since = metrics.StartedAt,
                    calls = http.Sum(r => r.Calls),
                    serverErrors = http.Sum(r => r.ServerErrors),
                    routes = http.Take(60),
                });
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    private async Task<ComponentHealth> ProbeDatabaseAsync(CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            var started = Stopwatch.GetTimestamp();
            await using (var ping = db.Command("SELECT 1"))
                await ping.ExecuteScalarAsync(ct);
            var latency = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            await using var version = db.Command("SHOW server_version");
            var server = await version.ExecuteScalarAsync(ct) as string;
            return new("Banco de dados (PostgreSQL)", "ok", Math.Round(latency, 1), server is null ? null : $"PostgreSQL {server}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new("Banco de dados (PostgreSQL)", "down", null, "Sem resposta do banco.");
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    private async Task<ComponentHealth> ProbeLakeAsync(CancellationToken ct)
    {
        const string name = "Lake eleitoral (RPC)";
        if (string.IsNullOrWhiteSpace(configuration["ElectoralLake:BaseUrl"])) return new(name, "not_configured", null, "ElectoralLake:BaseUrl não definida.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(ProbeTimeout);
        var started = Stopwatch.GetTimestamp();
        var healthy = false;
        try
        {
            healthy = await lake.HealthAsync(deadline.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            healthy = false;
        }
        var latency = Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 1);
        return new(name, healthy ? "ok" : "down", latency, healthy ? null : "Health do worker não respondeu 2xx no prazo.");
    }

    private async Task<ComponentHealth> ProbeFrontendAsync(CancellationToken ct)
    {
        const string name = "Frontend (Next.js)";
        if (!configuration.GetValue("Admin:Diagnostics:ProbeFrontend", true)) return new(name, "not_configured", null, "Sonda desligada (Admin:Diagnostics:ProbeFrontend=false).");
        if (!Uri.TryCreate(configuration["Auth:FrontendBaseUrl"], UriKind.Absolute, out var site)) return new(name, "not_configured", null, "Auth:FrontendBaseUrl não definida.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(ProbeTimeout);
        var started = Stopwatch.GetTimestamp();
        try
        {
            using var response = await httpFactory.CreateClient(FrontendProbeClient).GetAsync(site, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            var latency = Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 1);
            var ok = (int)response.StatusCode < 400;
            return new(name, ok ? "ok" : "down", latency, string.Create(CultureInfo.InvariantCulture, $"HTTP {(int)response.StatusCode}"));
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            return new(name, "down", null, "Sem resposta no prazo.");
        }
    }

    private async Task<List<FreshnessRow>> FreshnessAsync(CancellationToken ct)
    {
        var rows = new List<FreshnessRow>();
        await using var command = db.Command("""
            SELECT 'Indicadores socioeconômicos', count(*), max(retrieved_at) FROM electoral.socioeconomic_source
            UNION ALL SELECT 'Parlamento (fontes)', count(*), max(retrieved_at) FROM electoral.parliament_source
            UNION ALL SELECT 'Pesquisas (fontes)', count(*), max(retrieved_at) FROM electoral.poll_source
            UNION ALL SELECT 'Apuração (snapshots)', count(*), max(captured_at) FROM electoral.totalization_snapshot
            UNION ALL SELECT 'Resultados por seção (arquivos TSE)', count(*), max(downloaded_at) FROM electoral.open_data_source_file
            """);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(new(reader.GetString(0), reader.GetInt64(1), reader.NullableTime(2)));
        return rows;
    }

    private async Task<List<DerivedRefreshRow>> DerivedAsync(CancellationToken ct)
    {
        var rows = new List<DerivedRefreshRow>();
        await using var command = db.Command("SELECT view_name, refreshed_at, bu_runs, bu_last_finished_at FROM electoral.derived_refresh ORDER BY view_name");
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(new(reader.GetString(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetInt32(2), reader.NullableTime(3)));
        return rows;
    }

    private async Task<List<IngestionRunRow>> IngestionsAsync(CancellationToken ct)
    {
        var rows = new List<IngestionRunRow>();
        await using var command = db.Command("""
            SELECT source, status, started_at, finished_at, error FROM electoral.ingestion_run
             ORDER BY started_at DESC LIMIT 15
            """);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            rows.Add(new(reader.GetString(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2), reader.NullableTime(3), Redact(reader.NullableString(4))));
        return rows;
    }

    private sealed record Counters(object Subscriptions, object Alerts, object Support);

    private async Task<Counters> CountersAsync(CancellationToken ct)
    {
        await using var command = db.Command("""
            SELECT
              (SELECT count(*) FROM account.subscription WHERE status = 'active')::int,
              (SELECT count(*) FROM account.subscription WHERE status = 'past_due')::int,
              (SELECT count(*) FROM account.subscription WHERE status = 'canceled')::int,
              (SELECT count(*) FROM account.subscription WHERE status = 'expired')::int,
              (SELECT count(*) FROM account.subscription WHERE status IN ('active', 'past_due') AND current_period_end <= now())::int,
              (SELECT count(*) FROM account.entitlement WHERE entitlement_key = 'plan' AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now()))::int,
              (SELECT count(*) FROM account.alert_subscription WHERE enabled)::int,
              (SELECT count(*) FROM account.notification)::int,
              (SELECT count(*) FROM account.alert_edition WHERE fanned_out_at IS NULL)::int,
              (SELECT max(first_seen_at) FROM account.alert_edition),
              (SELECT count(*) FROM account.support_request WHERE status = 'novo')::int,
              (SELECT count(*) FROM account.support_request WHERE status = 'em_analise')::int
            """);
        await using var reader = await command.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        return new(
            new { active = reader.GetInt32(0), pastDue = reader.GetInt32(1), canceled = reader.GetInt32(2), expired = reader.GetInt32(3), lapsedButActive = reader.GetInt32(4), manualPlanGrants = reader.GetInt32(5), billingProvider = (string?)null },
            new { enabledSubscriptions = reader.GetInt32(6), notifications = reader.GetInt32(7), pendingEditions = reader.GetInt32(8), latestEditionAt = reader.NullableTime(9) },
            new { open = reader.GetInt32(10), inReview = reader.GetInt32(11) });
    }

    private async Task<object> UserSummaryAsync(CancellationToken ct)
    {
        var (everyone, truncated) = await admin.AllUsersAsync(ct);
        await using var command = db.Command("""
            SELECT
              (SELECT count(*) FROM account.user_account WHERE created_at > now() - interval '7 days')::int,
              (SELECT count(*) FROM account.user_account WHERE created_at > now() - interval '30 days')::int,
              (SELECT count(DISTINCT user_id) FROM account.session WHERE last_seen_at > now() - interval '30 days')::int,
              (SELECT count(*) FROM account.session WHERE revoked_at IS NULL AND expires_at > now())::int
            """);
        await using var reader = await command.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        return new
        {
            total = everyone.Count,
            active = everyone.Count(u => u.Status == "active"),
            suspended = everyone.Count(u => u.Status == "suspended"),
            new7d = reader.GetInt32(0),
            new30d = reader.GetInt32(1),
            seen30d = reader.GetInt32(2),
            activeSessions = reader.GetInt32(3),
            byPlan = PlanCatalog.Plans.ToDictionary(p => p.Code, p => everyone.Count(u => u.Plan == p.Code && u.Status == "active")),
            byRole = new
            {
                user = everyone.Count(u => u.Role == EntitlementResolver.UserRole),
                superadmin = everyone.Count(u => u.Role == EntitlementResolver.SuperadminRole),
            },
            truncated,
        };
    }

    /// <summary>
    /// Erro de ingestão para a tela: 200 caracteres, com <c>senha/token/chave/authorization=…</c> (inclusive o valor depois de
    /// <c>Bearer</c>/<c>Basic</c>), credencial solta depois desses esquemas e URLs com credencial mascarados.
    /// </summary>
    public static string? Redact(string? error)
    {
        if (string.IsNullOrWhiteSpace(error)) return null;
        var text = Secrets().Replace(error, m => m.Groups["name"].Value + "=***");
        text = SchemeCredentials().Replace(text, m => m.Groups["scheme"].Value + " ***");
        text = UrlCredentials().Replace(text, "://***@");
        return text.Length <= 200 ? text : text[..200] + "…";
    }

    [GeneratedRegex("(?<name>password|pwd|passwd|token|secret|api[_-]?key|apikey|authorization)\\s*[=:]\\s*(?:(?:bearer|basic|digest|token)\\s+)?[^\\s;&,]+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex Secrets();

    /// <summary>Credencial solta depois do esquema (ex.: "Bearer eyJ…" num log de requisição), mesmo sem nome antes.</summary>
    [GeneratedRegex("\\b(?<scheme>bearer|basic)\\s+[A-Za-z0-9\\-._~+/]{8,}=*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex SchemeCredentials();

    [GeneratedRegex("://[^/@\\s]+@", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex UrlCredentials();
}
