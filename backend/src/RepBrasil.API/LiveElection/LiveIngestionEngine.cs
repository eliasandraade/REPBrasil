using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Threading.Channels;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Motor de ingestão hierárquica (só roda na réplica líder):
/// 1. EA11 → descobre a eleição; EA12 → municípios, capitais, zonas;
/// 2. EA20 nacional em ciclo curto (padrão 1 s durante a totalização; 15 s fora dela), com GET condicional;
/// 3. EA14 (padrão 3 s) → só busca o EA20 da UF cujo dt/ht ou seções mudaram;
/// 4. EA15 por UF em rodízio (padrão 30 s por volta) → só busca EA20 de município cujo dt/ht mudou, em ordem de
///    prioridade (pedido de visitante, capitais, maiores eleitorados, demais);
/// 5. zonas e municípios sob demanda.
/// O TSE é a origem; o REPBrasil normaliza, guarda, calcula estatística descritiva e distribui.
/// </summary>
public sealed partial class LiveIngestionEngine
{
    private readonly ITseSource source;
    private readonly ILiveElectionStore? store;
    private readonly LiveElectionHub hub;
    private readonly LiveElectionOptions options;
    private readonly LiveElectionMetrics metrics;
    private readonly TimeProvider time;
    private readonly ILogger logger;
    private readonly ConcurrentDictionary<string, TseConditional> conditionals = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, DateTimeOffset> demand = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Lazy<Task<bool>>> inflight = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> queued = new(StringComparer.Ordinal);
    private readonly Channel<string> priorityQueue = Channel.CreateUnbounded<string>();
    private readonly Channel<string> backgroundQueue = Channel.CreateUnbounded<string>();
    private readonly ConcurrentDictionary<string, (byte[] Content, string Type)> photos = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim processing = new(1, 1);
    private readonly ConcurrentQueue<string> alerts = new();
    private TsePathBuilder? paths;
    private int electionId;
    private int nextUfIndex;
    private long localEventId;
    private DateTimeOffset lastStoreAlert = DateTimeOffset.MinValue;
    private LiveCursor cursor = LiveCursor.Start;
    private SourceHealth? persistedHealth;
    private DateTimeOffset persistedHealthAt = DateTimeOffset.MinValue;
    private bool leadershipAlerted;

    /// <summary>Linhas por página na carga inicial e na sincronização das seguidoras.</summary>
    public const int LoadBatch = 2000;

    /// <summary>Sem mudança relevante, a saúde da fonte é regravada no máximo nesse intervalo (seguidoras exibem a mesma).</summary>
    private static readonly TimeSpan HealthEvery = TimeSpan.FromSeconds(5);

    public LiveIngestionEngine(
        ITseSource source,
        ILiveElectionStore? store,
        LiveElectionHub hub,
        LiveElectionOptions options,
        LiveElectionMetrics metrics,
        TimeProvider time,
        ILogger logger)
    {
        this.source = source;
        this.store = store;
        this.hub = hub;
        this.options = options;
        this.metrics = metrics;
        this.time = time;
        this.logger = logger;
    }

    /// <summary>Chamado depois de cada mudança persistida (avisa réplicas seguidoras).</summary>
    public Func<string, Task>? NotifyFollowers { get; set; }

    /// <summary>
    /// Só a líder coordenada grava. Seguidoras e réplicas sem coordenação (banco fora na partida) leem do banco quando
    /// possível e servem do que têm em memória, mas nunca escrevem: duas réplicas não gravam a mesma transição.
    /// </summary>
    public bool Persist { get; init; } = true;

    /// <summary>Posição da leitura incremental do banco (carga inicial e sincronização das seguidoras).</summary>
    public LiveCursor Cursor => cursor;

    /// <summary>Última sincronização incremental (seguidoras): linhas lidas, duração e instante.</summary>
    public (int Rows, double Milliseconds, DateTimeOffset At)? LastSync { get; private set; }

    public bool Initialized => paths is not null && hub.Current is not null;

    public bool StoreHealthy { get; private set; } = true;

    public IReadOnlyCollection<string> RecentAlerts => [.. alerts];

    public TsePathBuilder? Paths => paths;

    public ITseSource Source => source;

    /// <summary>Nome do ambiente da sessão de replay (cada reinício do replay tem o seu).</summary>
    public string? ReplayEnvironment { get; set; }

    private TseEnvironment ResolveEnvironment() =>
        options.Mode == LiveModes.Replay ? TseEnvironment.Replay(options.Cycle, ReplayEnvironment ?? "replay") : EnvironmentFor(options);

    public static TseEnvironment EnvironmentFor(LiveElectionOptions options) => options.Mode switch
    {
        LiveModes.Simulation => TseEnvironment.Simulation(options.SimulationEnvironment, options.Cycle),
        LiveModes.Replay => TseEnvironment.Replay(options.Cycle),
        _ => TseEnvironment.Official(options.Cycle),
    };

    private int? ExpectedElectionCode => options.Mode switch
    {
        LiveModes.Simulation => options.SimulationExpectedElectionCode,
        LiveModes.Official => options.ExpectedElectionCode,
        _ => null,
    };

    private char ExpectedPhase => options.Mode == LiveModes.Official ? 'o' : 's';

    // ================================================================ inicialização

