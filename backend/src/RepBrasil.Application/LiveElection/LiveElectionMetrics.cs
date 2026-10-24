using System.Collections.Concurrent;
using System.Diagnostics.Metrics;

namespace RepBrasil.Application.LiveElection;

/// <summary>
/// Métricas técnicas da apuração (System.Diagnostics.Metrics, medidor "RepBrasil.LiveElection") e um espelho em memória
/// para o diagnóstico interno. Valem por réplica e zeram a cada deploy.
/// </summary>
public sealed class LiveElectionMetrics : IDisposable
{
    public const string MeterName = "RepBrasil.LiveElection";

    private readonly Meter meter = new(MeterName);
    private readonly Histogram<double> requestDuration;
    private readonly Counter<long> requests;
    private readonly Counter<long> notModified;
    private readonly Counter<long> errors;
    private readonly Counter<long> notFound;
    private readonly Counter<long> rateLimited;
    private readonly Counter<long> snapshotWrites;
    private readonly Counter<long> snapshotDeduplicated;
    private readonly ConcurrentDictionary<string, long> productEvents = new(StringComparer.Ordinal);
    private long requestTotal;
    private long notModifiedTotal;
    private long errorTotal;
    private long notFoundTotal;
    private long rateLimitTotal;
    private long snapshotWriteTotal;
    private long snapshotDedupTotal;
    private long sseConnections;
    private long sseMessages;
    private long contractErrors;
    private long lastSuccessUnixMs;

    public LiveElectionMetrics()
    {
        requestDuration = meter.CreateHistogram<double>("tse_request_duration_ms", "ms");
        requests = meter.CreateCounter<long>("tse_request_total");
        notModified = meter.CreateCounter<long>("tse_304_total");
        errors = meter.CreateCounter<long>("tse_error_total");
        notFound = meter.CreateCounter<long>("tse_404_total");
        rateLimited = meter.CreateCounter<long>("tse_rate_limit_total");
        snapshotWrites = meter.CreateCounter<long>("snapshot_write_total");
        snapshotDeduplicated = meter.CreateCounter<long>("snapshot_deduplicated_total");
        meter.CreateObservableGauge("sse_connections_active", () => Interlocked.Read(ref sseConnections));
        meter.CreateObservableGauge("tse_last_success_timestamp", () => Interlocked.Read(ref lastSuccessUnixMs) / 1000.0);
        meter.CreateObservableGauge("election_data_age_seconds", () => DataAgeSeconds ?? 0);
        meter.CreateObservableGauge("election_ingestion_lag_seconds", () => IngestionLagSeconds ?? 0);
    }

    /// <summary>Idade do dado nacional servido (agora − recebimento), atualizada pelo motor.</summary>
    public double? DataAgeSeconds { get; set; }

    /// <summary>Recebimento − geração no TSE do último arquivo nacional.</summary>
    public double? IngestionLagSeconds { get; set; }

    public void Request(TseFetchStatus status, int httpStatus, TimeSpan duration)
    {
        Interlocked.Increment(ref requestTotal);
        requests.Add(1);
        requestDuration.Record(duration.TotalMilliseconds);
        switch (status)
        {
            case TseFetchStatus.Ok:
                Interlocked.Exchange(ref lastSuccessUnixMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                break;
            case TseFetchStatus.NotModified:
                Interlocked.Exchange(ref lastSuccessUnixMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Interlocked.Increment(ref notModifiedTotal);
                notModified.Add(1);
                break;
            case TseFetchStatus.NotFound:
                Interlocked.Increment(ref notFoundTotal);
                notFound.Add(1);
                break;
            case TseFetchStatus.Blocked:
                Interlocked.Increment(ref rateLimitTotal);
                rateLimited.Add(1);
                break;
            default:
                Interlocked.Increment(ref errorTotal);
                errors.Add(1);
                break;
        }
        if (httpStatus is 429 or 403 && status != TseFetchStatus.Blocked)
        {
            Interlocked.Increment(ref rateLimitTotal);
            rateLimited.Add(1);
        }
    }

    public void SnapshotWritten() { Interlocked.Increment(ref snapshotWriteTotal); snapshotWrites.Add(1); }

    public void SnapshotDeduplicated() { Interlocked.Increment(ref snapshotDedupTotal); snapshotDeduplicated.Add(1); }

    public void ContractError() => Interlocked.Increment(ref contractErrors);

    public void SseOpened() => Interlocked.Increment(ref sseConnections);

    public void SseClosed() => Interlocked.Decrement(ref sseConnections);

    public void SseMessage(int subscribers) => Interlocked.Add(ref sseMessages, subscribers);

    public void ProductEvent(string name) => productEvents.AddOrUpdate(name, 1, (_, v) => v + 1);

    public long SseConnections => Interlocked.Read(ref sseConnections);

    /// <summary>Total de requisições ao TSE (inclui 304): não pode crescer com o número de visitantes.</summary>
    public long TseRequests => Interlocked.Read(ref requestTotal);

    public object Snapshot() => new
    {
        tseRequestTotal = Interlocked.Read(ref requestTotal),
        tse304Total = Interlocked.Read(ref notModifiedTotal),
        tseErrorTotal = Interlocked.Read(ref errorTotal),
        tse404Total = Interlocked.Read(ref notFoundTotal),
        tseRateLimitTotal = Interlocked.Read(ref rateLimitTotal),
        tseLastSuccessAt = Interlocked.Read(ref lastSuccessUnixMs) is var ms and > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : (DateTimeOffset?)null,
        electionDataAgeSeconds = DataAgeSeconds,
        electionIngestionLagSeconds = IngestionLagSeconds,
        sseConnectionsActive = Interlocked.Read(ref sseConnections),
        sseMessagesDelivered = Interlocked.Read(ref sseMessages),
        snapshotWriteTotal = Interlocked.Read(ref snapshotWriteTotal),
        snapshotDeduplicatedTotal = Interlocked.Read(ref snapshotDedupTotal),
        contractErrorTotal = Interlocked.Read(ref contractErrors),
        productEvents = productEvents.ToDictionary(kv => kv.Key, kv => kv.Value),
    };

    public void Dispose() => meter.Dispose();
}
