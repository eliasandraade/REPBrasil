using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace RepBrasil.API.Infrastructure;

/// <summary>
/// Limite técnico contra abuso (robôs, laços acidentais), por endereço IP de origem — NUNCA identidade comercial,
/// cota ou plano. Generoso: várias pessoas atrás do mesmo IP (NAT, operadora) não devem ser barradas por uso normal.
/// Configurável: RateLimit:PerMinute (geral) e RateLimit:HeavyPerMinute (consultas pesadas: mapa, comparação).
/// O servidor do próprio site (metadados e sitemap renderizados no servidor) pode se identificar com
/// RateLimit:InternalToken no cabeçalho X-Internal-Token: um robô de busca não esgota o limite do site inteiro.
/// </summary>
public static class ApiRateLimits
{
    public const string Heavy = "heavy";
    public const string Support = "support";

    /// <summary>Apuração ao vivo: leitura barata (estado em memória) e pico de acesso; teto próprio por IP, mais alto.</summary>
    public const string Live = "live";
    public const string InternalTokenHeader = "X-Internal-Token";

    public static IServiceCollection AddApiRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var perMinute = Math.Max(1, config.GetValue("RateLimit:PerMinute", 300));
        var heavyPerMinute = Math.Max(1, config.GetValue("RateLimit:HeavyPerMinute", 60));
        var supportPerHour = Math.Max(1, config.GetValue("RateLimit:SupportPerHour", 6));
        // Alto de propósito: muitos visitantes atrás do mesmo IP (CGNAT das operadoras móveis); a leitura é em memória.
        var livePerMinute = Math.Max(1, config.GetValue("RateLimit:LivePerMinute", 6000));
        var internalToken = config["RateLimit:InternalToken"];
        bool Internal(HttpContext http) =>
            !string.IsNullOrEmpty(internalToken) && HttpPipeline.SecretEquals(http.Request.Headers[InternalTokenHeader], internalToken);
        return services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
                http.Request.Path.StartsWithSegments("/health") || Internal(http) || IsLive(http)
                    ? RateLimitPartition.GetNoLimiter("exempt")
                    : RateLimitPartition.GetTokenBucketLimiter(ClientKey(http), _ => Bucket(perMinute)));
            o.AddPolicy(Heavy, http => Internal(http)
                ? RateLimitPartition.GetNoLimiter("exempt")
                : RateLimitPartition.GetTokenBucketLimiter(ClientKey(http), _ => Bucket(heavyPerMinute)));
            o.AddPolicy(Live, http => Internal(http)
                ? RateLimitPartition.GetNoLimiter("exempt")
                : RateLimitPartition.GetTokenBucketLimiter(ClientKey(http), _ => Bucket(livePerMinute)));
            // Formulário de suporte: poucos envios por origem e por hora, contra robôs (RateLimit:SupportPerHour).
            o.AddPolicy(Support, http => RateLimitPartition.GetFixedWindowLimiter(ClientKey(http), _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = supportPerHour,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0,
            }));
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

    /// <summary>Rotas da apuração ao vivo: saem do limite global e ficam só com a política <see cref="Live"/> (e o stream SSE,
    /// uma conexão longa por visitante, com o limite de conexões por IP do próprio hub).</summary>
    private static bool IsLive(HttpContext http) =>
        http.Request.Path.StartsWithSegments("/api/v1/elections", out var rest) &&
        rest.Value?.Contains("/president/second-round", StringComparison.Ordinal) == true;

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
