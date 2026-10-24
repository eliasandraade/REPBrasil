using RepBrasil.Application.LiveElection;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Hospeda a ingestão dentro da API. Liga só com ELECTION_LIVE_ENABLED=true. Com banco configurado, um advisory lock do
/// PostgreSQL garante um único poller entre réplicas; as demais réplicas recarregam o estado do banco quando o líder
/// avisa (NOTIFY) e servem as mesmas respostas. Falha numa sessão nunca derruba a API: a sessão recomeça com recuo.
/// </summary>
public sealed partial class LiveIngestionService(
    IServiceProvider services,
    LiveElectionOptions options,
    LiveElectionHub hub,
    LiveElectionRuntime runtime,
    TimeProvider time,
    ILogger<LiveIngestionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            LogDisabled(logger);
            return;
        }
        var failures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            using var session = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, runtime.RestartToken);
            try
            {
                await RunSessionAsync(session.Token);
                failures = 0;
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                LogRestart(logger);
                failures = 0;
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception e)
            {
                failures++;
                runtime.LastError = $"{time.GetUtcNow():O} {e.GetType().Name}: {e.Message}";
                var delay = TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, Math.Min(failures, 6))));
                // TSE bloqueou (403/429): nova sessão só depois do fim da pausa — tentar antes renova o bloqueio.
                if (runtime.HttpSource?.BlockedUntil is { } blocked && blocked > time.GetUtcNow())
                    delay = blocked - time.GetUtcNow() + TimeSpan.FromSeconds(Random.Shared.Next(5, 30));
                LogSessionFailed(logger, delay.TotalSeconds, e);
                try { await Task.Delay(delay, time, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
            finally
            {
                runtime.IsLeader = false;
            }
        }
    }

    private async Task RunSessionAsync(CancellationToken ct)
    {
        runtime.SessionStartedAt = time.GetUtcNow();
        var coordinator = runtime.Coordinator;
        var coordinated = coordinator is not null;
        if (coordinator is not null)
        {
            bool acquired;
            try
            {
                acquired = await coordinator.TryAcquireAsync(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // PostgreSQL fora do ar: a apuração não para. Esta réplica ingere sem coordenação (em memória) e volta a
                // disputar o lock quando o banco responder.
                LogUncoordinated(logger, e.GetType().Name);
                acquired = true;
                coordinated = false;
            }
            if (!acquired)
            {
                await RunFollowerAsync(coordinator, ct);
                return;
            }
        }
        runtime.IsLeader = true;
        var engine = LiveElectionRegistration.CreateEngine(services, runtime);
        if (coordinator is not null) engine.NotifyFollowers = payload => coordinator.NotifyAsync(payload, ct);
        await engine.InitializeAsync(ct);
        runtime.Engine = engine;
        LogLeader(logger, runtime.InstanceId, options.Mode);

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var token = linked.Token;
        var loops = new List<Task>
        {
            Loop("nacional", () => engine.NationalInterval(), engine.PollNationalAsync, token),
            Loop("ea14", engine.AccompanimentInterval, async c => { await engine.PollAccompanimentAsync(c); return true; }, token),
            Loop("ea15", StateSweepInterval, async c => { await engine.PollNextStateAccompanimentAsync(c); return true; }, token),
            Loop("avaliacao", () => TimeSpan.FromSeconds(1), async c => { await engine.EvaluateAsync(c); return true; }, token),
            engine.RunMunicipalWorkerAsync(token),
            FirstRoundAsync(engine, token),
        };
        if (coordinator is not null) loops.Add(coordinated ? WatchLeadershipAsync(coordinator, linked, token) : RegainCoordinationAsync(coordinator, linked, token));
        try
        {
            await Task.WhenAny(loops);
        }
        finally
        {
            await linked.CancelAsync();
            try { await Task.WhenAll(loops); }
            catch (OperationCanceledException) { /* encerramento normal */ }
            runtime.Engine = null;
        }
        ct.ThrowIfCancellationRequested();
        throw new InvalidOperationException("Um ciclo da ingestão terminou inesperadamente.");
    }

    /// <summary>Uma UF de EA15 por vez: a volta completa leva StateAccompanimentInterval.</summary>
    private TimeSpan StateSweepInterval()
    {
        var count = Math.Max(1, hub.Current?.Context.Ufs.Count() ?? 28);
        var interval = options.StateAccompanimentInterval / count;
        // Antes do início da totalização o EA15 não muda: volta lenta.
        if (hub.Current?.National?.Progress == "n") interval *= 4;
        return interval < TimeSpan.FromMilliseconds(250) ? TimeSpan.FromMilliseconds(250) : interval;
    }

    private async Task Loop(string name, Func<TimeSpan> interval, Func<CancellationToken, Task<bool>> work, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await work(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                LogLoopError(logger, name, e);
            }
            try { await Task.Delay(interval(), time, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task FirstRoundAsync(LiveIngestionEngine engine, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 10 && !ct.IsCancellationRequested; attempt++)
        {
            try
            {
                await engine.LoadFirstRoundAsync(ct);
                var s = hub.Current;
                if (s?.FirstRound?.National is not null && s.FirstRound.States.Count >= s.Context.Ufs.Count()) break;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogLoopError(logger, "1º turno", e);
            }
            await Task.Delay(TimeSpan.FromSeconds(30 * (attempt + 1)), time, ct);
        }
        await Task.Delay(Timeout.InfiniteTimeSpan, time, ct);
    }

    private async Task WatchLeadershipAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationTokenSource session, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(5), time, ct);
            if (!await coordinator.StillLeaderAsync(ct))
            {
                LogLostLeadership(logger);
                await session.CancelAsync();
                return;
            }
        }
    }

    /// <summary>Sem banco na partida: tenta o lock a cada 30 s; se outra réplica já é líder, esta reinicia como seguidora.</summary>
    private async Task RegainCoordinationAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationTokenSource session, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(30), time, ct);
            try
            {
                if (await coordinator.TryAcquireAsync(ct))
                {
                    await WatchLeadershipAsync(coordinator, session, ct);
                    return;
                }
                LogLostLeadership(logger);
                await session.CancelAsync();
                return;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogUncoordinated(logger, e.GetType().Name);
            }
        }
    }

    /// <summary>Réplica seguidora: descobre a eleição (EA11/EA12, duas leituras) e recarrega o estado do banco a cada aviso.</summary>
    private async Task RunFollowerAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationToken ct)
    {
        runtime.IsLeader = false;
        var engine = LiveElectionRegistration.CreateEngine(services, runtime);
        await engine.InitializeAsync(ct);
        var store = services.GetRequiredService<ILiveElectionStore>();
        var context = hub.Current!.Context;
        var electionId = await store.EnsureElectionAsync(context, ct);
        // Sem polling: o motor da seguidora só atende pedidos explícitos (município, zona, foto, 1º turno), com o mesmo
        // limite e cache; o que ela busca vai para o banco e o líder e as demais réplicas passam a ter.
        runtime.Engine = engine;
        var firstRound = FirstRoundAsync(engine, ct);
        LogFollower(logger, runtime.InstanceId);
        var signal = new SemaphoreSlim(0);
        using var listen = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var listener = coordinator.ListenAsync(_ => { signal.Release(); return Task.CompletedTask; }, listen.Token);
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await signal.WaitAsync(TimeSpan.FromSeconds(5), ct);
                while (signal.CurrentCount > 0) await signal.WaitAsync(ct);
                var before = hub.Current!;
                var stored = await store.LoadAsync(electionId, ct);
                var latest = hub.Current!;
                var next = LiveIngestionEngine.Rehydrate(LiveElectionState.Initial(context) with { FirstRound = latest.FirstRound, NationalAccompaniment = latest.NationalAccompaniment, StateAccompaniment = latest.StateAccompaniment }, stored);
                next = next with { Phase = LivePhases.Resolve(new PhaseInput(next.National, false, false, time.GetUtcNow(), context.TotalizationStartsAt)) };
                hub.Replace(next);
                if (next.NationalVersion != before.NationalVersion)
                    hub.Publish("national-update", hub.Envelope(next, LiveProjector.NationalUpdate(next)));
                if (next.StatesVersion != before.StatesVersion)
                    hub.Publish("state-update", hub.Envelope(next, LiveProjector.States(next)));
                // A cada volta tenta virar líder (o líder anterior pode ter caído).
                if (await coordinator.TryAcquireAsync(ct)) return;
            }
        }
        finally
        {
            runtime.Engine = null;
            await listen.CancelAsync();
            try { await listener; }
            catch (OperationCanceledException) { /* encerramento */ }
            try { await firstRound; }
            catch (OperationCanceledException) { /* encerramento */ }
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração ao vivo desligada (ELECTION_LIVE_ENABLED != true)")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração: réplica {Instance} é a líder da ingestão (modo {Mode})")]
    private static partial void LogLeader(ILogger logger, string instance, string mode);

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração: réplica {Instance} seguidora; estado carregado do banco a cada aviso do líder")]
    private static partial void LogFollower(ILogger logger, string instance);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Apuração: liderança perdida (conexão do advisory lock caiu); sessão reiniciada")]
    private static partial void LogLostLeadership(ILogger logger);

    [LoggerMessage(Level = LogLevel.Error, Message = "ALERTA apuração postgres: banco indisponível ({Error}); ingestão segue em memória, sem coordenação entre réplicas")]
    private static partial void LogUncoordinated(ILogger logger, string error);

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração: sessão reiniciada a pedido")]
    private static partial void LogRestart(ILogger logger);

    [LoggerMessage(Level = LogLevel.Error, Message = "Apuração: sessão falhou; nova tentativa em {DelaySeconds} s")]
    private static partial void LogSessionFailed(ILogger logger, double delaySeconds, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Apuração: falha no ciclo {Loop}")]
    private static partial void LogLoopError(ILogger logger, string loop, Exception exception);
}
