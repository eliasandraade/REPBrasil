using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;
using RepBrasil.Application.LiveElection;

namespace RepBrasil.Infrastructure.LiveElection;

/// <summary>
/// Cliente dos arquivos de divulgação do TSE. Regras:
/// - teto conservador (padrão 20 req/s, nunca acima de 80; o limite oficial é 100 req/s por IP) com espaçamento uniforme,
///   e um segundo teto para a varredura de fundo; 304 também conta para o limite do TSE, então também passa pelo ritmo;
/// - GET condicional (If-None-Match/If-Modified-Since), gzip/br, conexões reaproveitadas, tempo limite curto;
/// - 404 nunca é repetido em laço: a URL entra em espera (NotFoundCooldown); muitos 404 pausam a varredura de fundo;
/// - 403/429: pausa TOTAL (BlockPause, padrão 11 min) — tentar durante o bloqueio do TSE renova o bloqueio;
/// - 5xx/tempo esgotado: recuo exponencial com jitter por URL e disjuntor global.
/// Só aceita hosts oficiais do TSE: URL de replay (host .invalid) nunca sai daqui.
/// </summary>
public sealed partial class TseHttpSource : ITseSource
{
    public const string HttpClientName = "tse-results";
    private const int NotFoundBurst = 20;
    private static readonly TimeSpan NotFoundWindow = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan BackgroundPauseOnNotFound = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan CircuitOpen = TimeSpan.FromSeconds(30);
    private const int CircuitThreshold = 8;

    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase) { "resultados.tse.jus.br", "resultados-sim.tse.jus.br" };

    private readonly HttpClient http;
    private readonly LiveElectionOptions options;
    private readonly LiveElectionMetrics metrics;
    private readonly TimeProvider time;
    private readonly ILogger<TseHttpSource> logger;
    private readonly Pacer global;
    private readonly Pacer background;
    private readonly ConcurrentDictionary<string, UrlState> urls = new(StringComparer.Ordinal);
    private readonly ConcurrentQueue<DateTimeOffset> recentNotFound = new();
    private readonly object gate = new();
    private DateTimeOffset? blockedUntil;
    private DateTimeOffset? circuitOpenUntil;
    private DateTimeOffset? backgroundPausedUntil;
    private int consecutiveFailures;

    public TseHttpSource(HttpClient http, LiveElectionOptions options, LiveElectionMetrics metrics, TimeProvider time, ILogger<TseHttpSource> logger)
    {
        this.http = http;
        this.options = options;
        this.metrics = metrics;
        this.time = time;
        this.logger = logger;
        global = new Pacer(options.EffectiveMaxRequestsPerSecond, time);
        background = new Pacer(options.EffectiveBackgroundRequestsPerSecond, time);
        if (!http.DefaultRequestHeaders.UserAgent.Any())
            http.DefaultRequestHeaders.UserAgent.ParseAdd("REPBrasil-Apuracao/1.0 (+https://www.apprepbrasil.com.br)");
    }

    public DateTimeOffset? BlockedUntil { get { lock (gate) return blockedUntil; } }

    public DateTimeOffset? CircuitOpenUntil { get { lock (gate) return circuitOpenUntil; } }

    public DateTimeOffset? BackgroundPausedUntil { get { lock (gate) return backgroundPausedUntil; } }

    public async Task<TseFetchResult> FetchAsync(Uri url, TseConditional? conditional, TsePriority priority, CancellationToken ct)
    {
        if (url.Scheme != Uri.UriSchemeHttps || !AllowedHosts.Contains(url.Host))
            throw new InvalidOperationException($"Host fora da lista do TSE: {url.Host}");

        var now = time.GetUtcNow();
        var key = url.AbsoluteUri;
        var state = urls.GetOrAdd(key, _ => new UrlState());
        lock (gate)
        {
            if (blockedUntil > now) return Skip(TseFetchStatus.Blocked, now, "Pausa por bloqueio do TSE (403/429) em andamento.");
            if (circuitOpenUntil > now) return Skip(TseFetchStatus.Skipped, now, "Disjuntor aberto após falhas seguidas.");
            if (priority == TsePriority.Background && backgroundPausedUntil > now) return Skip(TseFetchStatus.Skipped, now, "Varredura de fundo pausada após 404 seguidos.");
        }
        if (state.NotFoundUntil > now) return Skip(TseFetchStatus.NotFound, now, "Arquivo ainda não publicado (404 recente).");
        if (state.BackoffUntil > now) return Skip(TseFetchStatus.Skipped, now, "Recuo após falha.");

        if (priority == TsePriority.Background) await background.WaitAsync(ct);
        await global.WaitAsync(ct);

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.AcceptEncoding.ParseAdd("gzip, br");
        if (conditional?.ETag is { Length: > 0 } etag && EntityTagHeaderValue.TryParse(etag, out var parsed))
            request.Headers.IfNoneMatch.Add(parsed);
        if (conditional?.LastModified is { Length: > 0 } lastModified && DateTimeOffset.TryParse(lastModified, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var since))
            request.Headers.IfModifiedSince = since;

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(options.RequestTimeout);
        var watch = Stopwatch.StartNew();
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            var status = (int)response.StatusCode;
            var receivedAt = time.GetUtcNow();
            var newEtag = response.Headers.ETag?.ToString() ?? conditional?.ETag;
            var newLastModified = response.Content.Headers.LastModified?.ToString("R") ?? conditional?.LastModified;
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    {
                        var body = await response.Content.ReadAsByteArrayAsync(timeout.Token);
                        Succeeded(state);
                        return Done(new TseFetchResult(TseFetchStatus.Ok, status, body, newEtag, newLastModified, watch.Elapsed, null, receivedAt), url);
                    }
                case HttpStatusCode.NotModified:
                    Succeeded(state);
                    return Done(new TseFetchResult(TseFetchStatus.NotModified, status, null, newEtag, newLastModified, watch.Elapsed, null, receivedAt), url);
                case HttpStatusCode.NotFound:
                    NotFound(state, receivedAt, url);
                    return Done(new TseFetchResult(TseFetchStatus.NotFound, status, null, null, null, watch.Elapsed, "404", receivedAt), url);
                case HttpStatusCode.Forbidden:
                case HttpStatusCode.TooManyRequests:
                    Block(receivedAt, status);
                    return Done(new TseFetchResult(TseFetchStatus.Blocked, status, null, null, null, watch.Elapsed, $"HTTP {status}", receivedAt), url);
                default:
                    Failed(state, receivedAt);
                    return Done(new TseFetchResult(TseFetchStatus.Failed, status, null, null, null, watch.Elapsed, $"HTTP {status}", receivedAt), url);
            }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or OperationCanceledException or IOException && !ct.IsCancellationRequested)
        {
            var at = time.GetUtcNow();
            Failed(state, at);
            return Done(new TseFetchResult(TseFetchStatus.Failed, 0, null, null, null, watch.Elapsed, e is OperationCanceledException ? "tempo esgotado" : e.GetType().Name, at), url);
        }
    }

    private TseFetchResult Skip(TseFetchStatus status, DateTimeOffset now, string reason) =>
        new(status, 0, null, null, null, TimeSpan.Zero, reason, now);

    private TseFetchResult Done(TseFetchResult result, Uri url)
    {
        metrics.Request(result.Status, result.HttpStatus, result.Duration);
        LogRequest(logger, "tse_request", url.AbsolutePath, result.HttpStatus, (long)result.Duration.TotalMilliseconds, result.ETag, result.Status.ToString());
        return result;
    }

    private void Succeeded(UrlState state)
    {
        state.Failures = 0;
        state.BackoffUntil = null;
        lock (gate)
        {
            consecutiveFailures = 0;
            circuitOpenUntil = null;
        }
    }

    private void NotFound(UrlState state, DateTimeOffset now, Uri url)
    {
        state.NotFoundUntil = now + options.NotFoundCooldown;
        recentNotFound.Enqueue(now);
        while (recentNotFound.TryPeek(out var first) && now - first > NotFoundWindow) recentNotFound.TryDequeue(out _);
        if (recentNotFound.Count < NotFoundBurst) return;
        lock (gate)
        {
            if (backgroundPausedUntil > now) return;
            backgroundPausedUntil = now + BackgroundPauseOnNotFound;
        }
        LogAlert(logger, "tse_404_burst", $"{recentNotFound.Count} respostas 404 em 5 min (última: {url.AbsolutePath}); varredura de fundo pausada por 10 min.");
    }

    private void Block(DateTimeOffset now, int status)
    {
        lock (gate) blockedUntil = now + options.BlockPause;
        LogAlert(logger, "tse_blocked", $"TSE respondeu HTTP {status}; todas as requisições pausadas por {options.BlockPause.TotalMinutes:0} min.");
    }

    private void Failed(UrlState state, DateTimeOffset now)
    {
        state.Failures++;
        var exponent = Math.Min(state.Failures - 1, 6);
        var delay = TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, exponent)));
        var jitter = TimeSpan.FromMilliseconds(Random.Shared.Next(0, (int)Math.Max(250, delay.TotalMilliseconds / 2)));
        state.BackoffUntil = now + delay + jitter;
        bool opened;
        lock (gate)
        {
            consecutiveFailures++;
            opened = consecutiveFailures >= CircuitThreshold && circuitOpenUntil is null;
            if (consecutiveFailures >= CircuitThreshold) circuitOpenUntil = now + CircuitOpen;
        }
        if (opened) LogAlert(logger, "tse_circuit_open", $"{CircuitThreshold} falhas seguidas no TSE; disjuntor aberto por {CircuitOpen.TotalSeconds:0} s.");
    }

    private sealed class UrlState
    {
        public int Failures;
        public DateTimeOffset? BackoffUntil;
        public DateTimeOffset? NotFoundUntil;
    }

    /// <summary>Ritmo uniforme (sem rajadas): cada requisição ocupa um intervalo de 1/N s.</summary>
    private sealed class Pacer(int perSecond, TimeProvider time)
    {
        private readonly long interval = TimeSpan.TicksPerSecond / Math.Max(1, perSecond);
        private long next;

        public async ValueTask WaitAsync(CancellationToken ct)
        {
            var now = time.GetUtcNow().UtcTicks;
            long slot;
            while (true)
            {
                var current = Interlocked.Read(ref next);
                slot = Math.Max(now, current);
                if (Interlocked.CompareExchange(ref next, slot + interval, current) == current) break;
            }
            var wait = slot - now;
            if (wait > 0) await Task.Delay(TimeSpan.FromTicks(wait), time, ct);
        }
    }

    [LoggerMessage(Level = LogLevel.Debug, Message = "{Event} {Path} status={Status} duration={DurationMs}ms etag={Etag} result={Result}")]
    private static partial void LogRequest(ILogger logger, string @event, string path, int status, long durationMs, string? etag, string result);

    [LoggerMessage(Level = LogLevel.Error, Message = "ALERTA apuração {Alert}: {Detail}")]
    private static partial void LogAlert(ILogger logger, string alert, string detail);
}