    public async Task InitializeAsync(CancellationToken ct)
    {
        var environment = ResolveEnvironment();
        var bootstrap = new TsePathBuilder(environment);
        var ea11Url = bootstrap.ElectionConfig();
        var ea11Response = await source.FetchAsync(ea11Url, null, TsePriority.Critical, ct);
        if (ea11Response.Status != TseFetchStatus.Ok || ea11Response.Body is null)
            throw new InvalidOperationException($"EA11 indisponível ({ea11Response.Status}, HTTP {ea11Response.HttpStatus}).");
        var ea11 = TseParser.ParseEa11(ea11Response.Body);
        if (options.Mode != LiveModes.Replay && ea11.Phase != ExpectedPhase)
            throw new TseContractException($"EA11 com fase '{ea11.Phase}' no modo {options.Mode}.");

        var discovered = ElectionDiscovery.Discover(ea11, options.Cycle, options.Round, options.OfficeCode, ExpectedElectionCode, options.Mode == LiveModes.Official ? options.ExpectedPleitoCode : null);
        if (options.Mode == LiveModes.Official && options.ExpectedFirstRoundElectionCode is { } r1 && discovered.FirstRoundElectionCode is { } found && r1 != found)
            discovered = discovered with { Warnings = [.. discovered.Warnings, $"1º turno descoberto no EA11 ({found}) difere do esperado ({r1}); vale o EA11."] };
        var builder = new TsePathBuilder(environment, ea11.DirectoryTemplates);

        var ea12Response = await source.FetchAsync(builder.MunicipalityConfig(discovered.ElectionCode), null, TsePriority.Critical, ct);
        Ea12Config? ea12 = ea12Response is { Status: TseFetchStatus.Ok, Body: not null } ? TseParser.ParseEa12(ea12Response.Body) : null;
        if (ea12 is null) Alert("ea12_unavailable", $"EA12 indisponível ({ea12Response.Status}); municípios e capitais ficam sem catálogo até a próxima tentativa.");

        DateTimeOffset? startsAt = discovered.Date is { } date
            ? new DateTimeOffset(date.ToDateTime(options.TotalizationStartLocal), TseValues.BrasiliaOffset)
            : null;
        var context = new LiveElectionContext(options.Mode, environment, discovered, options.Year, startsAt, ea12);
        var state = LiveElectionState.Initial(context);
        // Sessão anterior deste processo (reinício de sessão, troca de papel, queda do banco, novo replay).
        var before = hub.Current;
        var previous = before is not null && SameElection(before.Context, context) ? before : null;
        var loaded = false;

        if (store is not null)
        {
            try
            {
                // A líder registra a eleição; quem não grava só procura (a seguidora espera a líder registrar).
                var id = Persist ? await store.EnsureElectionAsync(context, ct) : await store.FindElectionAsync(context, ct);
                StoreHealthy = true;
                if (id is { } registered)
                {
                    electionId = registered;
                    state = await LoadAllAsync(state, ct);
                    loaded = true;
                    foreach (var (url, conditional) in await store.LoadConditionalsAsync(electionId, ct)) conditionals[url] = conditional;
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                StoreFailed(e, "carga inicial");
            }
        }
        // Sem o banco, a sessão continua do que este processo já servia (nunca recomeça vazia nem volta a versão).
        if (!loaded && previous is not null) state = previous with { Context = context };

        paths = builder;
        hub.Replace(state with { Phase = Phase(state) });
        // Líder depois de um período sem banco: o arquivo nacional mais novo visto em memória vai primeiro para o banco,
        // comparado com o último gravado — as transições do período (md=e, marcos, final) são detectadas e gravadas.
        if (Persist && loaded && previous?.National is { } seen && IsLaterNational(seen, state.National))
            await ApplyNationalAsync(seen, null, ct);
        if (before is not null && hub.Current is { } served && (previous is null || served.NationalVersion < before.NationalVersion)) StartEpoch(served);
        foreach (var warning in discovered.Warnings)
        {
            Alert("discovery_warning", warning);
            await RecordEventAsync(new LiveEvent(0, LiveEventTypes.DiscoveryWarning, "internal", $"discovery-{StableHash(warning)}", "br", "br", null, time.GetUtcNow(), "Divergência entre configuração e EA11", warning, null, new Dictionary<string, object?>()), null, ct);
        }
        LogDiscovered(logger, discovered.ElectionCode, discovered.PleitoCode, discovered.FirstRoundElectionCode, options.Mode, environment.Environment);
    }

    private static bool SameElection(LiveElectionContext a, LiveElectionContext b) =>
        a.Mode == b.Mode && a.Environment.Environment == b.Environment.Environment && a.Election.ElectionCode == b.Election.ElectionCode && a.Election.OfficeCode == b.Election.OfficeCode;

    private static bool IsLaterNational(TerritorySnapshot seen, TerritorySnapshot? stored) =>
        stored is null || (seen.ContentHash != stored.ContentHash && (seen.GeneratedAt ?? seen.IngestedAt) >= (stored.GeneratedAt ?? stored.IngestedAt) && seen.IngestedAt > stored.IngestedAt);

    /// <summary>A versão servida ficaria abaixo da que os clientes têm: nova época + snapshot completo para todos.</summary>
    private void StartEpoch(LiveElectionState served)
    {
        hub.NewEpoch();
        Publish(served, "snapshot", LiveProjector.Summary(served));
        Publish(served, "state-update", LiveProjector.States(served));
    }

    /// <summary>Carga inicial em páginas, do começo do histórico (partida, deploy, promoção de seguidora a líder).</summary>
    private async Task<LiveElectionState> LoadAllAsync(LiveElectionState state, CancellationToken ct)
    {
        while (true)
        {
            var changes = await store!.LoadChangesAsync(electionId, cursor, LoadBatch, ct);
            // A saúde da fonte gravada antes do reinício não vale para a líder: ela mede a própria.
            state = Apply(state, changes, adoptSourceHealth: !Persist).State;
            cursor = changes.Cursor;
            if (!changes.More) return state;
        }
    }

    /// <summary>
    /// Réplica seguidora: aplica só o que a líder gravou depois do cursor (snapshots nacionais e de UF novos, eventos
    /// novos, municípios/zonas e arquivos de acompanhamento alterados, saúde da fonte) e publica no SSE os mesmos
    /// eventos que a líder publica. O custo depende do que mudou, nunca do tamanho do histórico.
    /// </summary>
    public async Task<int> SyncFromStoreAsync(CancellationToken ct)
    {
        var current = hub.Current;
        if (store is null || current is null) return 0;
        if (electionId <= 0)
        {
            if (await store.FindElectionAsync(current.Context, ct) is not { } id) return 0;
            electionId = id;
        }
        var started = time.GetTimestamp();
        var rows = 0;
        while (!ct.IsCancellationRequested)
        {
            var changes = await store.LoadChangesAsync(electionId, cursor, LoadBatch, ct);
            rows += changes.Rows;
            if (changes.Rows > 0) ApplyAndPublish(changes);
            cursor = changes.Cursor;
            if (!changes.More) break;
        }
        StoreHealthy = true;
        LastSync = (rows, time.GetElapsedTime(started).TotalMilliseconds, time.GetUtcNow());
        return rows;
    }

    private void ApplyAndPublish(StoredChanges changes)
    {
        var before = hub.Current!;
        AppliedChanges? applied = null;
        var next = hub.Update(s =>
        {
            applied = Apply(s, changes, adoptSourceHealth: true);
            return applied.State with { Phase = Phase(applied.State) };
        });
        if (applied is not { } result) return; // Update sempre executa a função; aqui só para o compilador
        var now = time.GetUtcNow();
        if (before.Source.Failing != next.Source.Failing)
            Publish(next, next.Source.Failing ? "source-stale" : "source-recovered", LiveProjector.Source(next, now));
        if (result.NationalChanged || next.Phase != before.Phase || before.Source.Failing != next.Source.Failing)
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
        if (result.ProfilesChanged) Publish(next, "candidate-update", new CandidatesPayloadDto(LiveProjector.Candidates(next)));
        // EA14 novo muda votos restantes e cobertura por UF; EA15 sozinho não muda o payload das UFs.
        if (result.StatesChanged || result.NationalAccompanimentChanged) Publish(next, "state-update", LiveProjector.States(next));
        PublishTransitions(next, result.NewEvents, result.NewLeadChanges);
    }

    /// <summary>Resultado de <see cref="Apply"/>: o estado novo e o que mudou (para publicar só o necessário).</summary>
    public sealed record AppliedChanges(
        LiveElectionState State,
        bool NationalChanged,
        bool StatesChanged,
        bool NationalAccompanimentChanged,
        bool ProfilesChanged,
        IReadOnlyList<LiveEvent> NewEvents,
        IReadOnlyList<LeadChangeRecord> NewLeadChanges);

    /// <summary>
    /// Aplica linhas gravadas (em ordem de gravação) sobre o estado: a mesma função faz a carga inicial (do zero) e a
    /// sincronização incremental. Idempotente: snapshot e evento já aplicados (id menor ou igual) são ignorados.
    /// </summary>
    public static AppliedChanges Apply(LiveElectionState state, StoredChanges changes, bool adoptSourceHealth)
    {
        var national = state.National;
        var version = state.NationalVersion;
        var lastLeader = state.LastLeaderKey;
        var timeline = state.Timeline.ToBuilder();
        var states = state.States.ToBuilder();
        var stateTimelines = state.StateTimelines.ToBuilder();
        var statesVersion = state.StatesVersion;
        bool nationalChanged = false, statesChanged = false;
        foreach (var (id, snapshot) in changes.Snapshots)
        {
            if (snapshot.Key.Scope == TerritoryScope.Br)
            {
                if (id <= version) continue;
                national = snapshot;
                version = id;
                nationalChanged = true;
                timeline.Add(TimelinePoint.From(id, snapshot));
                lastLeader = snapshot.LeaderKey ?? lastLeader;
            }
            else if (snapshot.Key.Scope == TerritoryScope.Uf)
            {
                var uf = snapshot.Key.Code;
                var points = stateTimelines.GetValueOrDefault(uf) ?? [];
                if (points.Count > 0 && points[^1].Version >= id) continue;
                states[uf] = snapshot;
                stateTimelines[uf] = points.Add(TimelinePoint.From(id, snapshot));
                // Maior id de snapshot de UF: muda a cada snapshot novo (as seguidoras publicam state-update por ela).
                statesVersion = Math.Max(statesVersion, id);
                statesChanged = true;
            }
        }

        var municipalities = state.Municipalities.ToBuilder();
        var zones = state.Zones.ToBuilder();
        foreach (var t in changes.Territories)
        {
            var target = t.Key.Scope switch
            {
                TerritoryScope.Mu => municipalities,
                TerritoryScope.Zona => zones,
                _ => null,
            };
            // Uma seguidora pode ter buscado sob demanda um resultado mais novo que o gravado pela líder.
            if (target is not null && (!target.TryGetValue(t.Key.Code, out var have) || IsNewer(t, have))) target[t.Key.Code] = t;
        }

        var nationalAccompaniment = state.NationalAccompaniment;
        var stateAccompaniment = state.StateAccompaniment.ToBuilder();
        foreach (var (scope, file) in changes.Accompaniments)
        {
            if (scope == "br") nationalAccompaniment = file;
            else stateAccompaniment[scope] = file;
        }

        var maxEventId = state.Events.Count == 0 ? 0 : state.Events.Max(e => e.Id);
        var events = state.Events.ToBuilder();
        var leadChanges = state.LeadChanges.ToBuilder();
        var math = state.Math;
        var newEvents = new List<LiveEvent>();
        var newLeadChanges = new List<LeadChangeRecord>();
        foreach (var (e, snapshotId) in changes.Events)
        {
            if (e.Id <= maxEventId) continue;
            events.Add(e);
            newEvents.Add(e);
            switch (e.Type)
            {
                case LiveEventTypes.MathThreshold:
                    math = math with { RepBrasilDetectedAt = math.RepBrasilDetectedAt ?? e.DetectedAt };
                    break;
                case LiveEventTypes.MathematicallyDefined:
                    var leader = e.Payload.GetValueOrDefault("leaderKey")?.ToString();
                    math = math with
                    {
                        TseDefinedAt = e.At,
                        TseSignalDetectedAt = e.DetectedAt,
                        RepBrasilDetectedAt = math.RepBrasilDetectedAt ?? PayloadTime(e, "repBrasilMathDetectedAt"),
                        Defined = leader is null ? null : DefinedFrom(e, leader, FindPoint(timeline, snapshotId)),
                    };
                    break;
                case LiveEventTypes.LeadChange when e.Payload.GetValueOrDefault("newLeaderKey")?.ToString() is { } newLeader:
                    var snapshotVersion = PayloadLong(e, "snapshotVersion") ?? snapshotId ?? 0;
                    var record = new LeadChangeRecord(
                        e.Id,
                        e.At,
                        e.DetectedAt,
                        e.Payload.GetValueOrDefault("previousLeaderKey")?.ToString(),
                        newLeader,
                        e.SectionsPct,
                        FindPoint(timeline, snapshotVersion)?.Candidates ?? [],
                        PayloadLong(e, "leadVotes"),
                        snapshotVersion);
                    leadChanges.Add(record);
                    newLeadChanges.Add(record);
                    break;
            }
        }

        var source = state.Source;
        if (adoptSourceHealth && changes.Source is { } persisted)
        {
            // Falhas, bloqueio e verificações vêm da líder; a defasagem cada réplica calcula (EvaluateAsync).
            source = persisted with { Stale = source.Stale, StaleSince = source.StaleSince };
        }
        if (nationalChanged && national is not null)
        {
            // Snapshot só é gravado quando o conteúdo muda: o recebimento dele é a última mudança de conteúdo.
            source = source with
            {
                LastChangeAt = Max(source.LastChangeAt, national.IngestedAt),
                LastFileGeneratedAt = Max(source.LastFileGeneratedAt, national.GeneratedAt),
            };
        }

        var profilesChanged = nationalChanged && (state.National is null || !state.National.Profiles.SequenceEqual(national!.Profiles, ProfileComparer.Instance));
        var next = state with
        {
            National = national,
            NationalVersion = version,
            StatesVersion = statesVersion,
            States = states.ToImmutable(),
            StateTimelines = stateTimelines.ToImmutable(),
            Municipalities = municipalities.ToImmutable(),
            Zones = zones.ToImmutable(),
            NationalAccompaniment = nationalAccompaniment,
            StateAccompaniment = stateAccompaniment.ToImmutable(),
            Timeline = timeline.ToImmutable(),
            Events = events.ToImmutable(),
            LeadChanges = leadChanges.ToImmutable(),
            Math = math,
            LastLeaderKey = lastLeader,
            Source = source,
        };
        return new AppliedChanges(next, nationalChanged, statesChanged, changes.Accompaniments.Any(a => a.Scope == "br"), profilesChanged, newEvents, newLeadChanges);
    }

    private static bool IsNewer(TerritorySnapshot candidate, TerritorySnapshot have) =>
        (candidate.TotalizedAt ?? DateTimeOffset.MinValue, candidate.IngestedAt).CompareTo((have.TotalizedAt ?? DateTimeOffset.MinValue, have.IngestedAt)) >= 0;

    private static DateTimeOffset? Max(DateTimeOffset? a, DateTimeOffset? b) => a is null ? b : b is null ? a : a > b ? a : b;

    /// <summary>Ponto da linha do tempo pela versão (id do snapshot). A linha do tempo está em ordem de versão.</summary>
    private static TimelinePoint? FindPoint(IReadOnlyList<TimelinePoint> points, long? version)
    {
        if (version is not { } v) return null;
        int lo = 0, hi = points.Count - 1;
        while (lo <= hi)
        {
            var mid = lo + ((hi - lo) / 2);
            var at = points[mid].Version;
            if (at == v) return points[mid];
            if (at < v) lo = mid + 1;
            else hi = mid - 1;
        }
        return null;
    }

    private static long? PayloadLong(LiveEvent e, string key) =>
        long.TryParse(e.Payload.GetValueOrDefault(key)?.ToString(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : null;

    private static DateTimeOffset? PayloadTime(LiveEvent e, string key) =>
        e.Payload.GetValueOrDefault(key) is { } raw && DateTimeOffset.TryParse(raw.ToString(), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed) ? parsed : null;

    /// <summary>Votos no instante do sinal md=e: o snapshot que o originou (o mesmo valor que a líder exibiu ao vivo).</summary>
    private static DefinedSnapshot DefinedFrom(LiveEvent e, string leader, TimelinePoint? point)
    {
        var tally = point?.Candidates.FirstOrDefault(c => c.Key == leader);
        return new DefinedSnapshot(leader, tally?.Votes ?? PayloadLong(e, "leaderVotes"), tally?.Percent, point?.LeadVotes ?? PayloadLong(e, "leadVotes"), e.SectionsPct, e.At, e.DetectedAt);
    }

    // ================================================================ ciclo nacional

    /// <summary>Intervalo do próximo ciclo nacional: curto durante a totalização, longo antes e depois.</summary>
    public TimeSpan NationalInterval()
    {
        var s = hub.Current;
        if (s is null) return options.IdlePollInterval;
        var now = time.GetUtcNow();
        if (s.Phase is LivePhase.FINAL) return TimeSpan.FromSeconds(Math.Max(60, options.IdlePollInterval.TotalSeconds));
        if (s.National?.Progress == "n")
        {
            var start = s.Context.TotalizationStartsAt;
            // Perto do horário de início (10 min antes em diante) o ciclo encurta para pegar a primeira divulgação.
            return start is { } st && now >= st - TimeSpan.FromMinutes(10) ? Clamp(options.PollInterval * 2) : options.IdlePollInterval;
        }
        return Clamp(options.PollInterval);
    }

    /// <summary>EA14: ciclo curto durante a totalização; antes dela o arquivo não muda e o ciclo é o de repouso.</summary>
    public TimeSpan AccompanimentInterval()
    {
        var s = hub.Current;
        if (s is null || s.Phase is LivePhase.FINAL) return options.IdlePollInterval;
        if (s.National?.Progress == "n")
        {
            var start = s.Context.TotalizationStartsAt;
            return start is { } st && time.GetUtcNow() >= st - TimeSpan.FromMinutes(10) ? options.AccompanimentInterval : options.IdlePollInterval;
        }
        return options.AccompanimentInterval;
    }

    private static TimeSpan Clamp(TimeSpan interval) => interval < TimeSpan.FromMilliseconds(500) ? TimeSpan.FromMilliseconds(500) : interval;

    public async Task<bool> PollNationalAsync(CancellationToken ct)
    {
        var current = hub.Current;
        if (paths is null || current is null) return false;
        var url = paths.Result(current.Context.Election.ElectionCode, options.OfficeCode);
        var response = await FetchTrackedAsync(url, TsePriority.Critical, ct, haveBody: current.National is not null);
        UpdateSource(response, national: true);
        if (response.Status != TseFetchStatus.Ok || response.Body is null)
        {
            await PersistSourceHealthAsync(ct);
            return false;
        }

        TerritorySnapshot snapshot;
        try
        {
            var parsed = TseParser.ParseEa20(response.Body, options.OfficeCode);
            Validate(parsed, current.Context, "br", "br");
            snapshot = TerritorySnapshot.From(parsed, TerritoryKey.National, null, response.ReceivedAt, response.Body, response.ETag, response.LastModified);
        }
        catch (TseContractException e)
        {
            await ContractErrorAsync(url, e, ct);
            return false;
        }
        var applied = await ApplyNationalAsync(snapshot, response.Body, ct);
        await PersistSourceHealthAsync(ct);
        return applied;
    }

    /// <summary>
    /// Grava a saúde da fonte quando muda o que define a fase (falhas, bloqueio) e, fora isso, no máximo a cada 5 s:
    /// as seguidoras mostram a mesma fase e a mesma "última verificação" que a líder.
    /// </summary>
    private async Task PersistSourceHealthAsync(CancellationToken ct)
    {
        var src = hub.Current?.Source;
        if (src is null) return;
        var now = time.GetUtcNow();
        var known = persistedHealth;
        var relevant = known is null || known.Failing != src.Failing || known.ConsecutiveFailures != src.ConsecutiveFailures || known.BlockedUntil != src.BlockedUntil || known.Healthy != src.Healthy;
        if (!relevant && now - persistedHealthAt < HealthEvery) return;
        if (!await StoreReadyAsync(ct)) return;
        try
        {
            await store!.SaveSourceHealthAsync(electionId, src, ct);
            persistedHealth = src;
            persistedHealthAt = now;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            StoreFailed(e, "saúde da fonte");
        }
    }

    /// <summary>Aplica um snapshot nacional novo: eventos, persistência, troca atômica do estado e publicação SSE.</summary>
    public async Task<bool> ApplyNationalAsync(TerritorySnapshot snapshot, byte[]? raw, CancellationToken ct)
    {
        await processing.WaitAsync(ct);
        try
        {
            var before = hub.Current!;
            var problems = ElectionMath.Invariants(snapshot.Sections, snapshot.Electorate, snapshot.Votes, snapshot.Candidates);
            if (problems.Count > 0)
                Alert("invariants", $"Invariantes divergentes no arquivo nacional (idg {snapshot.GenerationId}): {string.Join("; ", problems)}. O dado oficial é aceito; o veredito matemático independente fica suspenso.");

            if (before.National?.ContentHash == snapshot.ContentHash)
            {
                metrics.SnapshotDeduplicated();
                hub.Update(s => s with { Source = s.Source with { LastFileGeneratedAt = snapshot.GeneratedAt ?? s.Source.LastFileGeneratedAt } });
                return false;
            }

            var now = time.GetUtcNow();
            long? snapshotId = null;
            if (await StoreReadyAsync(ct))
            {
                try
                {
                    snapshotId = await store!.SaveSnapshotAsync(electionId, snapshot, raw, ct);
                    StoreHealthy = true;
                    if (snapshotId is null) metrics.SnapshotDeduplicated();
                    else metrics.SnapshotWritten();
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    StoreFailed(e, "snapshot nacional");
                }
            }
            var version = snapshotId ?? before.NationalVersion + 1;
            if (version <= before.NationalVersion) version = before.NationalVersion + 1;

            var independent = ElectionMath.Evaluate(snapshot.Candidates, snapshot.Electorate);
            var detection = EventDetector.Detect(before.National, snapshot, before.LastLeaderKey, before.Math, independent, version, now, key => NameOf(snapshot, key));
            var saved = new List<LiveEvent>();
            foreach (var e in detection.Events)
            {
                var stored = await RecordEventAsync(e, snapshotId, ct);
                if (stored is not null) saved.Add(stored);
            }
            var leadChange = detection.LeadChange is { } lc
                ? lc with { Id = saved.FirstOrDefault(e => e.Type == LiveEventTypes.LeadChange)?.Id ?? lc.SnapshotVersion }
                : null;
            var profilesChanged = before.National is null || !before.National.Profiles.SequenceEqual(snapshot.Profiles, ProfileComparer.Instance);

            var next = hub.Update(s =>
            {
                var updated = s with
                {
                    National = snapshot,
                    NationalVersion = version,
                    Timeline = s.Timeline.Add(TimelinePoint.From(version, snapshot)),
                    Events = s.Events.AddRange(saved),
                    LeadChanges = leadChange is null ? s.LeadChanges : s.LeadChanges.Add(leadChange),
                    Math = detection.Math,
                    LastLeaderKey = detection.LastLeaderKey,
                    // Só aqui (conteúdo novo, hash diferente) a fonte "mudou"; 200 repetido com o mesmo conteúdo não conta.
                    Source = s.Source with { LastChangeAt = snapshot.IngestedAt, LastFileGeneratedAt = snapshot.GeneratedAt ?? s.Source.LastFileGeneratedAt },
                };
                return updated with { Phase = Phase(updated) };
            });

            metrics.IngestionLagSeconds = snapshot.GeneratedAt is { } g ? Math.Max(0, (snapshot.IngestedAt - g).TotalSeconds) : null;
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
            if (profilesChanged) Publish(next, "candidate-update", new CandidatesPayloadDto(LiveProjector.Candidates(next)));
            PublishTransitions(next, saved, leadChange is null ? [] : [leadChange]);
            await NotifyAsync("national", version);
            LogNational(logger, "national_update", snapshot.GenerationId, snapshot.ETag, snapshot.Sections.TotalizedPct, version);
            return true;
        }
        finally
        {
            processing.Release();
        }
    }

    /// <summary>Eventos públicos novos no SSE (líder e seguidoras publicam exatamente os mesmos).</summary>
    private void PublishTransitions(LiveElectionState next, IEnumerable<LiveEvent> events, IReadOnlyList<LeadChangeRecord> leadChanges)
    {
        foreach (var e in events.Where(e => e.IsPublic))
        {
            Publish(next, "timeline-event", LiveProjector.EventDto(e));
            if (e.Type == LiveEventTypes.MathematicallyDefined && next.Math.Defined is not null)
                Publish(next, "mathematically-defined", new { @event = LiveProjector.EventDto(e), defined = LiveProjector.Defined(next) });
            if (e.Type == LiveEventTypes.Finalized) Publish(next, "finalized", new { @event = LiveProjector.EventDto(e) });
        }
        foreach (var change in leadChanges) Publish(next, "lead-change", LiveProjector.LeadChange(change));
    }

    // ================================================================ EA14 → UFs

    public async Task<int> PollAccompanimentAsync(CancellationToken ct)
    {
        var current = hub.Current;
        if (paths is null || current is null) return 0;
        var code = current.Context.Election.ElectionCode;
        var response = await FetchTrackedAsync(paths.Accompaniment(code), TsePriority.Critical, ct, haveBody: current.NationalAccompaniment is not null);
        AccompanimentFile? file = null;
        if (response is { Status: TseFetchStatus.Ok, Body: not null })
        {
            try
            {
                file = TseParser.ParseAccompaniment(response.Body);
                if (file.ElectionCode != code) throw new TseContractException($"EA14 da eleição {file.ElectionCode}, esperado {code}");
                hub.Update(s => s with { NationalAccompaniment = file });
            }
            catch (TseContractException e)
            {
                await ContractErrorAsync(paths.Accompaniment(code), e, ct);
                return 0;
            }
            await SaveAccompanimentAsync("br", file, response, ct);
        }
        current = hub.Current!;
        file ??= current.NationalAccompaniment;

        // UFs a buscar: EA14 indica totalização mais nova, mudou o nº de seções, ou ainda não temos o arquivo da UF.
        var ufs = ElectionUfs(current);
        var changed = new List<string>();
        foreach (var uf in ufs)
        {
            var entry = file?.Entries.FirstOrDefault(e => e.ScopeType == "uf" && e.Code == uf);
            current.States.TryGetValue(uf, out var have);
            if (have is null
                || (entry?.TotalizedAt is { } t && (have.TotalizedAt is null || t > have.TotalizedAt))
                || (entry?.Sections.Totalized is { } st && st != have.Sections.Totalized)
                || (entry is not null && entry.Progress != have.Progress))
                changed.Add(uf);
        }
        var applied = 0;
        foreach (var uf in changed)
            if (await FetchStateAsync(uf, ct)) applied++;
        if (applied > 0)
        {
            var next = hub.Update(s => s with { StatesVersion = s.StatesVersion + 1 });
            Publish(next, "state-update", LiveProjector.States(next));
            await NotifyAsync("states", next.StatesVersion);
        }
        else if (response.Status == TseFetchStatus.Ok)
        {
            // EA14 novo sem UF nova: os votos restantes por UF mudaram mesmo assim.
            var next = hub.Current!;
            Publish(next, "state-update", LiveProjector.States(next));
        }
        return applied;
    }

    private async Task<bool> FetchStateAsync(string uf, CancellationToken ct)
    {
        var current = hub.Current!;
        var url = paths!.Result(current.Context.Election.ElectionCode, options.OfficeCode, uf);
        var response = await FetchTrackedAsync(url, TsePriority.Critical, ct, haveBody: current.States.ContainsKey(uf));
        if (response.Status != TseFetchStatus.Ok || response.Body is null) return false;
        try
        {
            var parsed = TseParser.ParseEa20(response.Body, options.OfficeCode);
            Validate(parsed, current.Context, "uf", uf);
            var snapshot = TerritorySnapshot.From(parsed, TerritoryKey.State(uf), uf, response.ReceivedAt, response.Body, response.ETag, response.LastModified);
            if (current.States.TryGetValue(uf, out var have) && have.ContentHash == snapshot.ContentHash)
            {
                metrics.SnapshotDeduplicated();
                return false;
            }
            long? id = null;
            if (await StoreReadyAsync(ct))
            {
                try
                {
                    id = await store!.SaveSnapshotAsync(electionId, snapshot, response.Body, ct);
                    if (id is null) metrics.SnapshotDeduplicated();
                    else metrics.SnapshotWritten();
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    StoreFailed(e, $"snapshot da UF {uf}");
                }
            }
            hub.Update(s =>
            {
                var points = s.StateTimelines.GetValueOrDefault(uf) ?? [];
                return s with
                {
                    States = s.States.SetItem(uf, snapshot),
                    StateTimelines = s.StateTimelines.SetItem(uf, points.Add(TimelinePoint.From(id ?? points.Count + 1, snapshot))),
                };
            });
            return true;
        }
        catch (TseContractException e)
        {
            await ContractErrorAsync(url, e, ct);
            return false;
        }
    }

    // ================================================================ EA15 → municípios

    /// <summary>Uma UF por chamada, em rodízio. Enfileira municípios prioritários cujo dt/ht mudou.</summary>
    public async Task PollNextStateAccompanimentAsync(CancellationToken ct)
    {
        var current = hub.Current;
        if (paths is null || current is null) return;
        var ufs = ElectionUfs(current);
        if (ufs.Count == 0) return;
        // UFs com visitantes olhando municípios vêm antes no rodízio.
        var wanted = demand.Where(d => time.GetUtcNow() - d.Value < TimeSpan.FromMinutes(10) && d.Key.StartsWith("uf:", StringComparison.Ordinal))
            .Select(d => d.Key[3..])
            .FirstOrDefault(uf => ufs.Contains(uf) && !current.StateAccompaniment.ContainsKey(uf));
        var uf = wanted ?? ufs[Interlocked.Increment(ref nextUfIndex) % ufs.Count];
        await PollStateAccompanimentAsync(uf, ct);
    }

    public async Task PollStateAccompanimentAsync(string uf, CancellationToken ct)
    {
        var current = hub.Current!;
        var url = paths!.Accompaniment(current.Context.Election.ElectionCode, uf);
        var response = await FetchTrackedAsync(url, TsePriority.Background, ct, haveBody: current.StateAccompaniment.ContainsKey(uf));
        if (response.Status != TseFetchStatus.Ok || response.Body is null) return;
        AccompanimentFile file;
        try
        {
            file = TseParser.ParseAccompaniment(response.Body);
        }
        catch (TseContractException e)
        {
            await ContractErrorAsync(url, e, ct);
            return;
        }
        var next = hub.Update(s => s with { StateAccompaniment = s.StateAccompaniment.SetItem(uf, file) });
        await SaveAccompanimentAsync(uf, file, response, ct);
        var priority = PriorityMunicipalities(next);
        var ufDemanded = demand.TryGetValue($"uf:{uf}", out var at) && time.GetUtcNow() - at < TimeSpan.FromMinutes(10);
        // Rede de segurança: se o EA15 estiver defasado, municípios prioritários da UF em apuração (EA14) são
        // renovados por tempo, sem depender do dt/ht do EA15.
        var ufInProgress = next.NationalAccompaniment?.Entries.FirstOrDefault(e => e.ScopeType == "uf" && e.Code == uf)?.Progress == "p";
        if (ufInProgress)
        {
            var now = time.GetUtcNow();
            foreach (var municipality in next.Context.Ufs.FirstOrDefault(u => u.Uf == uf)?.Municipalities.Where(m => priority.Contains(m.TseCode)) ?? [])
                if (!next.Municipalities.TryGetValue(municipality.TseCode, out var cached) || now - cached.IngestedAt > PriorityRefresh)
                    Enqueue(municipality.TseCode, urgent: true);
        }
        foreach (var entry in file.Entries.Where(e => e.ScopeType == "mun"))
        {
            next.Municipalities.TryGetValue(entry.Code, out var have);
            var stale = have is null
                ? entry.Progress != "n" || priority.Contains(entry.Code)
                : entry.TotalizedAt is { } t && (have.TotalizedAt is null || t > have.TotalizedAt);
            if (!stale) continue;
            if (priority.Contains(entry.Code) || ufDemanded) Enqueue(entry.Code, urgent: true);
            else Enqueue(entry.Code, urgent: false);
        }
    }

    /// <summary>Último EA14/EA15 vai para o banco: as seguidoras exibem cobertura, votos restantes e maiores eleitorados
    /// iguais aos da líder sem consultar o TSE.</summary>
    private async Task SaveAccompanimentAsync(string scope, AccompanimentFile file, TseFetchResult response, CancellationToken ct)
    {
        if (response.Body is null || !await StoreReadyAsync(ct)) return;
        try
        {
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(response.Body)).ToLowerInvariant();
            await store!.SaveAccompanimentAsync(electionId, scope, file, hash, response.ReceivedAt, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            StoreFailed(e, $"acompanhamento {scope}");
        }
    }

    /// <summary>Renovação por tempo das capitais e maiores eleitorados durante a apuração da UF.</summary>
    private static readonly TimeSpan PriorityRefresh = TimeSpan.FromSeconds(60);

    private HashSet<string> PriorityMunicipalities(LiveElectionState s)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var uf in s.Context.Ufs)
            foreach (var m in uf.Municipalities.Where(m => m.Capital))
                set.Add(m.TseCode);
        foreach (var code in LiveProjector.LargestCodes(s, options.PriorityMunicipalities)) set.Add(code);
        var now = time.GetUtcNow();
        foreach (var (key, at) in demand)
            if (!key.StartsWith("uf:", StringComparison.Ordinal) && now - at < TimeSpan.FromMinutes(10)) set.Add(key);
        return set;
    }

    private void Enqueue(string code, bool urgent)
    {
        if (!queued.TryAdd(code, 0)) return;
        (urgent ? priorityQueue : backgroundQueue).Writer.TryWrite(code);
    }

    /// <summary>Consome as filas de municípios (prioritária antes da de fundo).</summary>
    public async Task RunMunicipalWorkerAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            string code;
            bool urgent;
            if (priorityQueue.Reader.TryRead(out var p))
            {
                code = p;
                urgent = true;
            }
            else if (backgroundQueue.Reader.TryRead(out var b))
            {
                code = b;
                urgent = false;
            }
            else
            {
                var waitPriority = priorityQueue.Reader.WaitToReadAsync(ct).AsTask();
                var waitBackground = backgroundQueue.Reader.WaitToReadAsync(ct).AsTask();
                await Task.WhenAny(waitPriority, waitBackground);
                continue;
            }
            queued.TryRemove(code, out _);
            try
            {
                await FetchMunicipalityAsync(code, urgent ? TsePriority.Normal : TsePriority.Background, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                LogWorkerError(logger, code, e);
            }
        }
    }

