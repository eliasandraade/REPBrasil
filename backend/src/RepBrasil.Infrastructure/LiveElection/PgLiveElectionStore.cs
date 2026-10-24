using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;
using RepBrasil.Application.LiveElection;

namespace RepBrasil.Infrastructure.LiveElection;

/// <summary>
/// Persistência da apuração no PostgreSQL existente (schema electoral, script 020). Snapshots deduplicados por hash de
/// conteúdo (ON CONFLICT DO NOTHING); eventos idempotentes pela chave de deduplicação; nada é atualizado nem apagado
/// nas tabelas de auditoria.
/// </summary>
public sealed class PgLiveElectionStore(NpgsqlDataSource db) : ILiveElectionStore
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public async Task<int> EnsureElectionAsync(LiveElectionContext context, CancellationToken ct)
    {
        var e = context.Election;
        await using var cmd = db.CreateCommand("""
            INSERT INTO electoral.live_election
                (mode, environment, cycle, election_code, office_code, round, pleito_code, first_round_code, election_date, config)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (mode, environment, election_code, office_code) DO UPDATE SET
                cycle = EXCLUDED.cycle,
                pleito_code = EXCLUDED.pleito_code,
                first_round_code = EXCLUDED.first_round_code,
                election_date = EXCLUDED.election_date,
                config = EXCLUDED.config
            RETURNING id
            """);
        cmd.Parameters.AddWithValue(context.Mode);
        cmd.Parameters.AddWithValue(context.Environment.Environment);
        cmd.Parameters.AddWithValue(e.Cycle);
        cmd.Parameters.AddWithValue(e.ElectionCode);
        cmd.Parameters.AddWithValue(e.OfficeCode);
        cmd.Parameters.AddWithValue((short)e.Round);
        cmd.Parameters.AddWithValue(e.PleitoCode);
        cmd.Parameters.AddWithValue((object?)e.FirstRoundElectionCode ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)e.Date ?? DBNull.Value);
        cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(new { e.ElectionName, e.OfficeName, e.FirstRoundPleitoCode, e.Warnings, baseUrl = context.Environment.BaseUrl }, Json) });
        return (int)(await cmd.ExecuteScalarAsync(ct))!;
    }

    public async Task<long?> SaveSnapshotAsync(int electionId, TerritorySnapshot snapshot, ReadOnlyMemory<byte>? raw, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            INSERT INTO electoral.live_snapshot
                (election_id, scope_type, scope_code, content_hash, payload_sha256, tse_generation_id, tse_generated_at,
                 tse_totalized_at, ingested_at, etag, last_modified, sections_totalized_pct, snapshot, raw)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (election_id, scope_type, scope_code, content_hash) DO NOTHING
            RETURNING id
            """);
        cmd.Parameters.AddWithValue(electionId);
        cmd.Parameters.AddWithValue(snapshot.Key.ScopeName);
        cmd.Parameters.AddWithValue(snapshot.Key.Code);
        cmd.Parameters.AddWithValue(snapshot.ContentHash);
        cmd.Parameters.AddWithValue(snapshot.PayloadSha256);
        cmd.Parameters.AddWithValue((object?)snapshot.GenerationId ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)snapshot.GeneratedAt?.ToUniversalTime() ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)snapshot.TotalizedAt?.ToUniversalTime() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(snapshot.IngestedAt.ToUniversalTime());
        cmd.Parameters.AddWithValue((object?)snapshot.ETag ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)snapshot.LastModified ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)snapshot.Sections.TotalizedPct ?? DBNull.Value);
        cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(snapshot, Json) });
        cmd.Parameters.Add(new NpgsqlParameter
        {
            NpgsqlDbType = NpgsqlDbType.Jsonb,
            Value = raw is { } bytes ? Encoding.UTF8.GetString(bytes.Span) : DBNull.Value,
        });
        var id = await cmd.ExecuteScalarAsync(ct);
        return id is long value ? value : null;
    }

    public async Task SaveTerritoryLatestAsync(int electionId, TerritorySnapshot snapshot, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            INSERT INTO electoral.live_territory_latest
                (election_id, scope_type, scope_code, content_hash, tse_totalized_at, ingested_at, snapshot)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (election_id, scope_type, scope_code) DO UPDATE SET
                content_hash = EXCLUDED.content_hash,
                tse_totalized_at = EXCLUDED.tse_totalized_at,
                ingested_at = EXCLUDED.ingested_at,
                snapshot = EXCLUDED.snapshot
            WHERE electoral.live_territory_latest.content_hash IS DISTINCT FROM EXCLUDED.content_hash
            """);
        cmd.Parameters.AddWithValue(electionId);
        cmd.Parameters.AddWithValue(snapshot.Key.ScopeName);
        cmd.Parameters.AddWithValue(snapshot.Key.Code);
        cmd.Parameters.AddWithValue(snapshot.ContentHash);
        cmd.Parameters.AddWithValue((object?)snapshot.TotalizedAt?.ToUniversalTime() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(snapshot.IngestedAt.ToUniversalTime());
        cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(snapshot, Json) });
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<long?> SaveEventAsync(int electionId, LiveEvent liveEvent, long? snapshotId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            INSERT INTO electoral.live_event
                (election_id, event_type, dedupe_key, visibility, scope_type, scope_code, tse_at, detected_at, title, detail,
                 sections_totalized_pct, snapshot_id, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (election_id, dedupe_key) DO NOTHING
            RETURNING id
            """);
        cmd.Parameters.AddWithValue(electionId);
        cmd.Parameters.AddWithValue(liveEvent.Type);
        cmd.Parameters.AddWithValue((object?)liveEvent.DedupeKey ?? DBNull.Value);
        cmd.Parameters.AddWithValue(liveEvent.Visibility);
        cmd.Parameters.AddWithValue(liveEvent.Scope);
        cmd.Parameters.AddWithValue(liveEvent.Code);
        cmd.Parameters.AddWithValue((object?)liveEvent.At?.ToUniversalTime() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(liveEvent.DetectedAt.ToUniversalTime());
        cmd.Parameters.AddWithValue(liveEvent.Title);
        cmd.Parameters.AddWithValue((object?)liveEvent.Detail ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)liveEvent.SectionsPct ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)snapshotId ?? DBNull.Value);
        cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(liveEvent.Payload, Json) });
        var id = await cmd.ExecuteScalarAsync(ct);
        return id is long value ? value : null;
    }

    public async Task SaveSourceStateAsync(int electionId, string url, TseConditional conditional, int httpStatus, DateTimeOffset at, bool changed, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            INSERT INTO electoral.live_source_state (election_id, url, etag, last_modified, last_status, last_success_at, last_change_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $6)
            ON CONFLICT (election_id, url) DO UPDATE SET
                etag = COALESCE(EXCLUDED.etag, electoral.live_source_state.etag),
                last_modified = COALESCE(EXCLUDED.last_modified, electoral.live_source_state.last_modified),
                last_status = EXCLUDED.last_status,
                last_success_at = EXCLUDED.last_success_at,
                last_change_at = COALESCE(EXCLUDED.last_change_at, electoral.live_source_state.last_change_at),
                updated_at = EXCLUDED.updated_at
            """);
        cmd.Parameters.AddWithValue(electionId);
        cmd.Parameters.AddWithValue(url);
        cmd.Parameters.AddWithValue((object?)conditional.ETag ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)conditional.LastModified ?? DBNull.Value);
        cmd.Parameters.AddWithValue(httpStatus);
        cmd.Parameters.AddWithValue(at.ToUniversalTime());
        cmd.Parameters.AddWithValue(changed ? at.ToUniversalTime() : DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<StoredLiveState> LoadAsync(int electionId, CancellationToken ct)
    {
        var national = new List<(long, TerritorySnapshot)>();
        var states = new Dictionary<string, List<(long, TerritorySnapshot)>>(StringComparer.Ordinal);
        await using (var cmd = db.CreateCommand("""
            SELECT id, scope_type, scope_code, snapshot::text FROM electoral.live_snapshot
             WHERE election_id = $1 AND scope_type IN ('br', 'uf')
             ORDER BY id
            """))
        {
            cmd.Parameters.AddWithValue(electionId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var snapshot = JsonSerializer.Deserialize<TerritorySnapshot>(reader.GetString(3), Json)!;
                if (reader.GetString(1) == "br") national.Add((reader.GetInt64(0), snapshot));
                else
                {
                    var uf = reader.GetString(2);
                    if (!states.TryGetValue(uf, out var list)) states[uf] = list = [];
                    list.Add((reader.GetInt64(0), snapshot));
                }
            }
        }

        var territories = new List<TerritorySnapshot>();
        await using (var cmd = db.CreateCommand("SELECT snapshot::text FROM electoral.live_territory_latest WHERE election_id = $1"))
        {
            cmd.Parameters.AddWithValue(electionId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) territories.Add(JsonSerializer.Deserialize<TerritorySnapshot>(reader.GetString(0), Json)!);
        }

        var events = new List<LiveEvent>();
        await using (var cmd = db.CreateCommand("""
            SELECT id, event_type, visibility, dedupe_key, scope_type, scope_code, tse_at, detected_at, title, detail,
                   sections_totalized_pct, payload::text
              FROM electoral.live_event WHERE election_id = $1 ORDER BY id
            """))
        {
            cmd.Parameters.AddWithValue(electionId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(reader.GetString(11), Json) ?? [];
                events.Add(new LiveEvent(
                    reader.GetInt64(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                    reader.GetFieldValue<DateTimeOffset>(7),
                    reader.GetString(8),
                    reader.IsDBNull(9) ? null : reader.GetString(9),
                    reader.IsDBNull(10) ? null : reader.GetDecimal(10),
                    payload));
            }
        }

        var conditionals = new Dictionary<string, TseConditional>(StringComparer.Ordinal);
        await using (var cmd = db.CreateCommand("SELECT url, etag, last_modified FROM electoral.live_source_state WHERE election_id = $1"))
        {
            cmd.Parameters.AddWithValue(electionId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                conditionals[reader.GetString(0)] = new TseConditional(reader.IsDBNull(1) ? null : reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2));
        }

        return new StoredLiveState(
            national,
            states.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<(long, TerritorySnapshot)>)kv.Value, StringComparer.Ordinal),
            territories,
            events,
            conditionals);
    }

    public async Task<(byte[] Content, string ContentType)?> LoadPhotoAsync(string sqcand, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("SELECT content, content_type FROM electoral.live_candidate_photo WHERE sqcand = $1");
        cmd.Parameters.AddWithValue(sqcand);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return (reader.GetFieldValue<byte[]>(0), reader.GetString(1));
    }

    public async Task SavePhotoAsync(string sqcand, byte[] content, string contentType, string? etag, string sourceUrl, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            INSERT INTO electoral.live_candidate_photo (sqcand, content, content_type, etag, source_url)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (sqcand) DO UPDATE SET content = EXCLUDED.content, content_type = EXCLUDED.content_type,
                etag = EXCLUDED.etag, source_url = EXCLUDED.source_url, retrieved_at = now()
            """);
        cmd.Parameters.AddWithValue(sqcand);
        cmd.Parameters.AddWithValue(content);
        cmd.Parameters.AddWithValue(contentType);
        cmd.Parameters.AddWithValue((object?)etag ?? DBNull.Value);
        cmd.Parameters.AddWithValue(sourceUrl);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<bool> PingAsync(CancellationToken ct)
    {
        try
        {
            await using var cmd = db.CreateCommand("SELECT 1");
            return await cmd.ExecuteScalarAsync(ct) is 1;
        }
        catch (Exception e) when (e is NpgsqlException or InvalidOperationException or TimeoutException)
        {
            return false;
        }
    }
}

/// <summary>
/// Coordenação entre réplicas pelo PostgreSQL existente (sem Redis em produção): advisory lock de sessão elege um único
/// poller; NOTIFY/LISTEN avisa as demais réplicas de que há estado novo para carregar.
/// </summary>
public sealed class PgLiveCoordinator(NpgsqlDataSource db) : IAsyncDisposable
{
    public const string Channel = "repbrasil_live_election";
    private const long LockKey = 0x52455042_4C495645; // "REPBLIVE"
    private NpgsqlConnection? leader;

    public bool IsLeader => leader is { State: System.Data.ConnectionState.Open };

    public async Task<bool> TryAcquireAsync(CancellationToken ct)
    {
        if (IsLeader) return await StillLeaderAsync(ct);
        var connection = await db.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", connection);
        cmd.Parameters.AddWithValue(LockKey);
        if (await cmd.ExecuteScalarAsync(ct) is true)
        {
            leader = connection;
            return true;
        }
        await connection.DisposeAsync();
        return false;
    }

    /// <summary>A liderança vive na conexão: se ela caiu, o lock foi solto pelo servidor.</summary>
    public async Task<bool> StillLeaderAsync(CancellationToken ct)
    {
        if (leader is null) return false;
        try
        {
            await using var cmd = new NpgsqlCommand("SELECT 1", leader);
            await cmd.ExecuteScalarAsync(ct);
            return true;
        }
        catch (Exception e) when (e is NpgsqlException or InvalidOperationException or IOException)
        {
            await leader.DisposeAsync();
            leader = null;
            return false;
        }
    }

    public async Task NotifyAsync(string payload, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("SELECT pg_notify($1, $2)");
        cmd.Parameters.AddWithValue(Channel);
        cmd.Parameters.AddWithValue(payload);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Escuta o canal até o cancelamento (réplicas seguidoras).</summary>
    public async Task ListenAsync(Func<string, Task> onNotification, CancellationToken ct)
    {
        await using var connection = await db.OpenConnectionAsync(ct);
        connection.Notification += (_, e) => _ = onNotification(e.Payload);
        await using (var cmd = new NpgsqlCommand($"LISTEN {Channel}", connection)) await cmd.ExecuteNonQueryAsync(ct);
        while (!ct.IsCancellationRequested) await connection.WaitAsync(TimeSpan.FromSeconds(30), ct);
    }

    public async ValueTask DisposeAsync()
    {
        if (leader is not null) await leader.DisposeAsync();
        leader = null;
    }
}
