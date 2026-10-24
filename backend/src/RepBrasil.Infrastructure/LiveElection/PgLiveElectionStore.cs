using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Infrastructure.LiveElection;

/// <summary>
/// Persistência da apuração no PostgreSQL existente (schema electoral, script 020). Snapshots deduplicados contra o
/// último da abrangência; eventos idempotentes pela chave de deduplicação; nada é atualizado nem apagado nas tabelas
/// de auditoria.
/// <para>
/// Com coordenação (<paramref name="writer"/>), a trilha só é gravada pela conexão que detém o advisory lock: uma
/// réplica sem a liderança não grava nada — nem nos segundos depois de o banco voltar de uma queda —, e como as
/// gravações dessa conexão são sequenciais, a ordem dos ids/revisions é a ordem de commit. É isso que permite às
/// seguidoras ler só o que veio depois do último cursor sem perder linha. Sem coordenação (testes, ferramentas), as
/// gravações usam o pool.
/// </para>
/// </summary>
public sealed class PgLiveElectionStore(NpgsqlDataSource db, PgLiveCoordinator? writer = null) : ILiveElectionStore
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

    public async Task<int?> FindElectionAsync(LiveElectionContext context, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            SELECT id FROM electoral.live_election
             WHERE mode = $1 AND environment = $2 AND election_code = $3 AND office_code = $4
            """);
        cmd.Parameters.AddWithValue(context.Mode);
        cmd.Parameters.AddWithValue(context.Environment.Environment);
        cmd.Parameters.AddWithValue(context.Election.ElectionCode);
        cmd.Parameters.AddWithValue(context.Election.OfficeCode);
        return await cmd.ExecuteScalarAsync(ct) is int id ? id : null;
    }

    /// <summary>Gravação na trilha: pela conexão da liderança (com coordenação) ou pelo pool (sem coordenação).</summary>
    private async Task<T> WriteAsync<T>(Func<NpgsqlConnection, CancellationToken, Task<T>> work, CancellationToken ct)
    {
        if (writer is not null) return await writer.OnLeaderConnectionAsync(work, ct);
        await using var connection = await db.OpenConnectionAsync(ct);
        return await work(connection, ct);
    }

    /// <summary>
    /// Grava se o conteúdo difere do ÚLTIMO snapshot da abrangência. Um retorno a um conteúdo anterior (A → B → A, por
    /// reprocessamento do TSE) é gravado de novo: a ordem aceita é a autoridade, não a primeira aparição do conteúdo.
    /// A checagem e a inserção rodam na conexão única da líder, sem gravação concorrente entre elas.
    /// </summary>
    public Task<long?> SaveSnapshotAsync(int electionId, TerritorySnapshot snapshot, ReadOnlyMemory<byte>? raw, CancellationToken ct) =>
        WriteAsync<long?>(async (connection, token) =>
        {
            await using (var last = new NpgsqlCommand("""
                SELECT content_hash FROM electoral.live_snapshot
                 WHERE election_id = $1 AND scope_type = $2 AND scope_code = $3
                 ORDER BY id DESC LIMIT 1
                """, connection))
            {
                last.Parameters.AddWithValue(electionId);
                last.Parameters.AddWithValue(snapshot.Key.ScopeName);
                last.Parameters.AddWithValue(snapshot.Key.Code);
                if (await last.ExecuteScalarAsync(token) is string hash && hash == snapshot.ContentHash) return null;
            }
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO electoral.live_snapshot
                    (election_id, scope_type, scope_code, content_hash, payload_sha256, tse_generation_id, tse_generated_at,
                     tse_totalized_at, ingested_at, etag, last_modified, sections_totalized_pct, snapshot, raw)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING id
                """, connection);
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
            return await cmd.ExecuteScalarAsync(token) is long id ? id : null;
        }, ct);

    public Task SaveTerritoryLatestAsync(int electionId, TerritorySnapshot snapshot, CancellationToken ct) =>
        WriteAsync(async (connection, token) =>
        {
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO electoral.live_territory_latest
                    (election_id, scope_type, scope_code, content_hash, tse_totalized_at, ingested_at, revision, snapshot)
                VALUES ($1, $2, $3, $4, $5, $6, nextval('electoral.live_revision_seq'), $7)
                ON CONFLICT (election_id, scope_type, scope_code) DO UPDATE SET
                    content_hash = EXCLUDED.content_hash,
                    tse_totalized_at = EXCLUDED.tse_totalized_at,
                    ingested_at = EXCLUDED.ingested_at,
                    revision = EXCLUDED.revision,
                    snapshot = EXCLUDED.snapshot
                WHERE electoral.live_territory_latest.content_hash IS DISTINCT FROM EXCLUDED.content_hash
                """, connection);
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(snapshot.Key.ScopeName);
            cmd.Parameters.AddWithValue(snapshot.Key.Code);
            cmd.Parameters.AddWithValue(snapshot.ContentHash);
            cmd.Parameters.AddWithValue((object?)snapshot.TotalizedAt?.ToUniversalTime() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(snapshot.IngestedAt.ToUniversalTime());
            cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(snapshot, Json) });
            return await cmd.ExecuteNonQueryAsync(token);
        }, ct);

    public Task SaveAccompanimentAsync(int electionId, string scope, AccompanimentFile file, string contentHash, DateTimeOffset ingestedAt, CancellationToken ct) =>
        WriteAsync(async (connection, token) =>
        {
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO electoral.live_accompaniment
                    (election_id, scope_code, content_hash, tse_generated_at, ingested_at, revision, file)
                VALUES ($1, $2, $3, $4, $5, nextval('electoral.live_revision_seq'), $6)
                ON CONFLICT (election_id, scope_code) DO UPDATE SET
                    content_hash = EXCLUDED.content_hash,
                    tse_generated_at = EXCLUDED.tse_generated_at,
                    ingested_at = EXCLUDED.ingested_at,
                    revision = EXCLUDED.revision,
                    file = EXCLUDED.file
                WHERE electoral.live_accompaniment.content_hash IS DISTINCT FROM EXCLUDED.content_hash
                """, connection);
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(scope);
            cmd.Parameters.AddWithValue(contentHash);
            cmd.Parameters.AddWithValue((object?)file.GeneratedAt?.ToUniversalTime() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(ingestedAt.ToUniversalTime());
            cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(file, Json) });
            return await cmd.ExecuteNonQueryAsync(token);
        }, ct);

    public Task SaveSourceHealthAsync(int electionId, SourceHealth health, CancellationToken ct) =>
        WriteAsync(async (connection, token) =>
        {
            await using var cmd = new NpgsqlCommand("""
                UPDATE electoral.live_election
                   SET source_health = $2, source_revision = nextval('electoral.live_revision_seq')
                 WHERE id = $1
                """, connection);
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(health, Json) });
            return await cmd.ExecuteNonQueryAsync(token);
        }, ct);

    public Task<long?> SaveEventAsync(int electionId, LiveEvent liveEvent, long? snapshotId, CancellationToken ct) =>
        WriteAsync<long?>(async (connection, token) =>
        {
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO electoral.live_event
                    (election_id, event_type, dedupe_key, visibility, scope_type, scope_code, tse_at, detected_at, title, detail,
                     sections_totalized_pct, snapshot_id, payload)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (election_id, dedupe_key) DO NOTHING
                RETURNING id
                """, connection);
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
            return await cmd.ExecuteScalarAsync(token) is long id ? id : null;
        }, ct);

    /// <summary>Cache de ETag/Last-Modified (não é trilha de auditoria): pelo pool, sem disputar a conexão da líder.</summary>
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

    /// <summary>
    /// Uma leitura REPEATABLE READ (todas as consultas veem o mesmo instante do banco). Como a líder grava o snapshot
    /// antes do evento que o cita, um evento visível nunca aponta para um snapshot invisível; com a página de
    /// snapshots cheia, os eventos param no primeiro que cita um snapshot da página seguinte.
    /// </summary>
    public async Task<StoredChanges> LoadChangesAsync(int electionId, LiveCursor after, int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 10_000);
        await using var connection = await db.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        await using (var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, tx)) await readOnly.ExecuteNonQueryAsync(ct);

        var snapshots = new List<(long, TerritorySnapshot)>();
        await using (var cmd = new NpgsqlCommand("""
            SELECT id, snapshot::text FROM electoral.live_snapshot
             WHERE election_id = $1 AND id > $2 AND scope_type IN ('br', 'uf')
             ORDER BY id LIMIT $3
            """, connection, tx))
        {
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(after.Snapshot);
            cmd.Parameters.AddWithValue(limit);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                snapshots.Add((reader.GetInt64(0), JsonSerializer.Deserialize<TerritorySnapshot>(reader.GetString(1), Json)!));
        }
        var snapshotsFull = snapshots.Count == limit;
        var visibleSnapshot = snapshotsFull ? snapshots[^1].Item1 : long.MaxValue;

        var events = new List<StoredEvent>();
        var eventsCut = false;
        await using (var cmd = new NpgsqlCommand("""
            SELECT id, event_type, visibility, dedupe_key, scope_type, scope_code, tse_at, detected_at, title, detail,
                   sections_totalized_pct, payload::text, snapshot_id
              FROM electoral.live_event WHERE election_id = $1 AND id > $2 ORDER BY id LIMIT $3
            """, connection, tx))
        {
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(after.Event);
            cmd.Parameters.AddWithValue(limit);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                long? snapshotId = reader.IsDBNull(12) ? null : reader.GetInt64(12);
                if (snapshotId > visibleSnapshot)
                {
                    eventsCut = true;
                    break;
                }
                var payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(reader.GetString(11), Json) ?? [];
                events.Add(new StoredEvent(
                    new LiveEvent(
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
                        payload),
                    snapshotId));
            }
        }

        var territories = new List<TerritorySnapshot>();
        var territoryCursor = after.Territory;
        await using (var cmd = new NpgsqlCommand("""
            SELECT revision, snapshot::text FROM electoral.live_territory_latest
             WHERE election_id = $1 AND revision > $2 ORDER BY revision LIMIT $3
            """, connection, tx))
        {
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(after.Territory);
            cmd.Parameters.AddWithValue(limit);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                territoryCursor = reader.GetInt64(0);
                territories.Add(JsonSerializer.Deserialize<TerritorySnapshot>(reader.GetString(1), Json)!);
            }
        }

        var accompaniments = new List<(string, AccompanimentFile)>();
        var accompanimentCursor = after.Accompaniment;
        await using (var cmd = new NpgsqlCommand("""
            SELECT revision, scope_code, file::text FROM electoral.live_accompaniment
             WHERE election_id = $1 AND revision > $2 ORDER BY revision LIMIT $3
            """, connection, tx))
        {
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(after.Accompaniment);
            cmd.Parameters.AddWithValue(limit);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                accompanimentCursor = reader.GetInt64(0);
                accompaniments.Add((reader.GetString(1), JsonSerializer.Deserialize<AccompanimentFile>(reader.GetString(2), Json)!));
            }
        }

        SourceHealth? source = null;
        var sourceCursor = after.Source;
        await using (var cmd = new NpgsqlCommand("""
            SELECT source_revision, source_health::text FROM electoral.live_election
             WHERE id = $1 AND source_revision > $2 AND source_health IS NOT NULL
            """, connection, tx))
        {
            cmd.Parameters.AddWithValue(electionId);
            cmd.Parameters.AddWithValue(after.Source);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                sourceCursor = reader.GetInt64(0);
                source = JsonSerializer.Deserialize<SourceHealth>(reader.GetString(1), Json);
            }
        }
        await tx.CommitAsync(ct);

        var cursor = new LiveCursor(
            snapshots.Count > 0 ? snapshots[^1].Item1 : after.Snapshot,
            events.Count > 0 ? events[^1].Event.Id : after.Event,
            territoryCursor,
            accompanimentCursor,
            sourceCursor);
        var more = snapshotsFull || eventsCut || events.Count == limit || territories.Count == limit || accompaniments.Count == limit;
        return new StoredChanges(snapshots, events, territories, accompaniments, source, cursor, more);
    }

    public async Task<IReadOnlyDictionary<string, TseConditional>> LoadConditionalsAsync(int electionId, CancellationToken ct)
    {
        var conditionals = new Dictionary<string, TseConditional>(StringComparer.Ordinal);
        await using var cmd = db.CreateCommand("SELECT url, etag, last_modified FROM electoral.live_source_state WHERE election_id = $1");
        cmd.Parameters.AddWithValue(electionId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            conditionals[reader.GetString(0)] = new TseConditional(reader.IsDBNull(1) ? null : reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2));
        return conditionals;
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
/// poller; NOTIFY/LISTEN avisa as demais réplicas de que há estado novo para ler.
/// <para>
/// A conexão que detém o lock é também a única por onde a trilha é gravada (<see cref="OnLeaderConnectionAsync"/>).
/// O lock e a gravação são a mesma sessão: se ela cai, o servidor solta o lock E nenhuma gravação dela é mais
/// confirmada — não existe janela em que duas réplicas gravem, nem quando o banco volta de uma queda.
/// </para>
/// </summary>
public sealed class PgLiveCoordinator(NpgsqlDataSource db, long lockKey = 0x52455042_4C495645 /* "REPBLIVE" */) : IAsyncDisposable
{
    public const string Channel = "repbrasil_live_election";
    private readonly SemaphoreSlim gate = new(1, 1);
    private NpgsqlConnection? leader;

    public bool IsLeader => Volatile.Read(ref leader) is { FullState: ConnectionState.Open };

    /// <summary>PID da sessão do PostgreSQL que detém o lock (diagnóstico no Super Admin).</summary>
    public int? LeaderProcessId => Volatile.Read(ref leader) is { FullState: ConnectionState.Open } connection ? connection.ProcessID : null;

    public async Task<bool> TryAcquireAsync(CancellationToken ct)
    {
        if (IsLeader) return await StillLeaderAsync(ct);
        var connection = await db.OpenConnectionAsync(ct);
        try
        {
            await using var cmd = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", connection);
            cmd.Parameters.AddWithValue(lockKey);
            if (await cmd.ExecuteScalarAsync(ct) is true)
            {
                await gate.WaitAsync(ct);
                try
                {
                    if (leader is not null) await leader.DisposeAsync();
                    Volatile.Write(ref leader, connection);
                }
                finally
                {
                    gate.Release();
                }
                return true;
            }
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
        await connection.DisposeAsync();
        return false;
    }

    /// <summary>A liderança vive na conexão: se ela caiu, o lock foi solto pelo servidor.</summary>
    public async Task<bool> StillLeaderAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (leader is null) return false;
            try
            {
                await using var cmd = new NpgsqlCommand("SELECT 1", leader);
                await cmd.ExecuteScalarAsync(ct);
                return true;
            }
            catch (Exception e) when (e is NpgsqlException or InvalidOperationException or IOException or TimeoutException)
            {
                await DropLeaderAsync();
                return false;
            }
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Executa uma gravação na conexão da liderança, uma de cada vez (a ordem de gravação é a de commit). Sem a
    /// liderança — nunca adquirida, perdida ou com a conexão caída — recusa com <see cref="LiveLeadershipLostException"/>.
    /// </summary>
    public async Task<T> OnLeaderConnectionAsync<T>(Func<NpgsqlConnection, CancellationToken, Task<T>> work, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (leader is not { FullState: ConnectionState.Open } connection)
                throw new LiveLeadershipLostException("Gravação recusada: esta réplica não detém a liderança da apuração.");
            try
            {
                return await work(connection, ct);
            }
            catch (Exception e) when (e is NpgsqlException or IOException && connection.FullState != ConnectionState.Open)
            {
                // A sessão do lock caiu no meio da gravação: o servidor solta o lock e esta réplica deixa de gravar.
                await DropLeaderAsync();
                throw new LiveLeadershipLostException("Conexão da liderança caiu durante a gravação.", e);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task DropLeaderAsync()
    {
        var connection = leader;
        Volatile.Write(ref leader, null);
        if (connection is not null)
        {
            try { await connection.DisposeAsync(); }
            catch (Exception e) when (e is NpgsqlException or IOException or InvalidOperationException) { /* conexão já perdida */ }
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
        await gate.WaitAsync();
        try
        {
            await DropLeaderAsync();
        }
        finally
        {
            gate.Release();
        }
    }
}
