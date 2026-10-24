using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Npgsql;
using RepBrasil.API.LiveElection;
using RepBrasil.Application.LiveElection;
using RepBrasil.Infrastructure.LiveElection;
using Xunit.Abstractions;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Apuração longa acelerada contra o PostgreSQL real: cerca de 4 h de totalização (relógio simulado) com milhares de
/// arquivos nacionais novos, líder gravando pela conexão do lock e seguidora lendo por cursor, um assinante SSE em
/// cada réplica. Mede e limita: memória, crescimento do banco, custo da reidratação e da sincronização, linha do
/// tempo servida, tamanho das mensagens SSE e a latência por ciclo do começo ao fim (sem degradação progressiva).
/// </summary>
public sealed class LiveElectionLongRunTests(ITestOutputHelper output)
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static NpgsqlDataSource Db() => NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable)!);

    private sealed record Replica(LiveIngestionEngine Engine, LiveElectionHub Hub, LiveElectionHub.Subscription Listener);

    private static async Task<Replica> ReplicaAsync(ITseSource source, ILiveElectionStore store, LiveElectionOptions options, TimeProvider time, bool persist, string environment)
    {
        var metrics = new LiveElectionMetrics();
        var hub = new LiveElectionHub(options, metrics, time);
        var engine = new LiveIngestionEngine(source, store, hub, options, metrics, time, NullLogger.Instance) { ReplayEnvironment = environment, Persist = persist };
        await engine.InitializeAsync(Ct);
        return new Replica(engine, hub, hub.Subscribe("10.0.0.1", null)!);
    }

    private static (int Frames, int MaxBytes) Drain(Replica replica)
    {
        int frames = 0, max = 0;
        while (replica.Listener.Subscriber.Channel.Reader.TryRead(out var frame))
        {
            frames++;
            max = Math.Max(max, frame.Length);
        }
        return (frames, max);
    }

    private static double Percentile(List<double> values, double p)
    {
        var sorted = values.Order().ToList();
        return sorted[(int)Math.Clamp(Math.Ceiling(p * sorted.Count) - 1, 0, sorted.Count - 1)];
    }

    [ElectoralSchemaFact]
    public async Task Four_hours_of_accelerated_count_keep_memory_database_sync_and_latency_flat()
    {
        // Escala 70 com quadros de 2 s: ~7.300 quadros ≈ 4 h de totalização, um arquivo nacional novo por quadro.
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 10, 25, 19, 50, 0, TimeSpan.Zero));
        var options = new LiveElectionOptions { Enabled = true, Mode = LiveModes.Replay, ReplaySpeed = 1, ReplayStep = TimeSpan.FromSeconds(2) };
        var replay = new ReplaySource(time, options, durationScale: 70);
        var environment = "longrun-" + Guid.NewGuid().ToString("N")[..12];
        var lockKey = BitConverter.ToInt64(Guid.NewGuid().ToByteArray(), 0) & long.MaxValue;
        await using var leaderDb = Db();
        await using var followerDb = Db();
        await using var coordinator = new PgLiveCoordinator(leaderDb, lockKey);
        Assert.True(await coordinator.TryAcquireAsync(Ct));
        var leader = await ReplicaAsync(replay, new PgLiveElectionStore(leaderDb, coordinator), options, time, persist: true, environment);
        await using var followerCoordinator = new PgLiveCoordinator(followerDb, lockKey);
        Assert.False(await followerCoordinator.TryAcquireAsync(Ct));
        var follower = await ReplicaAsync(replay, new PgLiveElectionStore(followerDb, followerCoordinator), options, time, persist: false, environment);
        var codes = leader.Hub.Current!.Context.Config!.Ufs.SelectMany(u => u.Municipalities).Select(m => m.TseCode).ToList();

        var leaderMs = new List<double>();
        var followerMs = new List<double>();
        var syncRows = new List<int>();
        int leaderFrames = 0, followerFrames = 0, maxFrame = 0, firstNationalUpdate = 0, lastNationalUpdate = 0;
        long memoryQuarter = 0;
        var total = replay.FinalFrame + 2;
        for (var frame = 0; frame < total; frame++)
        {
            var watch = Stopwatch.StartNew();
            await leader.Engine.PollNationalAsync(Ct);
            if (frame % 15 == 0) await leader.Engine.PollAccompanimentAsync(Ct);
            if (frame % 5 == 0) await leader.Engine.PollNextStateAccompanimentAsync(Ct);
            if (frame % 30 == 0)
                foreach (var code in codes.Skip(frame / 30 * 10 % codes.Count).Take(10)) await leader.Engine.EnsureMunicipalityAsync(code, Ct);
            await leader.Engine.EvaluateAsync(Ct);
            leaderMs.Add(watch.Elapsed.TotalMilliseconds);

            watch.Restart();
            syncRows.Add(await follower.Engine.SyncFromStoreAsync(Ct));
            await follower.Engine.EvaluateAsync(Ct);
            followerMs.Add(watch.Elapsed.TotalMilliseconds);

            var (lf, lmax) = Drain(leader);
            var (ff, fmax) = Drain(follower);
            leaderFrames += lf;
            followerFrames += ff;
            maxFrame = Math.Max(maxFrame, Math.Max(lmax, fmax));
            if (frame == total / 4)
            {
                memoryQuarter = GC.GetTotalMemory(forceFullCollection: true);
                firstNationalUpdate = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(LiveProjector.NationalUpdate(leader.Hub.Current!), LiveElectionHub.Json));
            }
            time.Advance(TimeSpan.FromSeconds(2));
        }
        var memoryEnd = GC.GetTotalMemory(forceFullCollection: true);
        var l = leader.Hub.Current!;
        var f = follower.Hub.Current!;
        lastNationalUpdate = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(LiveProjector.NationalUpdate(l), LiveElectionHub.Json));
        var timelineBytes = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(LiveProjector.Timeline(l, "br", "br"), LiveElectionHub.Json));

        // Reidratação de uma réplica nova a partir de todo o histórico (deploy no meio da apuração).
        var rehydrate = Stopwatch.StartNew();
        await using var freshDb = Db();
        var fresh = await ReplicaAsync(replay, new PgLiveElectionStore(freshDb), options, time, persist: false, environment);
        var rehydrateMs = rehydrate.Elapsed.TotalMilliseconds;

        long databaseBytes;
        long snapshotRows;
        // Bytes gravados por esta execução (linhas da eleição dela), sem contar o que outras execuções deixaram no banco.
        await using (var size = leaderDb.CreateCommand("""
            WITH run AS (SELECT id FROM electoral.live_election WHERE environment = $1)
            SELECT (SELECT count(*) FROM electoral.live_snapshot WHERE election_id IN (SELECT id FROM run)),
                   (SELECT coalesce(sum(pg_column_size(s.*)), 0) FROM electoral.live_snapshot s WHERE election_id IN (SELECT id FROM run))
                 + (SELECT coalesce(sum(pg_column_size(e.*)), 0) FROM electoral.live_event e WHERE election_id IN (SELECT id FROM run))
                 + (SELECT coalesce(sum(pg_column_size(t.*)), 0) FROM electoral.live_territory_latest t WHERE election_id IN (SELECT id FROM run))
                 + (SELECT coalesce(sum(pg_column_size(a.*)), 0) FROM electoral.live_accompaniment a WHERE election_id IN (SELECT id FROM run))
            """))
        {
            size.Parameters.AddWithValue(environment);
            await using var reader = await size.ExecuteReaderAsync(Ct);
            await reader.ReadAsync(Ct);
            snapshotRows = reader.GetInt64(0);
            databaseBytes = reader.GetInt64(1);
        }

        var quarter = leaderMs.Count / 4;
        var leaderEarly = Percentile(leaderMs.Skip(quarter / 4).Take(quarter).ToList(), 0.5);
        var leaderLate = Percentile(leaderMs.Skip(leaderMs.Count - quarter).ToList(), 0.5);
        var followerEarly = Percentile(followerMs.Skip(quarter / 4).Take(quarter).ToList(), 0.5);
        var followerLate = Percentile(followerMs.Skip(followerMs.Count - quarter).ToList(), 0.5);
        var simulated = TimeSpan.FromSeconds(2 * total);
        output.WriteLine($"apuração simulada: {simulated.TotalHours:0.00} h; quadros {total}; mudanças nacionais {l.Timeline.Count}; snapshots gravados {snapshotRows}");
        output.WriteLine($"ciclo da líder (mediana): {leaderEarly:0.00} ms no começo, {leaderLate:0.00} ms no fim; p95 geral {Percentile(leaderMs, 0.95):0.00} ms");
        output.WriteLine($"sincronização da seguidora (mediana): {followerEarly:0.00} ms no começo, {followerLate:0.00} ms no fim; linhas por sincronização: máx {syncRows.Max()}, média {syncRows.Average():0.0}");
        output.WriteLine($"memória gerenciada: {memoryQuarter / 1048576.0:0.0} MB a 25%, {memoryEnd / 1048576.0:0.0} MB no fim");
        output.WriteLine($"banco (linhas desta execução): {databaseBytes / 1048576.0:0.0} MB, {databaseBytes / Math.Max(1, snapshotRows) / 1024.0:0.0} KB por snapshot; reidratação completa: {rehydrateMs:0} ms");
        output.WriteLine($"SSE: {leaderFrames} mensagens na líder, {followerFrames} na seguidora, maior {maxFrame} bytes; national-update {firstNationalUpdate} → {lastNationalUpdate} bytes; linha do tempo servida {timelineBytes} bytes");

        Assert.True(simulated >= TimeSpan.FromHours(4), $"simulou {simulated}");
        Assert.True(l.Timeline.Count >= 5_000, $"{l.Timeline.Count} mudanças nacionais");
        Assert.Equal(LivePhase.FINAL, l.Phase);
        // Seguidora igual à líder no fim, lendo só o que mudou a cada ciclo.
        Assert.Equal(l.Phase, f.Phase);
        Assert.Equal(l.NationalVersion, f.NationalVersion);
        Assert.Equal(l.Timeline.Count, f.Timeline.Count);
        Assert.Equal(l.States.Keys.Order(), f.States.Keys.Order());
        Assert.Equal(l.Math.Defined, f.Math.Defined);
        Assert.Equal(l.LeadChanges.Select(c => c.Id), f.LeadChanges.Select(c => c.Id));
        Assert.True(syncRows.Max() <= 64, $"máximo de {syncRows.Max()} linhas numa sincronização");
        Assert.True(syncRows.Sum() <= snapshotRows + (4L * syncRows.Count), $"lidas {syncRows.Sum()} linhas para {snapshotRows} snapshots");
        // Sem degradação progressiva: o fim custa o mesmo que o começo (folga para ruído de máquina).
        Assert.True(leaderLate <= (leaderEarly * 3) + 5, $"ciclo da líder: {leaderEarly:0.00} → {leaderLate:0.00} ms");
        Assert.True(followerLate <= (followerEarly * 3) + 5, $"sincronização: {followerEarly:0.00} → {followerLate:0.00} ms");
        // Memória e mensagens limitadas.
        Assert.True(memoryEnd - memoryQuarter < 256L * 1024 * 1024, $"memória cresceu {(memoryEnd - memoryQuarter) / 1048576.0:0.0} MB");
        Assert.True(lastNationalUpdate <= (firstNationalUpdate * 2) + 1024, "national-update cresceu com o histórico");
        Assert.True(timelineBytes < 256 * 1024, $"linha do tempo servida com {timelineBytes} bytes");
        Assert.Equal(1, leader.Hub.Subscribers);
        Assert.Equal(1, follower.Hub.Subscribers);
        // Partida de uma réplica nova com todo o histórico: estado igual, em tempo de deploy.
        Assert.Equal(l.NationalVersion, fresh.Hub.Current!.NationalVersion);
        Assert.Equal(l.Math.Defined, fresh.Hub.Current.Math.Defined);
        Assert.True(rehydrateMs < 30_000, $"reidratação levou {rehydrateMs:0} ms");
        Assert.True(databaseBytes < 1024L * 1024 * 1024, $"{databaseBytes / 1048576.0:0.0} MB gravados");
    }
}
