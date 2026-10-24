using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Tests.LiveElection;

/// <summary>
/// Store em memória com a mesma semântica do <c>PgLiveElectionStore</c>: ids e revisions crescentes, snapshot
/// deduplicado contra o último da abrangência, evento idempotente pela chave, "último valor" só regravado quando o
/// hash muda, leitura por cursor com limite por tabela e corte dos eventos que citam snapshot da página seguinte.
/// Conta linhas lidas e gravações: é o que prova que a seguidora lê só o que mudou e que quem não lidera não grava.
/// </summary>
public sealed class InMemoryLiveStore : ILiveElectionStore
{
    private readonly object gate = new();
    private readonly Dictionary<string, int> elections = new(StringComparer.Ordinal);
    private readonly Dictionary<int, List<(long Id, TerritorySnapshot Snapshot)>> snapshots = [];
    private readonly Dictionary<int, List<StoredEvent>> events = [];
    private readonly Dictionary<int, HashSet<string>> dedupeKeys = [];
    private readonly Dictionary<int, Dictionary<string, (long Revision, TerritorySnapshot Snapshot)>> territories = [];
    private readonly Dictionary<int, SortedDictionary<long, string>> territoryRevisions = [];
    private readonly Dictionary<int, Dictionary<string, (long Revision, string Hash, AccompanimentFile File)>> accompaniments = [];
    private readonly Dictionary<int, (long Revision, SourceHealth Health)> health = [];
    private readonly Dictionary<string, TseConditional> conditionals = new(StringComparer.Ordinal);
    private long nextSnapshotId;
    private long nextEventId;
    private long revision;

    /// <summary>Emula a guarda da conexão da líder: false = a gravação é recusada (sem liderança).</summary>
    public Func<bool> CanWrite { get; set; } = () => true;

    /// <summary>Banco fora do ar: toda chamada falha como no PostgreSQL indisponível.</summary>
    public bool Down { get; set; }

    private void Available()
    {
        if (Down) throw new TimeoutException("Banco indisponível (teste).");
    }

    public int Writes { get; private set; }
    public int RefusedWrites { get; private set; }
    public long RowsRead { get; private set; }
    public List<int> RowsPerLoad { get; } = [];
    public int SnapshotRows { get { lock (gate) return snapshots.Values.Sum(l => l.Count); } }

    private void Write()
    {
        Available();
        if (!CanWrite())
        {
            RefusedWrites++;
            throw new LiveLeadershipLostException("Gravação recusada: sem liderança (teste).");
        }
        Writes++;
    }

    private static string Key(LiveElectionContext c) => $"{c.Mode}|{c.Environment.Environment}|{c.Election.ElectionCode}|{c.Election.OfficeCode}";

    public Task<int> EnsureElectionAsync(LiveElectionContext context, CancellationToken ct)
    {
        lock (gate)
        {
            Available();
            if (!elections.TryGetValue(Key(context), out var id)) elections[Key(context)] = id = elections.Count + 1;
            return Task.FromResult(id);
        }
    }

    public Task<int?> FindElectionAsync(LiveElectionContext context, CancellationToken ct)
    {
        lock (gate)
        {
            Available();
            return Task.FromResult(elections.TryGetValue(Key(context), out var id) ? id : (int?)null);
        }
    }

    public Task<long?> SaveSnapshotAsync(int electionId, TerritorySnapshot snapshot, ReadOnlyMemory<byte>? raw, CancellationToken ct)
    {
        lock (gate)
        {
            Write();
            var list = snapshots.TryGetValue(electionId, out var l) ? l : snapshots[electionId] = [];
            for (var i = list.Count - 1; i >= 0; i--)
            {
                if (list[i].Snapshot.Key != snapshot.Key) continue;
                if (list[i].Snapshot.ContentHash == snapshot.ContentHash) return Task.FromResult<long?>(null);
                break;
            }
            var id = ++nextSnapshotId;
            list.Add((id, snapshot));
            return Task.FromResult<long?>(id);
        }
    }

    public Task SaveTerritoryLatestAsync(int electionId, TerritorySnapshot snapshot, CancellationToken ct)
    {
        lock (gate)
        {
            Write();
            var map = territories.TryGetValue(electionId, out var m) ? m : territories[electionId] = new(StringComparer.Ordinal);
            var index = territoryRevisions.TryGetValue(electionId, out var r) ? r : territoryRevisions[electionId] = [];
            var key = $"{snapshot.Key.ScopeName}:{snapshot.Key.Code}";
            var next = ++revision;
            if (map.TryGetValue(key, out var have))
            {
                if (have.Snapshot.ContentHash == snapshot.ContentHash) return Task.CompletedTask;
                index.Remove(have.Revision);
            }
            map[key] = (next, snapshot);
            index[next] = key;
            return Task.CompletedTask;
        }
    }

    public Task SaveAccompanimentAsync(int electionId, string scope, AccompanimentFile file, string contentHash, DateTimeOffset ingestedAt, CancellationToken ct)
    {
        lock (gate)
        {
            Write();
            var map = accompaniments.TryGetValue(electionId, out var m) ? m : accompaniments[electionId] = new(StringComparer.Ordinal);
            var next = ++revision;
            if (map.TryGetValue(scope, out var have) && have.Hash == contentHash) return Task.CompletedTask;
            map[scope] = (next, contentHash, file);
            return Task.CompletedTask;
        }
    }

