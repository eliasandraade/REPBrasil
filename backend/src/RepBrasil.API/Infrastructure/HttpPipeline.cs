using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace RepBrasil.API.Infrastructure;

/// <summary>Peças pequenas do pipeline HTTP: cabeçalhos de segurança, log de requisição e comparação de segredo.</summary>
public static partial class HttpPipeline
{
    /// <summary>
    /// Cabeçalhos de segurança para uma API JSON. Aplicados no início da resposta (OnStarting), então também saem
    /// nas respostas de erro. O Swagger (quando ligado) precisa de scripts e estilos: fica fora da CSP restritiva.
    /// </summary>
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) =>
        app.Use(async (http, next) =>
        {
            http.Response.OnStarting(() =>
            {
                var h = http.Response.Headers;
                h.XContentTypeOptions = "nosniff";
                h.XFrameOptions = "DENY";
                h["Referrer-Policy"] = "no-referrer";
                h["Cross-Origin-Opener-Policy"] = "same-origin";
                if (!http.Request.Path.StartsWithSegments("/swagger"))
                    h.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
                return Task.CompletedTask;
            });
            await next(http);
        });

    /// <summary>
    /// Uma linha estruturada por requisição (método, rota-modelo, status, duração) e o cabeçalho Server-Timing.
    /// Rota-modelo e não caminho/consulta: nomes digitados na busca não vão para o log.
    /// </summary>
    public static IApplicationBuilder UseRequestTiming(this IApplicationBuilder app)
    {
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>().CreateLogger("RepBrasil.Http");
        return app.Use(async (http, next) =>
        {
            var started = Stopwatch.GetTimestamp();
            http.Response.OnStarting(() =>
            {
                var ms = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                http.Response.Headers["Server-Timing"] = string.Create(CultureInfo.InvariantCulture, $"app;dur={ms:0.0}");
                return Task.CompletedTask;
            });
            try
            {
                await next(http);
            }
            finally
            {
                var ms = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                if (!http.Request.Path.StartsWithSegments("/health"))
                    LogRequest(logger, http.Request.Method, ApiExceptionHandler.RouteOf(http), http.Response.StatusCode, Math.Round(ms, 1));
            }
        });
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "{Method} {Route} {Status} {ElapsedMs} ms")]
    private static partial void LogRequest(ILogger logger, string method, string route, int status, double elapsedMs);

    /// <summary>Comparação em tempo constante (não vaza, pelo tempo, quantos caracteres do segredo acertou).</summary>
    public static bool SecretEquals(string? provided, string? expected)
    {
        if (string.IsNullOrEmpty(provided) || string.IsNullOrEmpty(expected)) return false;
        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(provided)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
    }
}
