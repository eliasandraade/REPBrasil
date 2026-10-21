using System.Collections.Concurrent;

namespace RepBrasil.API.Infrastructure;

/// <summary>Métricas de uma rota desde o início do processo.</summary>
public sealed record RouteMetric(string Method, string Route, long Calls, long ClientErrors, long ServerErrors, double? P95Ms, DateTimeOffset? LastCallAt);

/// <summary>
/// Contadores HTTP por rota-modelo (nunca o caminho com valores digitados), em memória e desde o início do
/// processo: zeram a cada deploy e valem por réplica. A latência p95 sai das últimas 256 chamadas de cada rota.
/// </summary>
public sealed class RequestMetrics
{
    private const int Window = 256;
    private readonly ConcurrentDictionary<(string Method, string Route), RouteStats> routes = new();

    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;

    public void Record(string method, string route, int status, double elapsedMs) =>
        routes.GetOrAdd((method, route), _ => new RouteStats()).Record(status, elapsedMs);

    public IReadOnlyList<RouteMetric> Snapshot() =>
        [.. routes.Select(pair => pair.Value.Snapshot(pair.Key.Method, pair.Key.Route)).OrderByDescending(m => m.Calls)];

    private sealed class RouteStats
    {
        private readonly object gate = new();
        private readonly double[] latencies = new double[Window];
        private long calls;
        private long clientErrors;
        private long serverErrors;
        private int next;
        private DateTimeOffset? last;

        public void Record(int status, double elapsedMs)
        {
            lock (gate)
            {
                calls++;
                if (status >= 500) serverErrors++;
                else if (status >= 400) clientErrors++;
                latencies[next] = elapsedMs;
                next = (next + 1) % Window;
                last = DateTimeOffset.UtcNow;
            }
        }

        public RouteMetric Snapshot(string method, string route)
        {
            lock (gate)
            {
                var count = (int)Math.Min(calls, Window);
                double? p95 = null;
                if (count > 0)
                {
                    var sample = latencies.Take(count).Order().ToArray();
                    p95 = Math.Round(sample[(int)Math.Ceiling(0.95 * count) - 1], 1);
                }
                return new(method, route, calls, clientErrors, serverErrors, p95, last);
            }
        }
    }
}
