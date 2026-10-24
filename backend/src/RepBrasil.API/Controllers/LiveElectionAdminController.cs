using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Accounts;
using RepBrasil.API.LiveElection;
using RepBrasil.Application.LiveElection;
using RepBrasil.Infrastructure.LiveElection;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Área técnica da apuração (Super Admin): saúde detalhada, validador matemático independente com o alerta interno
/// antecipado e controle do replay. O alerta "limite matemático atingido" do REPBrasil só aparece aqui — nunca na página
/// pública, que só declara a definição com o sinal oficial md=e.
/// </summary>
[ApiController]
[Route("api/v1/admin/live-election")]
[SuperAdmin]
[Tags("Administração")]
public sealed class LiveElectionAdminController(
    LiveElectionHub hub,
    LiveElectionRuntime runtime,
    LiveElectionMetrics metrics,
    LiveElectionOptions options,
    IServiceProvider services,
    TimeProvider time) : ControllerBase
{
    /// <summary>Saúde detalhada: fonte, ETag, banco, SSE, líder, modo, contadores e alertas recentes.</summary>
    [HttpGet("health")]
    public async Task<IActionResult> Health(CancellationToken ct)
    {
        var s = hub.Current;
        var now = time.GetUtcNow();
        var store = services.GetService<ILiveElectionStore>();
        var postgres = store is null ? "not-configured" : await store.PingAsync(ct) ? "healthy" : "down";
        var http = runtime.Engine?.Source as TseHttpSource;
        return Ok(new
        {
            enabled = options.Enabled,
            mode = options.Mode,
            instance = runtime.InstanceId,
            pollerLeader = runtime.IsLeader ? runtime.InstanceId : null,
            isLeader = runtime.IsLeader,
            // leader = grava; uncoordinated = banco fora, ingere sem gravar; follower = lê do banco por cursor.
            role = runtime.Role,
            persists = runtime.Engine?.Persist,
            cursor = runtime.Engine?.Cursor,
            lastSync = runtime.Engine?.LastSync is { } sync ? new { rows = sync.Rows, milliseconds = sync.Milliseconds, at = sync.At } : null,
            sessionStartedAt = runtime.SessionStartedAt,
            lastSessionError = runtime.LastError,
            phase = s?.Phase.ToString(),
            election = s is null ? null : LiveProjector.Election(s.Context),
            source = s is null ? null : new
            {
                status = s.Source.Failing ? "down" : s.Source.Stale ? "stale" : "healthy",
                s.Source.LastSuccessAt,
                s.Source.LastCheckedAt,
                lastNationalChangeAt = s.Source.LastChangeAt,
                s.Source.LastFileGeneratedAt,
                s.Source.ConsecutiveFailures,
                s.Source.LastError,
                s.Source.BlockedUntil,
                s.Source.StaleSince,
                nationalEtag = s.National?.ETag,
                nationalGenerationId = s.National?.GenerationId,
                dataAgeSeconds = s.National is null ? (double?)null : (now - s.National.IngestedAt).TotalSeconds,
            },
            snapshotVersion = s?.NationalVersion,
            statesVersion = s?.StatesVersion,
            ufsLoaded = s?.States.Count,
            municipalitiesLoaded = s?.Municipalities.Count,
            zonesLoaded = s?.Zones.Count,
            firstRoundLoaded = s?.FirstRound is { } r1 ? new { national = r1.National is not null, states = r1.States.Count, municipalities = r1.Municipalities.Count } : null,
            postgres,
            postgresWrites = runtime.Engine?.StoreHealthy,
            redis = "not-configured (coordenação pelo PostgreSQL: advisory lock + LISTEN/NOTIFY)",
            sseSubscribers = hub.Subscribers,
            limits = new { maxRequestsPerSecond = options.EffectiveMaxRequestsPerSecond, backgroundRequestsPerSecond = options.EffectiveBackgroundRequestsPerSecond, hardCap = LiveElectionOptions.HardMaxRequestsPerSecond },
            http = http is null ? null : new { http.BlockedUntil, http.CircuitOpenUntil, http.BackgroundPausedUntil },
            metrics = metrics.Snapshot(),
            alerts = runtime.Engine?.RecentAlerts ?? [],
            replay = runtime.Replay is { } r ? new { r.Speed, r.StartedAt, r.CurrentFrame, r.FinalFrame, r.ThresholdFrame, r.OfficialDefinitionFrame, r.EnvironmentName } : null,
        });
    }

    /// <summary>
    /// Validador independente completo, com o alerta técnico antecipado e a diferença temporal entre o REPBrasil e o
    /// sinal oficial md=e.
    /// </summary>
    [HttpGet("math")]
    public IActionResult Math()
    {
        var s = hub.Current;
        if (s is null) return NotFound();
        var m = LiveProjector.Independent(s);
        var official = s.National?.MathFlag == "e";
        return Ok(new
        {
            independent = m,
            distanceToIrreversibility = m.DistanceToIrreversibility,
            officialFlag = s.National?.MathFlag,
            technicalAlert = m.IsMathematicallyIrreversible && !official
                ? "Limite matemático independente do REPBrasil atingido; aguardando sinal oficial md=e."
                : null,
            repBrasilMathDetectedAt = s.Math.RepBrasilDetectedAt,
            tseMathDefinedAt = s.Math.TseDefinedAt,
            tseSignalReceivedAt = s.Math.TseSignalDetectedAt,
            repBrasilLeadSeconds = s.Math.RepBrasilDetectedAt is { } r && s.Math.TseSignalDetectedAt is { } t ? (t - r).TotalSeconds : (double?)null,
            internalEvents = s.Events.Where(e => !e.IsPublic).TakeLast(50).Select(e => new { e.Id, e.Type, e.At, e.DetectedAt, e.Title, e.Detail }),
        });
    }

    public sealed record ReplayRequest(double? Speed);

    /// <summary>Reinicia o replay sintético (só no modo replay): 1, 5, 10, 30 ou 0 (instantâneo).</summary>
    [HttpPost("replay/restart")]
    public IActionResult RestartReplay([FromBody] ReplayRequest request)
    {
        if (options.Mode != LiveModes.Replay || runtime.Replay is null)
            return Conflict(new { message = "Replay só existe com ELECTION_DATA_MODE=replay." });
        var speed = request.Speed ?? options.ReplaySpeed;
        if (speed is < 0 or > 600) return BadRequest(new { message = "Velocidade entre 0 (instantâneo) e 600." });
        runtime.Replay.Reset(speed);
        runtime.RequestRestart();
        return Accepted(new { speed, environment = runtime.Replay.EnvironmentName });
    }
}
