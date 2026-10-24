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

        if (store is not null)
        {
            try
            {
                electionId = await store.EnsureElectionAsync(context, ct);
                StoreHealthy = true;
                var stored = await store.LoadAsync(electionId, ct);
                state = Rehydrate(state, stored);
                foreach (var (url, conditional) in stored.Conditionals) conditionals[url] = conditional;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                StoreFailed(e, "carga inicial");
            }
        }

        paths = builder;
        hub.Replace(state with { Phase = Phase(state) });
        foreach (var warning in discovered.Warnings)
        {
            Alert("discovery_warning", warning);
            await RecordEventAsync(new LiveEvent(0, LiveEventTypes.DiscoveryWarning, "internal", $"discovery-{StableHash(warning)}", "br", "br", null, time.GetUtcNow(), "Divergência entre configuração e EA11", warning, null, new Dictionary<string, object?>()), null, ct);
        }
        LogDiscovered(logger, discovered.ElectionCode, discovered.PleitoCode, discovered.FirstRoundElectionCode, options.Mode, environment.Environment);
    }

    /// <summary>Reconstrói o estado a partir do banco (partida, deploy, réplica seguidora).</summary>
    public static LiveElectionState Rehydrate(LiveElectionState state, StoredLiveState stored)
    {
        var timeline = ImmutableList.CreateBuilder<TimelinePoint>();
        TerritorySnapshot? national = null;
        long version = 0;
        string? lastLeader = null;
        foreach (var (id, snapshot) in stored.NationalHistory)
        {
            version = id;
            national = snapshot;
            timeline.Add(TimelinePoint.From(id, snapshot));
            lastLeader = snapshot.LeaderKey ?? lastLeader;
        }
        var states = ImmutableDictionary.CreateBuilder<string, TerritorySnapshot>(StringComparer.Ordinal);
        var stateTimelines = ImmutableDictionary.CreateBuilder<string, ImmutableList<TimelinePoint>>(StringComparer.Ordinal);
        foreach (var (uf, history) in stored.StateHistories)
        {
            states[uf] = history[^1].Snapshot;
            stateTimelines[uf] = [.. history.Select(h => TimelinePoint.From(h.Id, h.Snapshot))];
        }
        var municipalities = ImmutableDictionary.CreateBuilder<string, TerritorySnapshot>(StringComparer.Ordinal);
        var zones = ImmutableDictionary.CreateBuilder<string, TerritorySnapshot>(StringComparer.Ordinal);
        foreach (var t in stored.Territories)
        {
            if (t.Key.Scope == TerritoryScope.Mu) municipalities[t.Key.Code] = t;
            else if (t.Key.Scope == TerritoryScope.Zona) zones[t.Key.Code] = t;
        }
        var math = MathTracking.Empty;
        var leadChanges = ImmutableList.CreateBuilder<LeadChangeRecord>();
        foreach (var e in stored.Events)
        {
            if (e.Type == LiveEventTypes.MathThreshold) math = math with { RepBrasilDetectedAt = e.DetectedAt };
            if (e.Type == LiveEventTypes.MathematicallyDefined)
            {
                var leader = e.Payload.GetValueOrDefault("leaderKey")?.ToString();
                math = math with
                {
                    TseDefinedAt = e.At,
                    TseSignalDetectedAt = e.DetectedAt,
                    RepBrasilDetectedAt = math.RepBrasilDetectedAt ?? (e.Payload.GetValueOrDefault("repBrasilMathDetectedAt") is { } r && DateTimeOffset.TryParse(r.ToString(), out var parsed) ? parsed : null),
                    Defined = leader is null ? null : DefinedFrom(e, leader, stored),
                };
            }
            if (e.Type == LiveEventTypes.LeadChange && e.Payload.GetValueOrDefault("newLeaderKey")?.ToString() is { } newLeader)
            {
                var snapshotVersion = long.TryParse(e.Payload.GetValueOrDefault("snapshotVersion")?.ToString(), out var v) ? v : 0;
                var at = stored.NationalHistory.FirstOrDefault(h => h.Id == snapshotVersion).Snapshot;
                leadChanges.Add(new LeadChangeRecord(
                    e.Id,
                    e.At,
                    e.DetectedAt,
                    e.Payload.GetValueOrDefault("previousLeaderKey")?.ToString(),
                    newLeader,
                    e.SectionsPct,
                    at?.Candidates ?? [],
                    long.TryParse(e.Payload.GetValueOrDefault("leadVotes")?.ToString(), out var lead) ? lead : null,
                    snapshotVersion));
            }
        }
        return state with
        {
            National = national,
            NationalVersion = version,
            StatesVersion = states.Count,
            States = states.ToImmutable(),
            StateTimelines = stateTimelines.ToImmutable(),
            Municipalities = municipalities.ToImmutable(),
            Zones = zones.ToImmutable(),
            Timeline = timeline.ToImmutable(),
            Events = [.. stored.Events],
            LeadChanges = leadChanges.ToImmutable(),
            Math = math,
            LastLeaderKey = lastLeader,
            Source = national is null ? state.Source : state.Source with { LastChangeAt = national.IngestedAt, LastSuccessAt = national.IngestedAt, LastFileGeneratedAt = national.GeneratedAt },
        };
    }

    private static DefinedSnapshot? DefinedFrom(LiveEvent e, string leader, StoredLiveState stored)
    {
        var snapshot = stored.NationalHistory.Select(h => h.Snapshot).LastOrDefault(s => s.MathFlag == "e") ?? stored.NationalHistory.LastOrDefault().Snapshot;
        var tally = snapshot?.Candidates.FirstOrDefault(c => c.Key == leader);
        return new DefinedSnapshot(leader, tally?.Votes, tally?.Percent, snapshot?.LeadVotes, e.SectionsPct, e.At, e.DetectedAt);
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
        if (response.Status != TseFetchStatus.Ok || response.Body is null) return false;

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
        return await ApplyNationalAsync(snapshot, response.Body, ct);
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
                };
                return updated with { Phase = Phase(updated) };
            });

            metrics.IngestionLagSeconds = snapshot.GeneratedAt is { } g ? Math.Max(0, (snapshot.IngestedAt - g).TotalSeconds) : null;
            Publish(next, "national-update", LiveProjector.NationalUpdate(next));
            if (profilesChanged) Publish(next, "candidate-update", new CandidatesPayloadDto(LiveProjector.Candidates(next)));
            foreach (var e in saved.Where(e => e.IsPublic))
            {
                Publish(next, "timeline-event", LiveProjector.EventDto(e));
                if (e.Type == LiveEventTypes.MathematicallyDefined && next.Math.Defined is { } d)
                    Publish(next, "mathematically-defined", new { @event = LiveProjector.EventDto(e), defined = LiveProjector.Defined(next) });
                if (e.Type == LiveEventTypes.Finalized) Publish(next, "finalized", new { @event = LiveProjector.EventDto(e) });
            }
            if (leadChange is not null)
                Publish(next, "lead-change", LiveProjector.Timeline(next, "br", "br").LeadChanges[^1]);
            await NotifyAsync("national", version);
            LogNational(logger, "national_update", snapshot.GenerationId, snapshot.ETag, snapshot.Sections.TotalizedPct, version);
            return true;
        }
        finally
        {
            processing.Release();
        }
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
        }
        current = hub.Current!;
        file ??= current.NationalAccompaniment;

        // UFs a buscar: EA14 indica totalização mais nova, mudou o nº de seções, ou ainda não temos o arquivo da UF.
        var ufs = current.Context.Ufs.Select(u => u.Uf).ToList();
        if (ufs.Count == 0 && file is not null) ufs = [.. file.Entries.Where(e => e.ScopeType == "uf").Select(e => e.Code)];
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
        var ufs = current.Context.Ufs.Select(u => u.Uf).ToList();
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
        var priority = PriorityMunicipalities(next);
        var ufDemanded = demand.TryGetValue($"uf:{uf}", out var at) && time.GetUtcNow() - at < TimeSpan.FromMinutes(10);
        // Rede de segurança: se o EA15 estiver defasado, municípios prioritários da UF em apuração (EA14) são
        // renovados por tempo, sem depender do dt/ht do EA15.
        var ufInProgress = next.NationalAccompaniment?.Entries.FirstOrDefault(e => e.ScopeType == "uf" && e.Code == uf)?.Progress == "p";
        if (ufInProgress)
        {
            var now = time.GetUtcNow();
            foreach (var municipality in next.Context.Ufs.First(u => u.Uf == uf).Municipalities.Where(m => priority.Contains(m.TseCode)))
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
        if (current.FirstRound?.National is not null && current.FirstRound.States.Count >= current.Context.Ufs.Count()) return;
        var baseline = current.FirstRound ?? FirstRoundBaseline.Empty(code);
        var nationalResponse = await source.FetchAsync(paths.Result(code, options.OfficeCode), null, TsePriority.Background, ct);
        if (nationalResponse is { Status: TseFetchStatus.Ok, Body: not null })
        {
            var parsed = TseParser.ParseEa20(nationalResponse.Body, options.OfficeCode);
            baseline = baseline with { National = TerritorySnapshot.From(parsed, TerritoryKey.National, null, nationalResponse.ReceivedAt, nationalResponse.Body, null, null) };
        }
        foreach (var uf in current.Context.Ufs.Select(u => u.Uf))
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
        if (store is not null)
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

    private LivePhase Phase(LiveElectionState s) =>
        LivePhases.Resolve(new PhaseInput(s.National, s.Source.Stale, s.Source.Failing, time.GetUtcNow(), s.Context.TotalizationStartsAt));

    private void UpdateSource(TseFetchResult response, bool national)
    {
        if (!national || hub.Current is null) return;
        var before = hub.Current;
        var next = hub.Update(s =>
        {
            var src = s.Source;
            src = response.Status switch
            {
                TseFetchStatus.Ok => src with { Healthy = true, ConsecutiveFailures = 0, LastSuccessAt = response.ReceivedAt, LastCheckedAt = response.ReceivedAt, LastChangeAt = response.ReceivedAt, LastError = null, BlockedUntil = null },
                TseFetchStatus.NotModified => src with { Healthy = true, ConsecutiveFailures = 0, LastSuccessAt = response.ReceivedAt, LastCheckedAt = response.ReceivedAt, LastError = null, BlockedUntil = null },
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

    /// <summary>Banco indisponível na partida: a eleição é registrada assim que ele voltar (a ingestão nunca para).</summary>
    private async Task<bool> StoreReadyAsync(CancellationToken ct)
    {
        if (store is null) return false;
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
        if (NotifyFollowers is null) return;
        try { await NotifyFollowers($"{kind}:{version}"); }
        catch (Exception e) when (e is not OperationCanceledException) { LogWorkerError(logger, "notify", e); }
    }

    /// <summary>Banco fora do ar não interrompe a ingestão; o alerta sai no máximo uma vez por minuto (sem inundar o log).</summary>
    private void StoreFailed(Exception e, string what)
    {
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