    public Task SaveSourceHealthAsync(int electionId, SourceHealth health, CancellationToken ct)
    {
        lock (gate)
        {
            Write();
            this.health[electionId] = (++revision, health);
            return Task.CompletedTask;
        }
    }

    public Task<long?> SaveEventAsync(int electionId, LiveEvent liveEvent, long? snapshotId, CancellationToken ct)
    {
        lock (gate)
        {
            Write();
            var id = ++nextEventId; // como no PostgreSQL, o conflito também consome o id
            var keys = dedupeKeys.TryGetValue(electionId, out var k) ? k : dedupeKeys[electionId] = new(StringComparer.Ordinal);
            if (liveEvent.DedupeKey is { } key && !keys.Add(key)) return Task.FromResult<long?>(null);
            var list = events.TryGetValue(electionId, out var l) ? l : events[electionId] = [];
            list.Add(new StoredEvent(liveEvent with { Id = id }, snapshotId));
            return Task.FromResult<long?>(id);
        }
    }

    public Task SaveSourceStateAsync(int electionId, string url, TseConditional conditional, int httpStatus, DateTimeOffset at, bool changed, CancellationToken ct)
    {
        lock (gate)
        {
            Write();
            conditionals[url] = conditional;
            return Task.CompletedTask;
        }
    }

    private static int FirstAfter<T>(List<T> list, long after, Func<T, long> id)
    {
        int lo = 0, hi = list.Count;
        while (lo < hi)
        {
            var mid = (lo + hi) / 2;
            if (id(list[mid]) <= after) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    public Task<StoredChanges> LoadChangesAsync(int electionId, LiveCursor after, int limit, CancellationToken ct)
    {
        lock (gate)
        {
            Available();
            var snaps = new List<(long, TerritorySnapshot)>();
            if (snapshots.TryGetValue(electionId, out var all))
                for (var i = FirstAfter(all, after.Snapshot, s => s.Id); i < all.Count && snaps.Count < limit; i++) snaps.Add(all[i]);
            var full = snaps.Count == limit;
            var visible = full ? snaps[^1].Item1 : long.MaxValue;

            var evs = new List<StoredEvent>();
            var cut = false;
            if (events.TryGetValue(electionId, out var allEvents))
            {
                for (var i = FirstAfter(allEvents, after.Event, e => e.Event.Id); i < allEvents.Count && evs.Count < limit; i++)
                {
                    if (allEvents[i].SnapshotId > visible)
                    {
                        cut = true;
                        break;
                    }
                    evs.Add(allEvents[i]);
                }
            }

            var terr = new List<TerritorySnapshot>();
            var territoryCursor = after.Territory;
            if (territoryRevisions.TryGetValue(electionId, out var index))
            {
                foreach (var (rev, key) in index.Where(kv => kv.Key > after.Territory).Take(limit))
                {
                    territoryCursor = rev;
                    terr.Add(territories[electionId][key].Snapshot);
                }
            }

            var acc = new List<(string, AccompanimentFile)>();
            var accompanimentCursor = after.Accompaniment;
            if (accompaniments.TryGetValue(electionId, out var files))
            {
                foreach (var (scope, value) in files.Where(kv => kv.Value.Revision > after.Accompaniment).OrderBy(kv => kv.Value.Revision).Take(limit))
                {
                    accompanimentCursor = value.Revision;
                    acc.Add((scope, value.File));
                }
            }

            SourceHealth? source = null;
            var sourceCursor = after.Source;
            if (health.TryGetValue(electionId, out var h) && h.Revision > after.Source)
            {
                source = h.Health;
                sourceCursor = h.Revision;
            }

            var cursor = new LiveCursor(snaps.Count > 0 ? snaps[^1].Item1 : after.Snapshot, evs.Count > 0 ? evs[^1].Event.Id : after.Event, territoryCursor, accompanimentCursor, sourceCursor);
            var changes = new StoredChanges(snaps, evs, terr, acc, source, cursor, full || cut || evs.Count == limit || terr.Count == limit || acc.Count == limit);
            RowsRead += changes.Rows;
            RowsPerLoad.Add(changes.Rows);
            return Task.FromResult(changes);
        }
    }

    public Task<IReadOnlyDictionary<string, TseConditional>> LoadConditionalsAsync(int electionId, CancellationToken ct)
    {
        lock (gate)
        {
            Available();
            return Task.FromResult<IReadOnlyDictionary<string, TseConditional>>(new Dictionary<string, TseConditional>(conditionals, StringComparer.Ordinal));
        }
    }

    public Task<(byte[] Content, string ContentType)?> LoadPhotoAsync(string sqcand, CancellationToken ct) => Task.FromResult<(byte[], string)?>(null);

    public Task SavePhotoAsync(string sqcand, byte[] content, string contentType, string? etag, string sourceUrl, CancellationToken ct)
    {
        lock (gate) Write();
        return Task.CompletedTask;
    }

    public Task<bool> PingAsync(CancellationToken ct) => Task.FromResult(!Down);
}
