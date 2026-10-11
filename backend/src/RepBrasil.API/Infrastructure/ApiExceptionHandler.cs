using Microsoft.AspNetCore.Diagnostics;
using Npgsql;

namespace RepBrasil.API.Infrastructure;

/// <summary>
/// Erro não tratado → ProblemDetails (RFC 9457) com o id de rastreio, nunca a mensagem interna nem a pilha.
/// Banco indisponível de forma transitória vira 503 com Retry-After; cliente que desistiu não é erro do servidor.
/// </summary>
public sealed partial class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    /// <summary>Convenção (nginx) para "o cliente fechou a conexão": não conta como falha do servidor.</summary>
    public const int ClientClosedRequest = 499;

    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken ct)
    {
        if (exception is OperationCanceledException && http.RequestAborted.IsCancellationRequested)
        {
            http.Response.StatusCode = ClientClosedRequest;
            return true;
        }

        var transient = IsTransientDatabaseFailure(exception);
        var status = transient ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status500InternalServerError;
        LogUnhandled(logger, exception, http.Request.Method, RouteOf(http), status);

        http.Response.StatusCode = status;
        if (transient) http.Response.Headers.RetryAfter = "5";
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = http,
            Exception = exception,
            ProblemDetails =
            {
                Status = status,
                Title = transient ? "Serviço temporariamente indisponível" : "Erro interno",
                Detail = transient ? "A base de dados não respondeu a tempo. Tente de novo em instantes." : "Algo deu errado do nosso lado.",
            },
        });
    }

    /// <summary>Falha de conexão/tempo com o PostgreSQL (em qualquer nível da cadeia de exceções).</summary>
    public static bool IsTransientDatabaseFailure(Exception exception)
    {
        for (var e = exception; e is not null; e = e.InnerException)
            if (e is NpgsqlException { IsTransient: true } or TimeoutException) return true;
        return false;
    }

    /// <summary>Rota (modelo), não o caminho concreto: não leva para o log o que a pessoa digitou.</summary>
    public static string RouteOf(HttpContext http) =>
        (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(sem rota)";

    [LoggerMessage(Level = LogLevel.Error, Message = "Erro não tratado em {Method} {Route} → {Status}")]
    private static partial void LogUnhandled(ILogger logger, Exception exception, string method, string route, int status);
}
