using Npgsql;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;
using RepBrasil.Infrastructure.LiveElection;
using RepBrasil.Tests.LiveElection;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Persistência da apuração contra o schema real (migration AddLiveElection). As tabelas de auditoria são imutáveis
/// (sem UPDATE/DELETE), então cada teste usa um ambiente de replay próprio em vez de transação revertida.
/// </summary>
public sealed class LiveElectionStoreTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static NpgsqlDataSource Db() => NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable)!);

    private static LiveElectionContext Context() => new(
        LiveModes.Replay,
        TseEnvironment.Replay("ele2026", "test-" + Guid.NewGuid().ToString("N")[..12]),
        new DiscoveredElection("ele2026", 9102, new DateOnly(2026, 10, 25), TseFixtures.Election, "Teste", 2, 1, "Presidente", 9001, 9101, []),
        2026,
        null,
        null);

    [ElectoralSchemaFact]
    public async Task Snapshots_are_deduplicated_by_content_and_events_by_key()
    {
        await using var db = Db();
        var store = new PgLiveElectionStore(db);
        var id = await store.EnsureElectionAsync(Context(), Ct);
        var snapshot = TseFixtures.Snapshot(TseFixtures.AtProgress(0.4));
        var raw = TseFixtures.Ea20(TseFixtures.AtProgress(0.4));

        var first = await store.SaveSnapshotAsync(id, snapshot, raw, Ct);
        var duplicate = await store.SaveSnapshotAsync(id, snapshot with { IngestedAt = snapshot.IngestedAt.AddSeconds(5) }, raw, Ct);
        Assert.NotNull(first);
        Assert.Null(duplicate);

        var e = new LiveEvent(0, LiveEventTypes.MathematicallyDefined, "public", "md-e", "br", "br", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, "Resultado matematicamente definido", null, 95.5m, new Dictionary<string, object?> { ["leaderKey"] = TseFixtures.A });
        Assert.NotNull(await store.SaveEventAsync(id, e, first, Ct));
        Assert.Null(await store.SaveEventAsync(id, e, first, Ct));

        var loaded = await store.LoadAsync(id, Ct);
        var national = Assert.Single(loaded.NationalHistory);
        Assert.Equal(snapshot.ContentHash, national.Snapshot.ContentHash);
        Assert.Equal(snapshot.Candidates, national.Snapshot.Candidates);
        var evidence = Assert.Single(loaded.Events);
        Assert.Equal("md-e", evidence.DedupeKey);
    }

    [ElectoralSchemaFact]
    public async Task Return_to_a_previous_result_is_persisted_in_order()
    {
        await using var db = Db();
        var store = new PgLiveElectionStore(db);
        var id = await store.EnsureElectionAsync(Context(), Ct);
        var a = TseFixtures.Snapshot(TseFixtures.AtProgress(0.6));
        var b = TseFixtures.Snapshot(TseFixtures.AtProgress(0.61));
        Assert.NotNull(await store.SaveSnapshotAsync(id, a, null, Ct));
        Assert.NotNull(await store.SaveSnapshotAsync(id, b, null, Ct));
        Assert.NotNull(await store.SaveSnapshotAsync(id, a, null, Ct)); // reprocessamento: o TSE voltou ao resultado A
        var loaded = await store.LoadAsync(id, Ct);
        Assert.Equal(3, loaded.NationalHistory.Count);
        Assert.Equal(a.ContentHash, loaded.NationalHistory[^1].Snapshot.ContentHash);
    }

    [ElectoralSchemaFact]
    public async Task Audit_trail_is_immutable()
    {
        await using var db = Db();
        var store = new PgLiveElectionStore(db);
        var id = await store.EnsureElectionAsync(Context(), Ct);
        await store.SaveSnapshotAsync(id, TseFixtures.Snapshot(TseFixtures.AtProgress(0.5)), null, Ct);
        await using var update = db.CreateCommand("UPDATE electoral.live_snapshot SET etag = 'x' WHERE election_id = $1");
        update.Parameters.AddWithValue(id);
        var error = await Assert.ThrowsAsync<PostgresException>(() => update.ExecuteNonQueryAsync(Ct));
        Assert.Contains("imutável", error.MessageText, StringComparison.Ordinal);
        await using var delete = db.CreateCommand("DELETE FROM electoral.live_snapshot WHERE election_id = $1");
        delete.Parameters.AddWithValue(id);
        await Assert.ThrowsAsync<PostgresException>(() => delete.ExecuteNonQueryAsync(Ct));
    }

    [ElectoralSchemaFact]
    public async Task Territory_latest_conditionals_and_photos_round_trip()
    {
        await using var db = Db();
        var store = new PgLiveElectionStore(db);
        var id = await store.EnsureElectionAsync(Context(), Ct);
        var municipality = TseFixtures.Snapshot(TseFixtures.AtProgress(0.3) with { Scope = "mu", Code = "71072" });
        await store.SaveTerritoryLatestAsync(id, municipality, Ct);
        await store.SaveTerritoryLatestAsync(id, municipality with { ContentHash = new string('f', 64) }, Ct);
        await store.SaveSourceStateAsync(id, "https://replay.repbrasil.invalid/x.json", new TseConditional("\"e1\"", null), 200, DateTimeOffset.UtcNow, true, Ct);
        await store.SavePhotoAsync("990000000001", [1, 2, 3], "image/jpeg", "\"p\"", "https://replay.repbrasil.invalid/p.jpeg", Ct);

        var loaded = await store.LoadAsync(id, Ct);
        var latest = Assert.Single(loaded.Territories);
        Assert.Equal(new string('f', 64), latest.ContentHash);
        Assert.Equal("\"e1\"", loaded.Conditionals["https://replay.repbrasil.invalid/x.json"].ETag);
        var photo = await store.LoadPhotoAsync("990000000001", Ct);
        Assert.Equal(new byte[] { 1, 2, 3 }, photo!.Value.Content);
        Assert.True(await store.PingAsync(Ct));
    }
}
