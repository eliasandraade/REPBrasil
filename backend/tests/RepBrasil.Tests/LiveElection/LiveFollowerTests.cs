using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RepBrasil.API.LiveElection;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Tests.LiveElection;

/// <summary>
/// Réplicas: a seguidora lê só o que a líder gravou depois do cursor e termina igual à líder; quem não lidera nunca
/// grava; a "última mudança" da fonte é a do conteúdo, não a da resposta HTTP.
/// </summary>
public sealed class LiveFollowerTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateTimeOffset T0 = new(2026, 10, 25, 20, 0, 0, TimeSpan.Zero);

    private static readonly LiveElectionOptions Options = new()
    {
        Enabled = true,
        Mode = LiveModes.Replay,
        ReplaySpeed = 1,
        ReplayStep = TimeSpan.FromSeconds(10),
    };

    private sealed record Replica(LiveIngestionEngine Engine, LiveElectionHub Hub);

    private static async Task<Replica> ReplicaAsync(ITseSource source, ILiveElectionStore? store, LiveElectionOptions options, TimeProvider time, bool persist, string environment)
    {
        var metrics = new LiveElectionMetrics();
        var hub = new LiveElectionHub(options, metrics, time);
        var engine = new LiveIngestionEngine(source, store, hub, options, metrics, time, NullLogger.Instance) { ReplayEnvironment = environment, Persist = persist };
        await engine.InitializeAsync(Ct);
        return new Replica(engine, hub);
    }

    private static async Task TickLeaderAsync(LiveIngestionEngine leader, int frame, int accompanimentEvery = 3)
    {
        await leader.PollNationalAsync(Ct);
        if (frame % accompanimentEvery == 0) await leader.PollAccompanimentAsync(Ct);
        await leader.PollNextStateAccompanimentAsync(Ct);
        await leader.EvaluateAsync(Ct);
    }

    private static List<string> Drain(LiveElectionHub.Subscription listener)
    {
        var names = new List<string>();
        while (listener.Subscriber.Channel.Reader.TryRead(out var frame))
        {
            var text = Encoding.UTF8.GetString(frame);
            var start = text.IndexOf("event: ", StringComparison.Ordinal) + "event: ".Length;
            names.Add(text[start..text.IndexOf('\n', start)]);
        }
        return names;
    }

    /// <summary>Encaminha tudo e conta as gravações tentadas (quem não lidera não pode tentar nenhuma).</summary>
    private sealed class WriteCountingStore(ILiveElectionStore inner) : ILiveElectionStore
    {
        public int WriteAttempts;

        public Task<int> EnsureElectionAsync(LiveElectionContext context, CancellationToken ct) { WriteAttempts++; return inner.EnsureElectionAsync(context, ct); }
        public Task<int?> FindElectionAsync(LiveElectionContext context, CancellationToken ct) => inner.FindElectionAsync(context, ct);
        public Task<long?> SaveSnapshotAsync(int electionId, TerritorySnapshot snapshot, ReadOnlyMemory<byte>? raw, CancellationToken ct) { WriteAttempts++; return inner.SaveSnapshotAsync(electionId, snapshot, raw, ct); }
        public Task SaveTerritoryLatestAsync(int electionId, TerritorySnapshot snapshot, CancellationToken ct) { WriteAttempts++; return inner.SaveTerritoryLatestAsync(electionId, snapshot, ct); }
        public Task SaveAccompanimentAsync(int electionId, string scope, AccompanimentFile file, string contentHash, DateTimeOffset ingestedAt, CancellationToken ct) { WriteAttempts++; return inner.SaveAccompanimentAsync(electionId, scope, file, contentHash, ingestedAt, ct); }
        public Task SaveSourceHealthAsync(int electionId, SourceHealth health, CancellationToken ct) { WriteAttempts++; return inner.SaveSourceHealthAsync(electionId, health, ct); }
        public Task<long?> SaveEventAsync(int electionId, LiveEvent liveEvent, long? snapshotId, CancellationToken ct) { WriteAttempts++; return inner.SaveEventAsync(electionId, liveEvent, snapshotId, ct); }
        public Task SaveSourceStateAsync(int electionId, string url, TseConditional conditional, int httpStatus, DateTimeOffset at, bool changed, CancellationToken ct) { WriteAttempts++; return inner.SaveSourceStateAsync(electionId, url, conditional, httpStatus, at, changed, ct); }
        public Task<StoredChanges> LoadChangesAsync(int electionId, LiveCursor after, int limit, CancellationToken ct) => inner.LoadChangesAsync(electionId, after, limit, ct);
        public Task<IReadOnlyDictionary<string, TseConditional>> LoadConditionalsAsync(int electionId, CancellationToken ct) => inner.LoadConditionalsAsync(electionId, ct);
        public Task<(byte[] Content, string ContentType)?> LoadPhotoAsync(string sqcand, CancellationToken ct) => inner.LoadPhotoAsync(sqcand, ct);
        public Task SavePhotoAsync(string sqcand, byte[] content, string contentType, string? etag, string sourceUrl, CancellationToken ct) { WriteAttempts++; return inner.SavePhotoAsync(sqcand, content, contentType, etag, sourceUrl, ct); }
        public Task<bool> PingAsync(CancellationToken ct) => inner.PingAsync(ct);
    }

    private sealed class CountingSource(ITseSource inner) : ITseSource
    {
        public int Requests;

        public Task<TseFetchResult> FetchAsync(Uri url, TseConditional? conditional, TsePriority priority, CancellationToken ct)
        {
            Interlocked.Increment(ref Requests);
            return inner.FetchAsync(url, conditional, priority, ct);
        }
    }

    // ------------------------------------------------------------ LastCheckedAt / LastSuccessAt / LastChangeAt

    /// <summary>Arquivo nacional roteirizado (o resto vem do replay): cada chamada serve o próximo corpo da fila.</summary>
    private sealed class ScriptedNational(ITseSource inner, TimeProvider time) : ITseSource
    {
        public Queue<byte[]> Next { get; } = new();

        public Task<TseFetchResult> FetchAsync(Uri url, TseConditional? conditional, TsePriority priority, CancellationToken ct)
        {
            if (!url.AbsolutePath.EndsWith($"/br-c0001-e{SyntheticScenario.SecondRound:D6}-u.json", StringComparison.Ordinal))
                return inner.FetchAsync(url, conditional, priority, ct);
            var body = Next.Dequeue();
            var etag = SyntheticScenario.ETagOf(body);
            return Task.FromResult(new TseFetchResult(TseFetchStatus.Ok, 200, body, etag, null, TimeSpan.Zero, null, time.GetUtcNow()));
        }
    }

    [Fact]
    public async Task Repeated_200_with_the_same_content_advances_checks_but_not_the_last_change()
    {
        var time = new FakeTimeProvider(T0);
        var replay = new ReplaySource(time, Options);
        var source = new ScriptedNational(replay, time);
        var leader = await ReplicaAsync(source, null, Options, time, persist: true, replay.EnvironmentName);
        var a = TseFixtures.AtProgress(0.4);
        // Mesmo conteúdo em três gerações do TSE (idg/dg/hg diferentes → corpo e ETag diferentes, 200 todas as vezes).
        source.Next.Enqueue(TseFixtures.Ea20(a with { Idg = 1, GeneratedAt = "25/10/2026 18:00:05" }));
        source.Next.Enqueue(TseFixtures.Ea20(a with { Idg = 2, GeneratedAt = "25/10/2026 18:01:05" }));
        source.Next.Enqueue(TseFixtures.Ea20(a with { Idg = 3, GeneratedAt = "25/10/2026 18:02:05" }));

        Assert.True(await leader.Engine.PollNationalAsync(Ct));
        var firstChange = time.GetUtcNow();
        Assert.Equal(firstChange, leader.Hub.Current!.Source.LastChangeAt);
        for (var i = 0; i < 2; i++)
        {
            time.Advance(TimeSpan.FromMinutes(1));
            Assert.False(await leader.Engine.PollNationalAsync(Ct)); // 200 com o mesmo conteúdo: nada novo
            var src = leader.Hub.Current!.Source;
            Assert.Equal(firstChange, src.LastChangeAt);
            Assert.Equal(time.GetUtcNow(), src.LastSuccessAt);
            Assert.Equal(time.GetUtcNow(), src.LastCheckedAt);
        }

        // Conteúdo parado por mais que StaleAfter (5 min) com 200 chegando: defasado, mesmo com a fonte respondendo.
        source.Next.Enqueue(TseFixtures.Ea20(a with { Idg = 4, GeneratedAt = "25/10/2026 18:07:05" }));
        time.Advance(TimeSpan.FromMinutes(5));
        await leader.Engine.PollNationalAsync(Ct);
        await leader.Engine.EvaluateAsync(Ct);
        Assert.Equal(firstChange, leader.Hub.Current!.Source.LastChangeAt);
        Assert.True(leader.Hub.Current.Source.Stale);
        Assert.Equal(LivePhase.LIVE_STALE, leader.Hub.Current.Phase);

        // 200 B: conteúdo novo → a última mudança avança e a defasagem some.
        source.Next.Enqueue(TseFixtures.Ea20(TseFixtures.AtProgress(0.5) with { Idg = 5, GeneratedAt = "25/10/2026 18:08:05" }));
        time.Advance(TimeSpan.FromMinutes(1));
        Assert.True(await leader.Engine.PollNationalAsync(Ct));
        await leader.Engine.EvaluateAsync(Ct);
        Assert.Equal(time.GetUtcNow(), leader.Hub.Current!.Source.LastChangeAt);
        Assert.False(leader.Hub.Current.Source.Stale);
        Assert.Equal(LivePhase.LIVE, leader.Hub.Current.Phase);
    }

    // ------------------------------------------------------------ seguidora incremental

    [Fact]
    public async Task Follower_reads_only_what_changed_publishes_the_same_events_and_ends_equal_to_the_leader()
    {
        var time = new FakeTimeProvider(T0);
        var replay = new ReplaySource(time, Options);
        var store = new InMemoryLiveStore();
        var leader = await ReplicaAsync(replay, store, Options, time, persist: true, replay.EnvironmentName);
        var followerSource = new CountingSource(replay);
        var followerStore = new WriteCountingStore(store);
        var follower = await ReplicaAsync(followerSource, followerStore, Options, time, persist: false, replay.EnvironmentName);
        var listener = follower.Hub.Subscribe("10.0.0.1", null)!;
        var published = new HashSet<string>(StringComparer.Ordinal);
        var municipalities = leader.Hub.Current!.Context.Config!.Ufs.SelectMany(u => u.Municipalities).Select(m => m.TseCode).ToList();

        for (var frame = 0; frame <= replay.FinalFrame + 1; frame++)
        {
            await TickLeaderAsync(leader.Engine, frame);
            if (frame % 20 == 0)
                foreach (var code in municipalities.Skip(frame / 20 * 3 % municipalities.Count).Take(3)) await leader.Engine.EnsureMunicipalityAsync(code, Ct);
            await follower.Engine.SyncFromStoreAsync(Ct);
            await follower.Engine.EvaluateAsync(Ct);
            published.UnionWith(Drain(listener));
            time.Advance(TimeSpan.FromSeconds(10));
        }

        var l = leader.Hub.Current!;
        var f = follower.Hub.Current!;
        Assert.Equal(LivePhase.FINAL, l.Phase);
        Assert.Equal(l.Phase, f.Phase);
        Assert.Equal(l.NationalVersion, f.NationalVersion);
        Assert.Equal(l.National!.ContentHash, f.National!.ContentHash);
        Assert.Equal(l.Timeline.Select(p => p.Version), f.Timeline.Select(p => p.Version));
        Assert.Equal(l.States.ToDictionary(kv => kv.Key, kv => kv.Value.ContentHash), f.States.ToDictionary(kv => kv.Key, kv => kv.Value.ContentHash));
        Assert.Equal(l.StateTimelines.ToDictionary(kv => kv.Key, kv => kv.Value.Count), f.StateTimelines.ToDictionary(kv => kv.Key, kv => kv.Value.Count));
        Assert.Equal(l.Municipalities.Keys.Order(), f.Municipalities.Keys.Order());
        Assert.Equal(l.Events.Where(e => e.IsPublic).Select(e => (e.Id, e.Type)), f.Events.Where(e => e.IsPublic).Select(e => (e.Id, e.Type)));
        Assert.Equal(l.LeadChanges.Select(c => (c.Id, c.NewLeaderKey, c.LeadVotes, c.Votes.Count)), f.LeadChanges.Select(c => (c.Id, c.NewLeaderKey, c.LeadVotes, c.Votes.Count)));
        Assert.Equal(l.Math.TseDefinedAt, f.Math.TseDefinedAt);
        Assert.Equal(l.Math.RepBrasilDetectedAt, f.Math.RepBrasilDetectedAt);
        Assert.Equal(l.Math.Defined, f.Math.Defined);
        // EA14/EA15 vêm do banco: cobertura, votos restantes e maiores eleitorados iguais aos da líder.
        Assert.NotNull(f.NationalAccompaniment);
        Assert.Equal(l.StateAccompaniment.Keys.Order(), f.StateAccompaniment.Keys.Order());
        Assert.Equal(LiveProjector.Largest(l, 10).Items.Select(i => i.Code), LiveProjector.Largest(f, 10).Items.Select(i => i.Code));
        Assert.Equal(LiveProjector.Remaining(l), LiveProjector.Remaining(f));
        // O stream da seguidora entrega os mesmos tipos de evento que o da líder.
        Assert.Superset(new HashSet<string> { "national-update", "state-update", "candidate-update", "timeline-event", "lead-change", "mathematically-defined", "finalized" }, published);
        // A seguidora não gravou nada e só pediu ao TSE o EA11 e o EA12 (descoberta).
        Assert.Equal(0, followerStore.WriteAttempts);
        Assert.Equal(2, followerSource.Requests);
    }

    [Fact]
    public async Task Follower_sync_cost_follows_what_changed_not_the_size_of_the_history()
    {
        var time = new FakeTimeProvider(T0);
        var options = Options with { ReplayStep = TimeSpan.FromSeconds(2) };
        // Escala 20: ~2 mil quadros, cada um com um arquivo nacional novo, e milhares de snapshots de UF.
        var replay = new ReplaySource(time, options, durationScale: 20);
        var store = new InMemoryLiveStore();
        var leader = await ReplicaAsync(replay, store, options, time, persist: true, replay.EnvironmentName);
        var follower = await ReplicaAsync(replay, store, options, time, persist: false, replay.EnvironmentName);
        var history = new List<int>();
        var perSync = new List<int>();
        for (var frame = 0; frame <= replay.FinalFrame + 1; frame++)
        {
            await TickLeaderAsync(leader.Engine, frame);
            perSync.Add(await follower.Engine.SyncFromStoreAsync(Ct));
            history.Add(store.SnapshotRows);
            time.Advance(TimeSpan.FromSeconds(2));
        }

        Assert.True(store.SnapshotRows > 5_000, $"histórico de {store.SnapshotRows} snapshots");
        Assert.True(leader.Hub.Current!.Timeline.Count > 1_500, $"{leader.Hub.Current.Timeline.Count} mudanças nacionais");
        // Por sincronização: no máximo um nacional, as UFs que mudaram, eventos, acompanhamento e saúde da fonte.
        Assert.True(perSync.Max() <= 64, $"máximo de {perSync.Max()} linhas numa sincronização");
        // Linha lida uma única vez: o total lido nunca passa do que foi gravado (recarregar o histórico seria quadrático).
        var written = store.SnapshotRows;
        Assert.True(perSync.Sum() <= written + 4 * perSync.Count, $"lidas {perSync.Sum()} para {written} snapshots gravados");
        var lastQuarter = perSync.Skip(perSync.Count * 3 / 4).Average();
        var firstQuarter = perSync.Take(perSync.Count / 4).Average();
        Assert.True(lastQuarter <= firstQuarter * 2 + 5, $"média de linhas por sincronização: {firstQuarter:0.0} no início, {lastQuarter:0.0} no fim");
        Assert.Equal(leader.Hub.Current.NationalVersion, follower.Hub.Current!.NationalVersion);
    }

    // ------------------------------------------------------------ quem não lidera não grava

    [Fact]
    public async Task Replica_without_leadership_ingests_in_memory_and_never_writes()
    {
        var time = new FakeTimeProvider(T0);
        var replay = new ReplaySource(time, Options);
        var store = new WriteCountingStore(new InMemoryLiveStore());
        // Sessão sem coordenação (banco fora na partida): ingere do TSE, serve da memória, não grava.
        var uncoordinated = await ReplicaAsync(replay, store, Options, time, persist: false, replay.EnvironmentName);
        for (var frame = 0; frame < 40; frame++)
        {
            await TickLeaderAsync(uncoordinated.Engine, frame);
            time.Advance(TimeSpan.FromSeconds(10));
        }
        Assert.True(uncoordinated.Hub.Current!.NationalVersion > 10);
        Assert.Contains(uncoordinated.Hub.Current.Phase, new[] { LivePhase.LIVE, LivePhase.MATHEMATICALLY_DEFINED });
        Assert.Equal(0, store.WriteAttempts);
    }

    [Fact]
    public async Task Leader_that_loses_the_lock_keeps_serving_but_every_write_is_refused()
    {
        var time = new FakeTimeProvider(T0);
        var replay = new ReplaySource(time, Options);
        var store = new InMemoryLiveStore();
        var leader = await ReplicaAsync(replay, store, Options, time, persist: true, replay.EnvironmentName);
        for (var frame = 0; frame < 20; frame++)
        {
            await TickLeaderAsync(leader.Engine, frame);
            time.Advance(TimeSpan.FromSeconds(10));
        }
        var rows = store.SnapshotRows;
        var writes = store.Writes;
        store.CanWrite = () => false; // a conexão do lock caiu: a guarda recusa
        for (var frame = 20; frame < 40; frame++)
        {
            await TickLeaderAsync(leader.Engine, frame);
            time.Advance(TimeSpan.FromSeconds(10));
        }
        Assert.Equal(rows, store.SnapshotRows);
        Assert.Equal(writes, store.Writes);
        Assert.True(store.RefusedWrites > 0);
        Assert.Single(leader.Engine.RecentAlerts, a => a.Contains("leadership", StringComparison.Ordinal));
        Assert.True(leader.Hub.Current!.NationalVersion > 0);
    }

    /// <summary>
    /// Queda do banco no meio da apuração, com o md=e oficial acontecendo durante a queda: a sessão sem coordenação
    /// continua do estado em memória (versões nunca voltam, clientes conectados seguem atualizando) e não grava; quando
    /// o banco volta, a líder nova grava o nacional mais novo visto e o md=e uma vez, e os clientes aceitam o estado
    /// (versão maior ou nova época com snapshot).
    /// </summary>
    [Fact]
    public async Task Database_outage_keeps_versions_monotonic_and_recovery_records_the_missed_transition_once()
    {
        var time = new FakeTimeProvider(T0);
        var replay = new ReplaySource(time, Options);
        var store = new InMemoryLiveStore();
        var metrics = new LiveElectionMetrics();
        var hub = new LiveElectionHub(Options, metrics, time);
        LiveIngestionEngine Engine(bool persist) => new(replay, store, hub, Options, metrics, time, NullLogger.Instance) { ReplayEnvironment = replay.EnvironmentName, Persist = persist };
        var listener = hub.Subscribe("10.0.0.9", null)!;
        var definition = replay.OfficialDefinitionFrame!.Value;

        var leader = Engine(persist: true);
        await leader.InitializeAsync(Ct);
        var frame = 0;
        for (; frame < definition - 4; frame++)
        {
            await TickLeaderAsync(leader, frame);
            Drain(listener); // um visitante conectado lê o stream continuamente
            time.Advance(TimeSpan.FromSeconds(10));
        }
        var servedBefore = hub.Current!.NationalVersion;
        var rowsBefore = store.SnapshotRows;
        var boot = hub.BootId;

        // Banco cai: a sessão sem coordenação parte do que já era servido e segue ingerindo, sem gravar.
        store.Down = true;
        var uncoordinated = Engine(persist: false);
        await uncoordinated.InitializeAsync(Ct);
        Assert.Equal(servedBefore, hub.Current!.NationalVersion);
        var served = new List<long>();
        for (; frame < definition + 4; frame++)
        {
            await TickLeaderAsync(uncoordinated, frame);
            served.Add(hub.Current!.NationalVersion);
            Drain(listener);
            time.Advance(TimeSpan.FromSeconds(10));
        }
        Assert.Equal(served.Order(), served);
        Assert.True(served[^1] > servedBefore);
        Assert.Equal(LivePhase.MATHEMATICALLY_DEFINED, hub.Current!.Phase);
        Assert.Equal(boot, hub.BootId);
        Assert.Equal(rowsBefore, store.SnapshotRows);
        var seen = hub.Current.National!;
        Assert.Equal(1, hub.Subscribers);

        // Banco volta: líder nova carrega do banco, grava o mais novo visto em memória e o md=e (uma vez).
        store.Down = false;
        var recovered = Engine(persist: true);
        await recovered.InitializeAsync(Ct);
        var state = hub.Current!;
        Assert.Equal(seen.ContentHash, state.National!.ContentHash);
        Assert.Equal(LivePhase.MATHEMATICALLY_DEFINED, state.Phase);
        Assert.True(state.NationalVersion > served[^1] || hub.BootId != boot, "o cliente descartaria o estado recuperado");
        var names = Drain(listener);
        if (hub.BootId != boot) Assert.Contains("snapshot", names);
        var id = (await store.FindElectionAsync(state.Context, Ct))!.Value;
        var all = await store.LoadChangesAsync(id, LiveCursor.Start, 100_000, Ct);
        var mdE = Assert.Single(all.Events, e => e.Event.Type == LiveEventTypes.MathematicallyDefined);
        Assert.Equal(seen.ContentHash, all.Snapshots.Single(s => s.Id == mdE.SnapshotId).Snapshot.ContentHash);

        // E segue normalmente: o próximo arquivo nacional entra com versão maior.
        await TickLeaderAsync(recovered, frame);
        Assert.True(hub.Current!.NationalVersion >= state.NationalVersion);
    }

    // ------------------------------------------------------------ aplicação idempotente

    [Fact]
    public async Task Apply_is_idempotent_and_a_resumed_cursor_reads_nothing_twice()
    {
        var time = new FakeTimeProvider(T0);
        var replay = new ReplaySource(time, Options);
        var store = new InMemoryLiveStore();
        var leader = await ReplicaAsync(replay, store, Options, time, persist: true, replay.EnvironmentName);
        for (var frame = 0; frame < 60; frame++)
        {
            await TickLeaderAsync(leader.Engine, frame);
            time.Advance(TimeSpan.FromSeconds(10));
        }
        var id = (await store.FindElectionAsync(leader.Hub.Current!.Context, Ct))!.Value;
        var all = await store.LoadChangesAsync(id, LiveCursor.Start, 100_000, Ct);
        var initial = LiveElectionState.Initial(leader.Hub.Current.Context);
        var once = LiveIngestionEngine.Apply(initial, all, adoptSourceHealth: true).State;
        var twice = LiveIngestionEngine.Apply(once, all, adoptSourceHealth: true);
        Assert.Equal(once.NationalVersion, twice.State.NationalVersion);
        Assert.Equal(once.Timeline.Count, twice.State.Timeline.Count);
        Assert.Equal(once.Events.Count, twice.State.Events.Count);
        Assert.Empty(twice.NewEvents);
        Assert.False(twice.NationalChanged);
        Assert.Equal(0, (await store.LoadChangesAsync(id, all.Cursor, 100_000, Ct)).Rows);

        // Em páginas pequenas o resultado é o mesmo da leitura de uma vez.
        var paged = initial;
        var cursor = LiveCursor.Start;
        StoredChanges page;
        do
        {
            page = await store.LoadChangesAsync(id, cursor, 7, Ct);
            paged = LiveIngestionEngine.Apply(paged, page, adoptSourceHealth: true).State;
            cursor = page.Cursor;
        }
        while (page.More);
        Assert.Equal(once.NationalVersion, paged.NationalVersion);
        Assert.Equal(once.LeadChanges.Select(c => (c.Id, c.Votes.Count)), paged.LeadChanges.Select(c => (c.Id, c.Votes.Count)));
        Assert.Equal(once.States.Keys.Order(), paged.States.Keys.Order());
    }
}
