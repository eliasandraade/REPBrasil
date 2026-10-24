using Npgsql;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;
using RepBrasil.Infrastructure.LiveElection;
using RepBrasil.Tests.LiveElection;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Coordenação entre réplicas contra o PostgreSQL real: só a sessão que detém o advisory lock grava. Cada teste usa
/// uma chave de lock própria (não disputa com outra execução nem com uma API local ligada ao mesmo banco).
/// </summary>
public sealed class LiveElectionCoordinationTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static NpgsqlDataSource Db() => NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable)!);

    private static long LockKey() => BitConverter.ToInt64(Guid.NewGuid().ToByteArray(), 0) & long.MaxValue;

    private static LiveElectionContext Context() => new(
        LiveModes.Replay,
        TseEnvironment.Replay("ele2026", "coord-" + Guid.NewGuid().ToString("N")[..12]),
        new DiscoveredElection("ele2026", 9102, new DateOnly(2026, 10, 25), TseFixtures.Election, "Teste", 2, 1, "Presidente", 9001, 9101, []),
        2026,
        null,
        null);

    private static TerritorySnapshot Snapshot(double progress, string replica) =>
        TseFixtures.Snapshot(TseFixtures.AtProgress(progress)) with { ETag = replica };

    private static async Task<bool> AcquireAsync(PgLiveCoordinator coordinator)
    {
        // O servidor solta o lock quando a sessão termina (assíncrono ao pg_terminate_backend): espera até 10 s.
        for (var i = 0; i < 100; i++)
        {
            if (await coordinator.TryAcquireAsync(Ct)) return true;
            await Task.Delay(100);
        }
        return false;
    }

    [ElectoralSchemaFact]
    public async Task Only_the_lock_holder_writes_and_a_dead_lock_session_writes_nothing_more()
    {
        var key = LockKey();
        await using var dbA = Db();
        await using var dbB = Db();
        await using var a = new PgLiveCoordinator(dbA, key);
        await using var b = new PgLiveCoordinator(dbB, key);
        var storeA = new PgLiveElectionStore(dbA, a);
        var storeB = new PgLiveElectionStore(dbB, b);
        var id = await storeA.EnsureElectionAsync(Context(), Ct);

        // Ninguém lidera: ninguém grava.
        await Assert.ThrowsAsync<LiveLeadershipLostException>(() => storeA.SaveSnapshotAsync(id, Snapshot(0.30, "a"), null, Ct));
        Assert.True(await a.TryAcquireAsync(Ct));
        Assert.False(await b.TryAcquireAsync(Ct));
        Assert.NotNull(await storeA.SaveSnapshotAsync(id, Snapshot(0.31, "a"), null, Ct));
        await Assert.ThrowsAsync<LiveLeadershipLostException>(() => storeB.SaveSnapshotAsync(id, Snapshot(0.32, "b"), null, Ct));
        await Assert.ThrowsAsync<LiveLeadershipLostException>(() => storeB.SaveEventAsync(id, Event("md-e"), null, Ct));

        // A sessão do lock morre (queda de rede, reinício do banco): o servidor solta o lock e A não grava mais nada.
        await using (var kill = dbB.CreateCommand("SELECT pg_terminate_backend($1)"))
        {
            kill.Parameters.AddWithValue(a.LeaderProcessId!.Value);
            Assert.Equal(true, await kill.ExecuteScalarAsync(Ct));
        }
        await Assert.ThrowsAsync<LiveLeadershipLostException>(() => storeA.SaveSnapshotAsync(id, Snapshot(0.33, "a"), null, Ct));
        Assert.False(a.IsLeader);
        Assert.True(await AcquireAsync(b));
        Assert.NotNull(await storeB.SaveSnapshotAsync(id, Snapshot(0.34, "b"), null, Ct));
        await Assert.ThrowsAsync<LiveLeadershipLostException>(() => storeA.SaveSnapshotAsync(id, Snapshot(0.35, "a"), null, Ct));

        var rows = await storeB.LoadChangesAsync(id, LiveCursor.Start, 100, Ct);
        Assert.Equal(["a", "b"], rows.Snapshots.Select(s => s.Snapshot.ETag));
        Assert.Empty(rows.Events);
    }

    private static readonly TerritorySnapshot Municipality = TseFixtures.Snapshot(TseFixtures.AtProgress(0.4) with { Scope = "mu", Code = "71072" });

    private static LiveEvent Event(string dedupe) =>
        new(0, LiveEventTypes.LeadChange, "public", dedupe, "br", "br", null, DateTimeOffset.UtcNow, "Mudança de liderança", null, 50m, new Dictionary<string, object?>());

    /// <summary>
    /// O banco volta e duas réplicas que ingeriam sem coordenação (com as mesmas transições em memória) disputam a
    /// liderança e tentam gravar ao mesmo tempo — inclusive gravações sem checar a liderança antes. Em todas as rodadas,
    /// exatamente uma obtém o lock e só as linhas dela existem; nenhuma transição fica duplicada.
    /// </summary>
    [ElectoralSchemaFact]
    public async Task Replicas_racing_after_recovery_never_both_persist()
    {
        for (var round = 0; round < 10; round++)
        {
            var key = LockKey();
            await using var dbA = Db();
            await using var dbB = Db();
            await using var a = new PgLiveCoordinator(dbA, key);
            await using var b = new PgLiveCoordinator(dbB, key);
            var storeA = new PgLiveElectionStore(dbA, a);
            var storeB = new PgLiveElectionStore(dbB, b);
            var id = await storeA.EnsureElectionAsync(Context(), Ct);
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

            async Task<(bool Acquired, int Written, int Refused)> ReplicaAsync(PgLiveCoordinator coordinator, PgLiveElectionStore store, string name)
            {
                await start.Task;
                var acquired = await coordinator.TryAcquireAsync(Ct);
                int written = 0, refused = 0;
                for (var i = 0; i < 20; i++)
                {
                    try
                    {
                        // Mesma transição nas duas réplicas, com a chave de cada uma (gravadas as duas, duplicaria).
                        if (await store.SaveEventAsync(id, Event($"lead-change-{name}-{i}"), null, Ct) is not null) written++;
                        if (await store.SaveSnapshotAsync(id, Snapshot(0.40 + (i / 1000.0), name), null, Ct) is not null) written++;
                        await store.SaveTerritoryLatestAsync(id, Municipality with { ContentHash = name + new string('0', 61) + i.ToString("D2", System.Globalization.CultureInfo.InvariantCulture) }, Ct);
                        written++;
                    }
                    catch (LiveLeadershipLostException)
                    {
                        refused++;
                    }
                }
                return (acquired, written, refused);
            }

            var replicaA = Task.Run(() => ReplicaAsync(a, storeA, "a"));
            var replicaB = Task.Run(() => ReplicaAsync(b, storeB, "b"));
            start.SetResult();
            var replicas = await Task.WhenAll(replicaA, replicaB);
            var winner = Assert.Single(replicas, r => r.Acquired);
            var loser = Assert.Single(replicas, r => !r.Acquired);
            Assert.Equal(60, winner.Written);
            Assert.Equal(0, loser.Written);
            Assert.Equal(20, loser.Refused);

            var name = a.IsLeader ? "a" : "b";
            var rows = await storeA.LoadChangesAsync(id, LiveCursor.Start, 1000, Ct);
            Assert.Equal(20, rows.Snapshots.Count);
            Assert.All(rows.Snapshots, s => Assert.Equal(name, s.Snapshot.ETag));
            Assert.Equal(20, rows.Events.Count);
            Assert.All(rows.Events, e => Assert.StartsWith($"lead-change-{name}-", e.Event.DedupeKey, StringComparison.Ordinal));
            Assert.StartsWith(name, Assert.Single(rows.Territories).ContentHash, StringComparison.Ordinal);
        }
    }
}
