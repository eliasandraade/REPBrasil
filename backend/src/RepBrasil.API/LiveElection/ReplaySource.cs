using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Fonte do modo replay: serve o <see cref="SyntheticScenario"/> como se fosse a CDN do TSE (ETag, 304, 404 para arquivo
/// inexistente), avançando um quadro a cada ReplayStep ÷ velocidade. Velocidade 0 = instantâneo (quadro final).
/// Não faz nenhuma requisição de rede.
/// </summary>
public sealed class ReplaySource : ITseSource
{
    private readonly TimeProvider time;
    private readonly LiveElectionMetrics? metrics;
    private readonly TimeSpan baseStep;
    private readonly (int From, int To)? outage;
    private readonly int durationScale;
    private readonly string? fixedEnvironment;
    private readonly object gate = new();
    private SyntheticScenario scenario;
    private DateTimeOffset startedAt;
    private double speed;

    /// <summary>Fonte de replay; <c>durationScale</c> multiplica a duração da apuração em quadros (teste de longa duração).</summary>
    public ReplaySource(TimeProvider time, LiveElectionOptions options, LiveElectionMetrics? metrics = null, int durationScale = 1)
    {
        this.time = time;
        this.metrics = metrics;
        this.durationScale = durationScale;
        fixedEnvironment = options.ReplayEnvironment;
        baseStep = options.ReplayStep <= TimeSpan.Zero ? TimeSpan.FromSeconds(60) : options.ReplayStep;
        outage = options.ReplayOutage;
        (scenario, startedAt, speed) = Build(options.ReplaySpeed);
    }

    public double Speed { get { lock (gate) return speed; } }

    public DateTimeOffset StartedAt { get { lock (gate) return startedAt; } }

    public int FinalFrame { get { lock (gate) return scenario.FinalFrame; } }

    public int? ThresholdFrame { get { lock (gate) return scenario.ThresholdFrame; } }

    public int? OfficialDefinitionFrame { get { lock (gate) return scenario.OfficialDefinitionFrame; } }

    /// <summary>Nome do ambiente desta sessão de replay (linha própria em live_election).</summary>
    public string EnvironmentName { get { lock (gate) return fixedEnvironment ?? $"replay-{startedAt.UtcDateTime:yyyyMMdd't'HHmmss}"; } }

    public int CurrentFrame
    {
        get
        {
            lock (gate)
            {
                if (speed <= 0) return scenario.FinalFrame;
                var elapsed = time.GetUtcNow() - startedAt;
                return (int)Math.Clamp(Math.Floor(elapsed / scenario.Step), 0, scenario.FinalFrame);
            }
        }
    }

    public void Reset(double newSpeed)
    {
        lock (gate) (scenario, startedAt, speed) = Build(newSpeed);
    }

    private (SyntheticScenario, DateTimeOffset, double) Build(double newSpeed)
    {
        var now = time.GetUtcNow();
        var step = newSpeed <= 0 ? TimeSpan.FromSeconds(1) : TimeSpan.FromTicks((long)(baseStep.Ticks / newSpeed));
        if (step < TimeSpan.FromMilliseconds(200)) step = TimeSpan.FromMilliseconds(200);
        return (new SyntheticScenario(now, step, durationScale), now, newSpeed);
    }

    /// <summary>Conta como requisição à "fonte" (mesma métrica do TSE real), para o teste de carga provar que visitantes
    /// não geram leituras.</summary>
    public async Task<TseFetchResult> FetchAsync(Uri url, TseConditional? conditional, TsePriority priority, CancellationToken ct)
    {
        var result = await Read(url, conditional);
        metrics?.Request(result.Status, result.HttpStatus, result.Duration);
        return result;
    }

    private Task<TseFetchResult> Read(Uri url, TseConditional? conditional)
    {
        if (!string.Equals(url.Host, TseEnvironment.ReplayHost, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("O replay só atende URLs do host de replay.");
        var now = time.GetUtcNow();
        byte[]? content;
        int frame;
        lock (gate)
        {
            frame = CurrentFrameUnlocked();
            content = scenario.File(url.AbsolutePath, frame);
        }
        if (outage is { } o && frame >= o.From && frame <= o.To && !url.AbsolutePath.EndsWith("ele-c.json", StringComparison.Ordinal))
            return Task.FromResult(new TseFetchResult(TseFetchStatus.Failed, 503, null, null, null, TimeSpan.Zero, "HTTP 503 (falha simulada do replay)", now));
        if (content is null || content.Length == 0)
            return Task.FromResult(new TseFetchResult(TseFetchStatus.NotFound, 404, null, null, null, TimeSpan.Zero, "404", now));
        var etag = SyntheticScenario.ETagOf(content);
        if (conditional?.ETag == etag)
            return Task.FromResult(new TseFetchResult(TseFetchStatus.NotModified, 304, null, etag, null, TimeSpan.Zero, null, now));
        return Task.FromResult(new TseFetchResult(TseFetchStatus.Ok, 200, content, etag, null, TimeSpan.Zero, null, now));
    }

    private int CurrentFrameUnlocked()
    {
        if (speed <= 0) return scenario.FinalFrame;
        var elapsed = time.GetUtcNow() - startedAt;
        return (int)Math.Clamp(Math.Floor(elapsed / scenario.Step), 0, scenario.FinalFrame);
    }
}
