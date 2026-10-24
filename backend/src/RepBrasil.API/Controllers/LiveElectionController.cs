using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RepBrasil.API.Infrastructure;
using RepBrasil.API.LiveElection;
using RepBrasil.Application.LiveElection;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Apuração ao vivo do 2º turno presidencial. Toda leitura sai do estado em memória (alimentado só pela ingestão do
/// servidor): visitantes nunca disparam requisição ao TSE, exceto o detalhe de um município/zona/1º turno municipal
/// pedido explicitamente, que passa pela mesma fila com limite e cache do servidor.
/// </summary>
[ApiController]
[Route("api/v1/elections/{year:int}/president/second-round")]
[Tags("Apuração ao vivo")]
[EnableRateLimiting(ApiRateLimits.Live)]
public sealed class LiveElectionController(LiveElectionHub hub, LiveElectionRuntime runtime, LiveElectionMetrics metrics, LiveElectionOptions options, TimeProvider time) : ControllerBase
{
    private static readonly HashSet<string> ProductEvents = new(StringComparer.Ordinal)
    {
        "election_page_view",
        "state_open",
        "municipality_search",
        "municipality_open",
        "timeline_open",
        "math_status_open",
        "first_round_comparison_open",
    };

    private bool TryState(int year, out LiveElectionState state)
    {
        state = hub.Current!;
        return options.Enabled && state is not null && year == state.Context.Year;
    }

    private IActionResult Unavailable(int year) =>
        !options.Enabled || year != options.Year
            ? NotFound(new { message = "Apuração ao vivo indisponível." })
            : StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Apuração ainda carregando a configuração oficial do TSE." });

    /// <summary>Resposta já serializada, com cache curto para CDN e ETag por versão do estado.</summary>
    private IActionResult Json(byte[] body, string etag, int maxAgeSeconds = 2)
    {
        var tag = $"\"{etag}\"";
        Response.Headers.CacheControl = $"public, max-age={maxAgeSeconds}, stale-while-revalidate={maxAgeSeconds}";
        Response.Headers.ETag = tag;
        if (Request.Headers.IfNoneMatch.Contains(tag)) return StatusCode(StatusCodes.Status304NotModified);
        return File(body, "application/json; charset=utf-8");
    }

    private static string Version(LiveElectionState s, string view) =>
        $"{view}-{s.NationalVersion}-{s.StatesVersion}-{s.Events.Count}-{s.Phase}-{s.Source.Stale}-{s.Municipalities.Count}";

    /// <summary>Resumo nacional: candidatos, totais, situação matemática, fonte, velocidade e marcos.</summary>
    [HttpGet("summary")]
    public IActionResult Summary(int year)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        // ETag sem a idade do dado (que muda a cada segundo): a meta é recalculada no corpo de cada resposta 200.
        Response.Headers["X-Snapshot-Version"] = s.NationalVersion.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Json(hub.EnvelopeRaw(s, hub.SummaryJson(s)), Version(s, "summary"));
    }

    [HttpGet("candidates")]
    public IActionResult Candidates(int year)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        return Json(hub.EnvelopeRaw(s, hub.CandidatesJson(s)), Version(s, "candidates"), 30);
    }

    /// <summary>UFs, exterior, regiões (somas absolutas), votos restantes por UF e resumo territorial.</summary>
    [HttpGet("states")]
    public IActionResult States(int year)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        return Json(hub.EnvelopeRaw(s, hub.StatesJson(s)), Version(s, "states"));
    }

    [HttpGet("states/{uf}")]
    public IActionResult State(int year, string uf)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        var code = uf.Trim().ToLowerInvariant();
        if (!Regions.UfNames.ContainsKey(code)) return NotFound(new { message = "UF desconhecida." });
        runtime.Engine?.DemandState(code);
        return Json(hub.Envelope(s, LiveProjector.StateDetail(s, code), LiveProjector.StateCoverage(s, code)), Version(s, $"state-{code}"));
    }

    [HttpGet("states/{uf}/municipalities")]
    public IActionResult Municipalities(int year, string uf)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        var code = uf.Trim().ToLowerInvariant();
        if (!Regions.UfNames.ContainsKey(code)) return NotFound(new { message = "UF desconhecida." });
        runtime.Engine?.DemandState(code);
        var payload = LiveProjector.MunicipalityList(s, code);
        return Json(hub.Envelope(s, payload, payload.CoveragePct >= 100 ? LiveProjector.Coverage_Complete : LiveProjector.Coverage_Partial), Version(s, $"mun-{code}"), 5);
    }

    [HttpGet("municipalities/{code:regex(^\\d{{5}}$)}")]
    public async Task<IActionResult> Municipality(int year, string code, CancellationToken ct)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        if (!s.Context.TryMunicipality(code, out var uf, out _)) return NotFound(new { message = "Município não encontrado no EA12." });
        if (runtime.Engine is { } engine)
        {
            await engine.EnsureMunicipalityAsync(code, ct);
            await engine.EnsureFirstRoundMunicipalityAsync(code, ct);
            s = hub.Current!;
        }
        var detail = LiveProjector.MunicipalityDetail(s, code)!;
        return Json(hub.Envelope(s, detail, LiveProjector.MunicipalityCoverage(s, uf, code)), Version(s, $"mu-{code}-{s.Municipalities.GetValueOrDefault(code)?.ContentHash}"), 5);
    }

    [HttpGet("municipalities/{code:regex(^\\d{{5}}$)}/zones")]
    public async Task<IActionResult> Zones(int year, string code, CancellationToken ct)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        if (!s.Context.TryMunicipality(code, out _, out _)) return NotFound(new { message = "Município não encontrado no EA12." });
        if (runtime.Engine is { } engine)
        {
            await engine.EnsureZonesAsync(code, ct);
            s = hub.Current!;
        }
        return Json(hub.Envelope(s, LiveProjector.Zones(s, code)!), Version(s, $"zones-{code}-{s.Zones.Count}"), 10);
    }

    [HttpGet("capitals")]
    public IActionResult Capitals(int year)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        var payload = LiveProjector.Capitals(s);
        return Json(hub.Envelope(s, payload, payload.CoveragePct >= 100 ? LiveProjector.Coverage_Complete : LiveProjector.Coverage_Partial), Version(s, "capitals"), 5);
    }

    [HttpGet("largest-municipalities")]
    public IActionResult Largest(int year, [FromQuery] int limit = 20)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        var effective = limit switch { <= 20 => 20, <= 50 => 50, _ => 100 };
        var payload = LiveProjector.Largest(s, effective);
        return Json(hub.Envelope(s, payload, payload.CoveragePct >= 100 ? LiveProjector.Coverage_Complete : LiveProjector.Coverage_Partial), Version(s, $"largest-{effective}"), 5);
    }

    [HttpGet("timeline")]
    public IActionResult Timeline(int year, [FromQuery] string scope = "br", [FromQuery] string? code = null)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        if (scope == "uf")
        {
            var uf = (code ?? "").Trim().ToLowerInvariant();
            if (!Regions.UfNames.ContainsKey(uf)) return BadRequest(new { message = "UF inválida." });
            return Json(hub.Envelope(s, LiveProjector.Timeline(s, "uf", uf)), Version(s, $"timeline-{uf}"), 5);
        }
        return Json(hub.EnvelopeRaw(s, hub.NationalTimelineJson(s)), Version(s, "timeline"), 5);
    }

    [HttpGet("mathematical-status")]
    public IActionResult MathematicalStatus(int year)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        return Json(hub.Envelope(s, LiveProjector.MathPublic(s)), Version(s, "math"));
    }

    [HttpGet("comparison/first-round")]
    public async Task<IActionResult> FirstRound(int year, [FromQuery] string scope = "br", [FromQuery] string? code = null, CancellationToken ct = default)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        var normalizedScope = scope.Trim().ToLowerInvariant();
        var normalizedCode = normalizedScope switch
        {
            "br" => "br",
            "uf" => (code ?? "").Trim().ToLowerInvariant(),
            "region" => (code ?? "").Trim().ToUpperInvariant(),
            "mu" => (code ?? "").Trim(),
            _ => null,
        };
        if (normalizedCode is null) return BadRequest(new { message = "Abrangência inválida." });
        if (normalizedScope == "mu")
        {
            if (!s.Context.TryMunicipality(normalizedCode, out _, out _)) return NotFound(new { message = "Município não encontrado no EA12." });
            if (runtime.Engine is { } engine)
            {
                await engine.EnsureFirstRoundMunicipalityAsync(normalizedCode, ct);
                await engine.EnsureMunicipalityAsync(normalizedCode, ct);
                s = hub.Current!;
            }
        }
        var comparison = LiveProjector.Comparison(s, normalizedScope, normalizedCode);
        if (comparison is null) return NotFound(new { message = "Comparação indisponível para esta abrangência." });
        return Json(hub.Envelope(s, comparison), Version(s, $"r1-{normalizedScope}-{normalizedCode}-{s.FirstRound?.States.Count}"), 10);
    }

    /// <summary>Saúde pública e sem dados sensíveis.</summary>
    [HttpGet("health")]
    public IActionResult Health(int year)
    {
        if (!TryState(year, out var s)) return Unavailable(year);
        Response.Headers.CacheControl = "no-store";
        // tseRequests: total de requisições desta réplica ao TSE (inclui 304) — não cresce com o número de visitantes.
        return Ok(LiveProjector.Health(s, time.GetUtcNow(), metrics.TseRequests));
    }

    /// <summary>Foto oficial (cópia do diretório "fotos" do TSE, baixada uma vez). Só candidatos desta eleição.</summary>
    [HttpGet("photos/{sqcand:regex(^\\d{{1,20}}$)}")]
    public async Task<IActionResult> Photo(int year, string sqcand, CancellationToken ct)
    {
        if (!TryState(year, out _)) return Unavailable(year);
        var photo = runtime.Engine is { } engine ? await engine.PhotoAsync(sqcand, ct) : null;
        if (photo is null) return NotFound();
        Response.Headers.CacheControl = "public, max-age=86400, immutable";
        return File(photo.Value.Content, photo.Value.Type);
    }

    /// <summary>Evento anônimo de produto (sem identificador do visitante, sem preferência eleitoral).</summary>
    [HttpPost("events")]
    public async Task<IActionResult> ProductEvent(int year, CancellationToken ct)
    {
        if (!options.Enabled || year != options.Year) return NotFound();
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var buffer = new char[256];
        var read = await reader.ReadBlockAsync(buffer.AsMemory(), ct);
        try
        {
            using var doc = JsonDocument.Parse(new string(buffer, 0, read));
            if (doc.RootElement.TryGetProperty("event", out var e) && e.GetString() is { } name && ProductEvents.Contains(name))
                metrics.ProductEvent(name);
        }
        catch (JsonException)
        {
            // corpo inválido: ignorado
        }
        return NoContent();
    }

    /// <summary>
    /// Server-Sent Events. Na conexão (e em toda reconexão sem Last-Event-ID válido) vem um "snapshot" completo; depois,
    /// national-update, state-update, candidate-update, lead-change, mathematically-defined, finalized, source-stale,
    /// source-recovered e timeline-event, cada um com id. Comentários a cada 15 s mantêm a conexão viva.
    /// </summary>
    [HttpGet("stream")]
    [EnableRateLimiting(ApiRateLimits.LiveStream)]
    public async Task Stream(int year, CancellationToken ct)
    {
        if (!TryState(year, out var s))
        {
            Response.StatusCode = options.Enabled && year == options.Year ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status404NotFound;
            return;
        }
        var origin = LiveClientKey.For(HttpContext.Connection.RemoteIpAddress);
        var lastEventId = Request.Headers["Last-Event-ID"].FirstOrDefault() ?? Request.Query["lastEventId"].FirstOrDefault();
        var subscription = hub.Subscribe(origin, lastEventId);
        if (subscription is null)
        {
            Response.StatusCode = StatusCodes.Status429TooManyRequests;
            Response.Headers.RetryAfter = "10";
            return;
        }
        try
        {
            Response.StatusCode = StatusCodes.Status200OK;
            Response.ContentType = "text/event-stream; charset=utf-8";
            Response.Headers.CacheControl = "no-cache, no-transform";
            Response.Headers["X-Accel-Buffering"] = "no";
            HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
            await Response.Body.WriteAsync("retry: 3000\n\n"u8.ToArray(), ct);
            if (subscription.NeedsSnapshot)
                await Response.Body.WriteAsync(hub.Frame("snapshot", hub.EnvelopeRaw(s, hub.SummaryJson(s))), ct);
            foreach (var frame in subscription.Replay) await Response.Body.WriteAsync(frame, ct);
            await Response.Body.FlushAsync(ct);

            var reader = subscription.Subscriber.Channel.Reader;
            var heartbeat = options.SseHeartbeat;
            while (!ct.IsCancellationRequested)
            {
                using var wait = CancellationTokenSource.CreateLinkedTokenSource(ct);
                wait.CancelAfter(heartbeat);
                try
                {
                    if (!await reader.WaitToReadAsync(wait.Token)) break;
                    while (reader.TryRead(out var frame)) await Response.Body.WriteAsync(frame, ct);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    await Response.Body.WriteAsync(": hb\n\n"u8.ToArray(), ct);
                }
                await Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
            // visitante saiu
        }
        catch (IOException)
        {
            // conexão caiu
        }
        finally
        {
            hub.Unsubscribe(subscription.Subscriber);
        }
    }
}
