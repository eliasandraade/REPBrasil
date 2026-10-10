using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace RepBrasil.API.Infrastructure;

/// <summary>
/// Limite técnico contra abuso (robôs, laços acidentais), por endereço IP de origem — NUNCA identidade comercial,
/// cota ou plano. Generoso: várias pessoas atrás do mesmo IP (NAT, operadora) não devem ser barradas por uso normal.
/// Configurável: RateLimit:PerMinute (geral) e RateLimit:HeavyPerMinute (consultas pesadas: mapa, comparação).
/// </summary>
public static class ApiRateLimits
{
    public const string Heavy = "heavy";

    public static IServiceCollection AddApiRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var perMinute = Math.Max(1, config.GetValue("RateLimit:PerMinute", 300));
        var heavyPerMinute = Math.Max(1, config.GetValue("RateLimit:HeavyPerMinute", 60));
        return services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
                http.Request.Path.StartsWithSegments("/health")
                    ? RateLimitPartition.GetNoLimiter("health")
                    : RateLimitPartition.GetTokenBucketLimiter(ClientKey(http), _ => Bucket(perMinute)));
            o.AddPolicy(Heavy, http => RateLimitPartition.GetTokenBucketLimiter(ClientKey(http), _ => Bucket(heavyPerMinute)));
            o.OnRejected = async (context, ct) =>
            {
                var http = context.HttpContext;
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                    http.Response.Headers.RetryAfter = ((int)Math.Ceiling(retry.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                var problems = http.RequestServices.GetRequiredService<IProblemDetailsService>();
                await problems.WriteAsync(new ProblemDetailsContext
                {
                    HttpContext = http,
                    ProblemDetails = new ProblemDetails
                    {
                        Status = StatusCodes.Status429TooManyRequests,
                        Title = "Muitas requisições",
                        Detail = "Aguarde alguns segundos e tente de novo.",
                    },
                });
            };
        });
    }

    /// <summary>IP de origem (após X-Forwarded-For do proxy confiável). Só particiona o limite técnico.</summary>
    private static string ClientKey(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static TokenBucketRateLimiterOptions Bucket(int perMinute) => new()
    {
        TokenLimit = perMinute,
        TokensPerPeriod = perMinute,
        ReplenishmentPeriod = TimeSpan.FromMinutes(1),
        QueueLimit = 0,
        AutoReplenishment = true,
    };
}