    /// <summary>Garante um resultado municipal recente para quem pediu (single-flight por município).</summary>
    public async Task<bool> EnsureMunicipalityAsync(string code, CancellationToken ct)
    {
        var current = hub.Current;
        if (current is null || !current.Context.TryMunicipality(code, out var uf, out _)) return false;
        demand[code] = time.GetUtcNow();
        demand[$"uf:{uf}"] = time.GetUtcNow();
        if (paths is null) return current.Municipalities.ContainsKey(code);
        if (current.Municipalities.TryGetValue(code, out var have) && time.GetUtcNow() - have.IngestedAt < options.MunicipalCacheTtl && !NewerInAccompaniment(current, uf, code, have))
            return true;
        var task = inflight.GetOrAdd(code, c => new Lazy<Task<bool>>(() => SingleFlightAsync(c))).Value;
        try
        {
            return await task.WaitAsync(TimeSpan.FromSeconds(6), ct);
        }
        catch (TimeoutException)
        {
            return hub.Current?.Municipalities.ContainsKey(code) == true;
        }
    }

    private async Task<bool> SingleFlightAsync(string code)
    {
        try
        {
            return await FetchMunicipalityAsync(code, TsePriority.Normal, CancellationToken.None);
        }
        finally
        {
            inflight.TryRemove(code, out _);
        }
    }

