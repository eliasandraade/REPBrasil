using RepBrasil.Application.LiveElection;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Hospeda a ingestão dentro da API. Liga só com ELECTION_LIVE_ENABLED=true. Com banco configurado, um advisory lock do
/// PostgreSQL garante um único poller entre réplicas, e só a conexão desse lock grava. As demais réplicas leem do banco
/// só o que mudou (cursor) quando a líder avisa (NOTIFY) ou a cada FollowerSyncInterval, e servem as mesmas respostas.
/// Sem banco na partida, a réplica ingere em memória sem gravar; quando o banco volta, ela só grava depois de obter a
/// liderança, numa sessão nova que parte do estado do banco. Falha numa sessão nunca derruba a API: ela recomeça com recuo.
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
                runtime.Role = "idle";
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
        runtime.Role = coordinator is null ? "standalone" : coordinated ? "leader" : "uncoordinated";
        // Sem coordenação não há gravação: a trilha só recebe o que a líder (dona do lock) grava.
        var engine = LiveElectionRegistration.CreateEngine(services, runtime, persist: coordinator is null || coordinated);
        if (coordinator is not null && coordinated) engine.NotifyFollowers = payload => coordinator.NotifyAsync(payload, ct);
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
        // Vigia da liderança (coordenada) ou retomada da coordenação (sem banco na partida): quando terminam, é troca de
        // papel pedida pela coordenação, e a nova sessão começa já, sem o recuo de falha.
        var coordination = coordinator is null ? null : coordinated ? WatchLeadershipAsync(coordinator, token) : RegainCoordinationAsync(coordinator, token);
        if (coordination is not null) loops.Add(coordination);
        Task finished;
        try
        {
            finished = await Task.WhenAny(loops);
        }
        finally
        {
            await linked.CancelAsync();
            try { await Task.WhenAll(loops); }
            catch (OperationCanceledException) { /* encerramento normal */ }
            runtime.Engine = null;
        }
        ct.ThrowIfCancellationRequested();
        if (ReferenceEquals(finished, coordination) && coordination.IsCompletedSuccessfully) return;
        throw new InvalidOperationException("Um ciclo da ingestão terminou inesperadamente.");
    }

    /// <summary>Uma UF de EA15 por vez: a volta completa leva StateAccompanimentInterval.</summary>
    private TimeSpan StateSweepInterval()
    {
        var count = Math.Max(1, hub.Current is { } current ? LiveIngestionEngine.ElectionUfs(current).Count : 28);
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
                if (s?.FirstRound?.National is not null && s.FirstRound.States.Count >= LiveIngestionEngine.ElectionUfs(s).Count) break;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogLoopError(logger, "1º turno", e);
            }
            await Task.Delay(TimeSpan.FromSeconds(30 * (attempt + 1)), time, ct);
        }
        await Task.Delay(Timeout.InfiniteTimeSpan, time, ct);
    }

    /// <summary>Termina (sem cancelar nada: quem encerra a sessão é RunSessionAsync) quando a liderança se perde.</summary>
    private async Task WatchLeadershipAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(5), time, ct);
            if (!await coordinator.StillLeaderAsync(ct))
            {
                LogLostLeadership(logger);
                return;
            }
        }
    }

    /// <summary>
    /// Sem banco na partida: tenta o lock a cada 30 s. Conseguiu: a sessão reinicia como líder coordenada, que parte do
    /// estado do banco (e grava as transições que ainda não estão lá). Outra réplica já é líder: reinicia como
    /// seguidora. Nos dois casos esta sessão, que não gravou nada, é descartada.
    /// </summary>
    private async Task RegainCoordinationAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(30), time, ct);
            try
            {
                var acquired = await coordinator.TryAcquireAsync(ct);
                LogCoordinationRegained(logger, acquired ? "líder" : "seguidora");
                return;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogUncoordinated(logger, e.GetType().Name);
            }
        }
    }

    /// <summary>
    /// Réplica seguidora: descobre a eleição (EA11/EA12, duas leituras), carrega o estado do banco uma vez e depois lê
    /// só o que a líder gravou depois do cursor. Não consulta o TSE por conta própria (só pedidos explícitos de
    /// visitantes: município, zona, foto, 1º turno, com o mesmo limite e cache) e não grava nada.
    /// </summary>
    private async Task RunFollowerAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationToken ct)
    {
        runtime.IsLeader = false;
        runtime.Role = "follower";
        var engine = LiveElectionRegistration.CreateEngine(services, runtime, persist: false);
        await engine.InitializeAsync(ct);
        runtime.Engine = engine;
        LogFollower(logger, runtime.InstanceId);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var token = linked.Token;
        var loops = new List<Task>
        {
            FollowAsync(engine, coordinator, token),
            Loop("avaliacao", () => TimeSpan.FromSeconds(1), async c => { await engine.EvaluateAsync(c); return true; }, token),
            FirstRoundAsync(engine, token),
        };
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
        // FollowAsync só termina sozinho quando esta réplica obtém o lock: a próxima sessão é a da líder.
        ct.ThrowIfCancellationRequested();
    }

    private async Task FollowAsync(LiveIngestionEngine engine, RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, CancellationToken ct)
    {
        using var signal = new SemaphoreSlim(0);
        var listener = Task.CompletedTask;
        var failures = 0;
        while (!ct.IsCancellationRequested)
        {
            // LISTEN caiu (conexão perdida): volta a escutar; enquanto isso a leitura periódica cobre.
            if (listener.IsCompleted) listener = ListenAsync(coordinator, signal, ct);
            await signal.WaitAsync(options.FollowerSyncInterval, ct);
            while (signal.CurrentCount > 0) await signal.WaitAsync(ct);
            try
            {
                await engine.SyncFromStoreAsync(ct);
                failures = 0;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogLoopError(logger, "sincronização", e);
                // Banco fora: a seguidora não congela servindo dado velho. A sessão reinicia e, sem banco, ingere do TSE
                // sem gravar (como a líder), até o banco voltar e a coordenação ser refeita.
                if (++failures >= 3)
                {
                    LogFollowerDetached(logger);
                    return;
                }
                continue;
            }
            // A cada volta tenta virar líder (a líder anterior pode ter caído).
            try
            {
                if (await coordinator.TryAcquireAsync(ct)) return;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogLoopError(logger, "liderança", e);
            }
        }
    }

    private async Task ListenAsync(RepBrasil.Infrastructure.LiveElection.PgLiveCoordinator coordinator, SemaphoreSlim signal, CancellationToken ct)
    {
        try
        {
            await coordinator.ListenAsync(_ =>
            {
                signal.Release();
                return Task.CompletedTask;
            }, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            LogLoopError(logger, "listen", e);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração ao vivo desligada (ELECTION_LIVE_ENABLED != true)")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração: réplica {Instance} é a líder da ingestão (modo {Mode})")]
    private static partial void LogLeader(ILogger logger, string instance, string mode);

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração: réplica {Instance} seguidora; lê do banco só o que a líder gravou depois do último cursor")]
    private static partial void LogFollower(ILogger logger, string instance);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Apuração: banco de volta; sessão sem coordenação descartada, a réplica reinicia como {Role}")]
    private static partial void LogCoordinationRegained(ILogger logger, string role);

    [LoggerMessage(Level = LogLevel.Error, Message = "ALERTA apuração postgres: seguidora sem leitura do banco (3 falhas seguidas); sessão reiniciada para não servir dado congelado")]
    private static partial void LogFollowerDetached(ILogger logger);

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
