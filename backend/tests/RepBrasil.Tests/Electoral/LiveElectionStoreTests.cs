using Npgsql;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;
using RepBrasil.API.LiveElection;
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

        var loaded = await store.LoadChangesAsync(id, LiveCursor.Start, 100, Ct);
        var national = Assert.Single(loaded.Snapshots);
        Assert.Equal(snapshot.ContentHash, national.Snapshot.ContentHash);
        Assert.Equal(snapshot.Candidates, national.Snapshot.Candidates);
        var evidence = Assert.Single(loaded.Events);
        Assert.Equal("md-e", evidence.Event.DedupeKey);
        Assert.Equal(first, evidence.SnapshotId);
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
        var loaded = await store.LoadChangesAsync(id, LiveCursor.Start, 100, Ct);
        Assert.Equal(3, loaded.Snapshots.Count);
        Assert.Equal(a.ContentHash, loaded.Snapshots[^1].Snapshot.ContentHash);
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

        var loaded = await store.LoadChangesAsync(id, LiveCursor.Start, 100, Ct);
        var latest = Assert.Single(loaded.Territories);
        Assert.Equal(new string('f', 64), latest.ContentHash);
        Assert.Equal("\"e1\"", (await store.LoadConditionalsAsync(id, Ct))["https://replay.repbrasil.invalid/x.json"].ETag);
        // A mesma linha regravada com outro conteúdo ganha revision nova: a seguidora a lê de novo, uma vez.
        Assert.Empty((await store.LoadChangesAsync(id, loaded.Cursor, 100, Ct)).Territories);
        await store.SaveTerritoryLatestAsync(id, municipality with { ContentHash = new string('e', 64) }, Ct);
        Assert.Equal(new string('e', 64), Assert.Single((await store.LoadChangesAsync(id, loaded.Cursor, 100, Ct)).Territories).ContentHash);
        var photo = await store.LoadPhotoAsync("990000000001", Ct);
        Assert.Equal(new byte[] { 1, 2, 3 }, photo!.Value.Content);
        Assert.True(await store.PingAsync(Ct));
    }

    [ElectoralSchemaFact]
    public async Task Accompaniment_and_source_health_are_read_once_by_revision()
    {
        await using var db = Db();
        var store = new PgLiveElectionStore(db);
        var id = await store.EnsureElectionAsync(Context(), Ct);
        var ea14 = TseParser.ParseAccompaniment(TseFixtures.Utf8("""
            {"ele":"9002","t":"2","f":"o","dg":"25/10/2026","hg":"18:00:00","idg":"7","abr":[
              {"tpabr":"uf","cdabr":"sp","and":"p","dt":"25/10/2026","ht":"17:59:00","s":{"ts":"100","st":"40","snt":"60","si":"40","sni":"0","sa":"40","sna":"0","pst":"40,00","pstn":"40"},"e":{"te":"1000","est":"400","esnt":"600","esi":"400","esni":"0","esa":"400","esna":"0","c":"300","a":"100"}}]}
            """));
        await store.SaveAccompanimentAsync(id, "br", ea14, new string('a', 64), DateTimeOffset.UtcNow, Ct);
        await store.SaveAccompanimentAsync(id, "br", ea14, new string('a', 64), DateTimeOffset.UtcNow, Ct); // mesmo hash: nada novo
        var health = SourceHealth.Initial with { ConsecutiveFailures = 3, Healthy = false, LastError = "HTTP 503" };
        await store.SaveSourceHealthAsync(id, health, Ct);

        var first = await store.LoadChangesAsync(id, LiveCursor.Start, 100, Ct);
        var (scope, file) = Assert.Single(first.Accompaniments);
        Assert.Equal("br", scope);
        Assert.Equal(ea14.Entries.Single().Electorate.InNotTotalized, file.Entries.Single().Electorate.InNotTotalized);
        Assert.Equal(3, first.Source!.ConsecutiveFailures);
        Assert.True(first.Source.Failing);
        Assert.Equal(0, (await store.LoadChangesAsync(id, first.Cursor, 100, Ct)).Rows);
    }

    /// <summary>
    /// O custo de uma sincronização é o que mudou: com 20 mil snapshots no histórico, a leitura depois do cursor lê
    /// zero linhas (ou só a nova) e leva o mesmo tempo que com o histórico vazio.
    /// </summary>
    [ElectoralSchemaFact]
    public async Task Changes_after_the_cursor_cost_what_changed_not_the_history()
    {
        await using var db = Db();
        var store = new PgLiveElectionStore(db);
        var id = await store.EnsureElectionAsync(Context(), Ct);
        var seedId = (await store.SaveSnapshotAsync(id, TseFixtures.Snapshot(TseFixtures.AtProgress(0.1)), null, Ct))!.Value;
        var cursor = (await store.LoadChangesAsync(id, LiveCursor.Start, 100, Ct)).Cursor;

        async Task<double> TimeEmptySyncAsync()
        {
            for (var i = 0; i < 5; i++) await store.LoadChangesAsync(id, cursor, LiveIngestionEngine.LoadBatch, Ct); // aquecimento
            var watch = System.Diagnostics.Stopwatch.StartNew();
            for (var i = 0; i < 20; i++) Assert.Equal(0, (await store.LoadChangesAsync(id, cursor, LiveIngestionEngine.LoadBatch, Ct)).Rows);
            return watch.Elapsed.TotalMilliseconds / 20;
        }

        var small = await TimeEmptySyncAsync();
        await using (var bulk = db.CreateCommand("""
            INSERT INTO electoral.live_snapshot
                (election_id, scope_type, scope_code, content_hash, payload_sha256, ingested_at, snapshot)
            SELECT s.election_id, 'uf', 'sp', md5(g::text) || md5((g + 1)::text), s.payload_sha256, s.ingested_at, s.snapshot
              FROM electoral.live_snapshot s, generate_series(1, 20000) g
             WHERE s.id = $1
            """))
        {
            bulk.Parameters.AddWithValue(seedId);
            Assert.Equal(20_000, await bulk.ExecuteNonQueryAsync(Ct));
        }
        // Histórico lido uma vez (partida), em páginas; depois disso, só o que vier.
        var pages = 0;
        StoredChanges page;
        do
        {
            page = await store.LoadChangesAsync(id, cursor, LiveIngestionEngine.LoadBatch, Ct);
            cursor = page.Cursor;
            pages++;
        }
        while (page.More);
        Assert.True(pages >= 10);
        var big = await TimeEmptySyncAsync();
        Assert.True(big < small * 5 + 5, $"sincronização vazia: {small:0.00} ms com 1 snapshot, {big:0.00} ms com 20 mil");

        await store.SaveSnapshotAsync(id, TseFixtures.Snapshot(TseFixtures.AtProgress(0.2)), null, Ct);
        var next = await store.LoadChangesAsync(id, cursor, LiveIngestionEngine.LoadBatch, Ct);
        Assert.Single(next.Snapshots);
        Assert.False(next.More);
    }
}