    /// <summary>Marca a UF como de interesse (municípios dela sobem na fila na próxima volta do EA15).</summary>
    public void DemandState(string uf) => demand[$"uf:{uf}"] = time.GetUtcNow();

    private static bool NewerInAccompaniment(LiveElectionState s, string uf, string code, TerritorySnapshot have) =>
        LiveProjector.AccompanimentOf(s, uf, code)?.TotalizedAt is { } t && (have.TotalizedAt is null || t > have.TotalizedAt);

    private async Task<bool> FetchMunicipalityAsync(string code, TsePriority priority, CancellationToken ct)
    {
        var current = hub.Current;
        if (current is null || paths is null || !current.Context.TryMunicipality(code, out var uf, out _)) return false;
        var url = paths.Result(current.Context.Election.ElectionCode, options.OfficeCode, uf, code);
        var response = await FetchTrackedAsync(url, priority, ct, haveBody: current.Municipalities.ContainsKey(code));
        if (response.Status == TseFetchStatus.NotModified && current.Municipalities.ContainsKey(code))
        {
            // Confirmado sem mudança pelo TSE: renova o recebimento (TTL), sem novo conteúdo.
            hub.Update(s => s.Municipalities.TryGetValue(code, out var same) ? s with { Municipalities = s.Municipalities.SetItem(code, same with { IngestedAt = response.ReceivedAt }) } : s);
            return true;
        }
        if (response.Status != TseFetchStatus.Ok || response.Body is null) return false;
        try
        {
            var parsed = TseParser.ParseEa20(response.Body, options.OfficeCode);
            Validate(parsed, current.Context, "mu", code);
            var snapshot = TerritorySnapshot.From(parsed, TerritoryKey.Municipality(code), uf, response.ReceivedAt, response.Body, response.ETag, response.LastModified);
            if (current.Municipalities.TryGetValue(code, out var have) && have.ContentHash == snapshot.ContentHash)
            {
                hub.Update(s => s with { Municipalities = s.Municipalities.SetItem(code, have with { IngestedAt = snapshot.IngestedAt }) });
                return true;
            }
            hub.Update(s => s with { Municipalities = s.Municipalities.SetItem(code, snapshot) });
            if (await StoreReadyAsync(ct))
            {
                try
                {
                    await store!.SaveTerritoryLatestAsync(electionId, snapshot, ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    StoreFailed(e, $"município {code}");
                }
            }
            return true;
        }
        catch (TseContractException e)
        {
            await ContractErrorAsync(url, e, ct);
            return false;
        }
    }

    /// <summary>Zonas eleitorais de um município: só sob demanda (lista oficial de zonas do EA12).</summary>
    public async Task<bool> EnsureZonesAsync(string code, CancellationToken ct)
    {
        var current = hub.Current;
        if (current is null || paths is null || !current.Context.TryMunicipality(code, out var uf, out var municipality)) return false;
        var any = false;
        foreach (var zone in municipality.Zones)
        {
            var key = $"{code}-{zone}";
            if (current.Zones.TryGetValue(key, out var have) && time.GetUtcNow() - have.IngestedAt < options.MunicipalCacheTtl)
            {
                any = true;
                continue;
            }
            var url = paths.Result(current.Context.Election.ElectionCode, options.OfficeCode, uf, code, zone);
            var response = await FetchTrackedAsync(url, TsePriority.Normal, ct, haveBody: have is not null);
            if (response.Status == TseFetchStatus.NotModified && have is not null)
            {
                hub.Update(s => s with { Zones = s.Zones.SetItem(key, have with { IngestedAt = response.ReceivedAt }) });
                any = true;
                continue;
            }
            if (response.Status != TseFetchStatus.Ok || response.Body is null) continue;
            try
            {
                var parsed = TseParser.ParseEa20(response.Body, options.OfficeCode);
                Validate(parsed, current.Context, "zona", zone);
                var snapshot = TerritorySnapshot.From(parsed, TerritoryKey.Zone(code, zone), uf, response.ReceivedAt, response.Body, response.ETag, response.LastModified);
                hub.Update(s => s with { Zones = s.Zones.SetItem(key, snapshot) });
                if (await StoreReadyAsync(ct))
                {
                    try { await store!.SaveTerritoryLatestAsync(electionId, snapshot, ct); }
                    catch (Exception e) when (e is not OperationCanceledException) { StoreFailed(e, $"zona {key}"); }
                }
                any = true;
            }
            catch (TseContractException e)
            {
                await ContractErrorAsync(url, e, ct);
            }
        }
        return any;
    }

    // ================================================================ 1º turno (base estática)

    public async Task LoadFirstRoundAsync(CancellationToken ct)
    {
        var current = hub.Current;
        if (current is null || paths is null || current.Context.Election.FirstRoundElectionCode is not { } code) return;
        var ufs = ElectionUfs(current);
        if (current.FirstRound?.National is not null && current.FirstRound.States.Count >= ufs.Count) return;
        var baseline = current.FirstRound ?? FirstRoundBaseline.Empty(code);
        var nationalResponse = await source.FetchAsync(paths.Result(code, options.OfficeCode), null, TsePriority.Background, ct);
        if (nationalResponse is { Status: TseFetchStatus.Ok, Body: not null })
        {
            var parsed = TseParser.ParseEa20(nationalResponse.Body, options.OfficeCode);
            baseline = baseline with { National = TerritorySnapshot.From(parsed, TerritoryKey.National, null, nationalResponse.ReceivedAt, nationalResponse.Body, null, null) };
        }
        foreach (var uf in ufs)
        {
            if (baseline.States.ContainsKey(uf)) continue;
            var response = await source.FetchAsync(paths.Result(code, options.OfficeCode, uf), null, TsePriority.Background, ct);
            if (response is not { Status: TseFetchStatus.Ok, Body: not null }) continue;
            try
            {
                var parsed = TseParser.ParseEa20(response.Body, options.OfficeCode);
                baseline = baseline with { States = baseline.States.SetItem(uf, TerritorySnapshot.From(parsed, TerritoryKey.State(uf), uf, response.ReceivedAt, response.Body, null, null)) };
            }
            catch (TseContractException e)
            {
                Alert("first_round_contract", $"1º turno ({uf}): {e.Message}");
            }
        }
        var finalBaseline = baseline;
        var next = hub.Update(s => s with { FirstRound = finalBaseline });
        Publish(next, "state-update", LiveProjector.States(next));
    }

    /// <summary>Resultado do 1º turno de um município (sob demanda; base estática, cache permanente em memória).</summary>
    public async Task EnsureFirstRoundMunicipalityAsync(string code, CancellationToken ct)
    {
        var current = hub.Current;
        if (current?.FirstRound is not { } baseline || paths is null || baseline.Municipalities.ContainsKey(code)) return;
        if (!current.Context.TryMunicipality(code, out var uf, out _)) return;
        var response = await source.FetchAsync(paths.Result(baseline.ElectionCode, options.OfficeCode, uf, code), null, TsePriority.Normal, ct);
        if (response is not { Status: TseFetchStatus.Ok, Body: not null }) return;
        try
        {
            var parsed = TseParser.ParseEa20(response.Body, options.OfficeCode);
            var snapshot = TerritorySnapshot.From(parsed, TerritoryKey.Municipality(code), uf, response.ReceivedAt, response.Body, null, null);
            hub.Update(s => s.FirstRound is null ? s : s with { FirstRound = s.FirstRound with { Municipalities = s.FirstRound.Municipalities.SetItem(code, snapshot) } });
        }
        catch (TseContractException e)
        {
            Alert("first_round_contract", $"1º turno ({code}): {e.Message}");
        }
    }

    // ================================================================ fotos

    /// <summary>Foto oficial: memória → banco → TSE (uma única vez). Só para candidatos da eleição em curso.</summary>
    public async Task<(byte[] Content, string Type)?> PhotoAsync(string sqcand, CancellationToken ct)
    {
        var current = hub.Current;
        if (current?.National is null || current.National.Profiles.All(p => p.Key != sqcand)) return null;
        if (photos.TryGetValue(sqcand, out var cached)) return cached;
        if (store is not null)
        {
            try
            {
                if (await store.LoadPhotoAsync(sqcand, ct) is { } stored)
                {
                    photos[sqcand] = stored;
                    return stored;
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                StoreFailed(e, "foto");
            }
        }
        if (paths is null || current.Context.Mode == LiveModes.Replay) return null;
        var url = paths.Photo(current.Context.Election.ElectionCode, "br", sqcand);
        var response = await source.FetchAsync(url, null, TsePriority.Normal, ct);
        if (response is not { Status: TseFetchStatus.Ok, Body: { Length: > 0 and < 2_000_000 } body }) return null;
        var photo = (body, "image/jpeg");
        photos[sqcand] = photo;
        if (store is not null && Persist)
        {
            try { await store.SavePhotoAsync(sqcand, body, "image/jpeg", response.ETag, url.AbsoluteUri, ct); }
            catch (Exception e) when (e is not OperationCanceledException) { StoreFailed(e, "foto"); }
        }
        return photo;
    }

    // ================================================================ defasagem e fase

    /// <summary>Reavalia fase e defasagem da fonte (chamado a cada segundo). Publica mudanças.</summary>
    public async Task EvaluateAsync(CancellationToken ct)
    {
        var current = hub.Current;
        if (current is null) return;
        var now = time.GetUtcNow();
        metrics.DataAgeSeconds = current.National is null ? null : Math.Max(0, (now - current.National.IngestedAt).TotalSeconds);
        var live = current.National is { Progress: "p" } && current.National.FinalTotalization != true;
        var changedAt = current.Source.LastChangeAt ?? current.National?.IngestedAt;
        var stale = live && changedAt is { } c && now - c > options.StaleAfter;
        var wasStale = current.Source.Stale;
        var next = hub.Update(s =>
        {
            var source = s.Source with
            {
                Stale = stale,
                StaleSince = stale ? s.Source.StaleSince ?? changedAt + options.StaleAfter : null,
            };
            var updated = s with { Source = source };
            return updated with { Phase = Phase(updated) };
        });
        if (stale && !wasStale)
        {
            Alert("source_stale", $"Arquivo nacional sem atualização há mais de {options.StaleAfter.TotalMinutes:0} min.");
            Publish(next, "source-stale", LiveProjector.Source(next, now));
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
            await RecordEventAsync(new LiveEvent(0, LiveEventTypes.SourceStale, "internal", null, "br", "br", null, now, "Fonte oficial sem atualização", null, next.National?.Sections.TotalizedPct, new Dictionary<string, object?>()), null, ct);
        }
        else if (!stale && wasStale)
        {
            Publish(next, "source-recovered", LiveProjector.Source(next, now));
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
            await RecordEventAsync(new LiveEvent(0, LiveEventTypes.SourceRecovered, "internal", null, "br", "br", null, now, "Fonte oficial voltou a atualizar", null, next.National?.Sections.TotalizedPct, new Dictionary<string, object?>()), null, ct);
        }
        else if (next.Phase != current.Phase)
        {
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
        }
    }

    /// <summary>
    /// UFs com a eleição: as do EA14 ("um abr uf para cada UF que tenha eleição ordinária"); sem EA14, as do EA12.
    /// Buscar arquivo de UF fora dessa lista geraria 404.
    /// </summary>
    public static IReadOnlyList<string> ElectionUfs(LiveElectionState s)
    {
        var fromAccompaniment = s.NationalAccompaniment?.Entries.Where(e => e.ScopeType == "uf").Select(e => e.Code).ToList();
        return fromAccompaniment is { Count: > 0 } ? fromAccompaniment : [.. s.Context.Ufs.Select(u => u.Uf)];
    }

    private LivePhase Phase(LiveElectionState s) =>
        LivePhases.Resolve(new PhaseInput(s.National, s.Source.Stale, s.Source.Failing, time.GetUtcNow(), s.Context.TotalizationStartsAt));

    private void UpdateSource(TseFetchResult response, bool national)
    {
        if (!national || hub.Current is null) return;
        var before = hub.Current;
        var next = hub.Update(s =>
        {
            var src = s.Source;
            // LastChangeAt não muda aqui: um 200 pode trazer o mesmo conteúdo (só a aplicação do snapshot decide).
            src = response.Status switch
            {
                TseFetchStatus.Ok or TseFetchStatus.NotModified => src with { Healthy = true, ConsecutiveFailures = 0, LastSuccessAt = response.ReceivedAt, LastCheckedAt = response.ReceivedAt, LastError = null, BlockedUntil = null },
                TseFetchStatus.Blocked => src with { Healthy = false, LastCheckedAt = response.ReceivedAt, LastError = response.Error, BlockedUntil = response.ReceivedAt + options.BlockPause },
                TseFetchStatus.Skipped => src with { LastCheckedAt = response.ReceivedAt },
                _ => src with { Healthy = src.ConsecutiveFailures + 1 < 3, ConsecutiveFailures = src.ConsecutiveFailures + 1, LastCheckedAt = response.ReceivedAt, LastError = response.Error },
            };
            var updated = s with { Source = src };
            return updated with { Phase = Phase(updated) };
        });
        if (before.Source.Failing != next.Source.Failing)
        {
            // A fase muda junto (LIVE ↔ LIVE_STALE): a página só sabe pela atualização nacional.
            if (next.Source.Failing)
            {
                Alert("source_failing", $"Fonte oficial falhando ({next.Source.LastError}).");
                Publish(next, "source-stale", LiveProjector.Source(next, response.ReceivedAt));
            }
            else
            {
                Publish(next, "source-recovered", LiveProjector.Source(next, response.ReceivedAt));
            }
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
        }
    }

    // ================================================================ utilidades

    /// <summary>GET condicional só quando o conteúdo correspondente já está em memória: um 304 sem o corpo anterior
    /// deixaria a abrangência vazia depois de um reinício.</summary>
    private async Task<TseFetchResult> FetchTrackedAsync(Uri url, TsePriority priority, CancellationToken ct, bool haveBody = true)
    {
        var key = url.AbsoluteUri;
        TseConditional? conditional = null;
        if (haveBody) conditionals.TryGetValue(key, out conditional);
        var response = await source.FetchAsync(url, conditional, priority, ct);
        if (response.Status is TseFetchStatus.Ok or TseFetchStatus.NotModified && (response.ETag is not null || response.LastModified is not null))
        {
            var next = new TseConditional(response.ETag, response.LastModified);
            conditionals[key] = next;
            if (response.Status == TseFetchStatus.Ok && await StoreReadyAsync(ct))
            {
                try { await store!.SaveSourceStateAsync(electionId, key, next, response.HttpStatus, response.ReceivedAt, true, ct); }
                catch (Exception e) when (e is not OperationCanceledException) { StoreFailed(e, "estado da fonte"); }
            }
        }
        return response;
    }

    private void Validate(Ea20Result parsed, LiveElectionContext context, string scopeType, string scopeCode)
    {
        if (parsed.ElectionCode != context.Election.ElectionCode)
            throw new TseContractException($"EA20 da eleição {parsed.ElectionCode}, esperado {context.Election.ElectionCode}");
        if (options.Mode != LiveModes.Replay && parsed.Phase != ExpectedPhase)
            throw new TseContractException($"EA20 com fase '{parsed.Phase}' no modo {options.Mode}");
        if (parsed.ScopeType != scopeType || !string.Equals(parsed.ScopeCode, scopeCode, StringComparison.OrdinalIgnoreCase))
            throw new TseContractException($"EA20 de {parsed.ScopeType}:{parsed.ScopeCode}, esperado {scopeType}:{scopeCode}");
    }

    private async Task ContractErrorAsync(Uri url, TseContractException e, CancellationToken ct)
    {
        metrics.ContractError();
        Alert("contract", $"{url.AbsolutePath}: {e.Message}");
        await RecordEventAsync(new LiveEvent(0, LiveEventTypes.ContractError, "internal", $"contract-{StableHash(url.AbsolutePath + e.Message)}", "br", "br", null, time.GetUtcNow(), "Arquivo fora do contrato", $"{url.AbsolutePath}: {e.Message}", null, new Dictionary<string, object?>()), null, ct);
    }

    private async Task<LiveEvent?> RecordEventAsync(LiveEvent e, long? snapshotId, CancellationToken ct)
    {
        if (store is null) return e with { Id = Interlocked.Increment(ref localEventId) };
        if (!await StoreReadyAsync(ct)) return e with { Id = -Interlocked.Increment(ref localEventId) };
        try
        {
            var id = await store.SaveEventAsync(electionId, e, snapshotId, ct);
            return id is null ? null : e with { Id = id.Value };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            StoreFailed(ex, $"evento {e.Type}");
            // O evento continua valendo em memória; a trilha persistida terá a lacuna registrada no alerta.
            return e with { Id = -Interlocked.Increment(ref localEventId) };
        }
    }

    /// <summary>
    /// Pode gravar? Só a líder coordenada (Persist); quem não grava nunca chega ao banco para escrever. Banco
    /// indisponível na partida da líder: a eleição é registrada assim que ele voltar (a ingestão nunca para).
    /// </summary>
    private async Task<bool> StoreReadyAsync(CancellationToken ct)
    {
        if (store is null || !Persist) return false;
        if (electionId > 0) return true;
        var current = hub.Current;
        if (current is null) return false;
        try
        {
            electionId = await store.EnsureElectionAsync(current.Context, ct);
            StoreHealthy = true;
            return true;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            StoreFailed(e, "registro da eleição");
            return false;
        }
    }

    private void Publish(LiveElectionState state, string eventName, object data) =>
        hub.Publish(eventName, hub.Envelope(state, data));

    private async Task NotifyAsync(string kind, long version)
    {
        if (NotifyFollowers is null || !Persist) return;
        try { await NotifyFollowers($"{kind}:{version}"); }
        catch (Exception e) when (e is not OperationCanceledException) { LogWorkerError(logger, "notify", e); }
    }

    /// <summary>Banco fora do ar não interrompe a ingestão; o alerta sai no máximo uma vez por minuto (sem inundar o log).</summary>
    private void StoreFailed(Exception e, string what)
    {
        if (e is LiveLeadershipLostException)
        {
            // Não é falha do banco: outra réplica é a única escritora. A sessão reinicia pelo vigia da liderança.
            if (leadershipAlerted) return;
            leadershipAlerted = true;
            Alert("leadership", $"Gravação de {what} recusada: esta réplica perdeu a liderança; nada mais é gravado por ela.");
            return;
        }
        StoreHealthy = false;
        var now = time.GetUtcNow();
        if (now - lastStoreAlert < TimeSpan.FromMinutes(1)) return;
        lastStoreAlert = now;
        Alert("postgres", $"Falha ao gravar/ler {what}: {e.GetType().Name}");
        LogStoreError(logger, what, e);
    }

    private void Alert(string kind, string detail)
    {
        alerts.Enqueue($"{time.GetUtcNow():O} {kind}: {detail}");
        while (alerts.Count > 50) alerts.TryDequeue(out _);
        LogAlert(logger, kind, detail);
    }

    private static string NameOf(TerritorySnapshot snapshot, string key) =>
        snapshot.Profiles.FirstOrDefault(p => p.Key == key)?.BallotName ?? key;

    private static string StableHash(string text) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text)))[..16].ToLowerInvariant();

    private sealed class ProfileComparer : IEqualityComparer<CandidateProfile>
    {
        public static readonly ProfileComparer Instance = new();

        public bool Equals(CandidateProfile? x, CandidateProfile? y) =>
            x is not null && y is not null && x.Key == y.Key && x.Situation == y.Situation && x.Elected == y.Elected && x.Destination == y.Destination && x.BallotName == y.BallotName;

        public int GetHashCode(CandidateProfile obj) => obj.Key.GetHashCode(StringComparison.Ordinal);
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Apuração: eleição {ElectionCode} (pleito {Pleito}, 1º turno {FirstRound}) descoberta pelo EA11; modo {Mode}, ambiente {Environment}")]
    private static partial void LogDiscovered(ILogger logger, int electionCode, int pleito, int? firstRound, string mode, string environment);

    [LoggerMessage(Level = LogLevel.Information, Message = "{Event} idg={Idg} etag={Etag} sections={SectionsPct} version={Version} changed=true")]
    private static partial void LogNational(ILogger logger, string @event, long? idg, string? etag, decimal? sectionsPct, long version);

    [LoggerMessage(Level = LogLevel.Error, Message = "ALERTA apuração {Alert}: {Detail}")]
    private static partial void LogAlert(ILogger logger, string alert, string detail);

    [LoggerMessage(Level = LogLevel.Error, Message = "Apuração: falha no banco ({What})")]
    private static partial void LogStoreError(ILogger logger, string what, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Apuração: falha no trabalho {Work}")]
    private static partial void LogWorkerError(ILogger logger, string work, Exception exception);
}
