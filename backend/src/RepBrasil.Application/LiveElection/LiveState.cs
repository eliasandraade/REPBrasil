using System.Collections.Immutable;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Application.LiveElection;

/// <summary>Configuração da apuração ao vivo. Padrões seguros: desligada; intervalos conservadores; teto rígido de 80 req/s.</summary>
public sealed record LiveElectionOptions
{
    /// <summary>Limite oficial do TSE é 100 req/s por IP; o REPBrasil nunca passa de 80, e opera muito abaixo.</summary>
    public const int HardMaxRequestsPerSecond = 80;

    public bool Enabled { get; init; }
    public string Mode { get; init; } = "official";
    public int Year { get; init; } = 2026;
    public string Cycle { get; init; } = "ele2026";
    public int Round { get; init; } = 2;
    public int OfficeCode { get; init; } = 1;
    public int? ExpectedElectionCode { get; init; } = 6258;
    public int? ExpectedPleitoCode { get; init; } = 3221;
    public int? ExpectedFirstRoundElectionCode { get; init; } = 6257;
    public string SimulationEnvironment { get; init; } = "simulado2026";
    public int? SimulationExpectedElectionCode { get; init; } = 22410;
    /// <summary>Início da totalização (horário de Brasília) na data da eleição do EA11.</summary>
    public TimeOnly TotalizationStartLocal { get; init; } = new(17, 0);
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromSeconds(1);
    public TimeSpan IdlePollInterval { get; init; } = TimeSpan.FromSeconds(15);
    public TimeSpan AccompanimentInterval { get; init; } = TimeSpan.FromSeconds(3);
    public TimeSpan StateAccompanimentInterval { get; init; } = TimeSpan.FromSeconds(30);
    public TimeSpan MunicipalCacheTtl { get; init; } = TimeSpan.FromSeconds(20);
    public int MaxRequestsPerSecond { get; init; } = 20;
    public int BackgroundRequestsPerSecond { get; init; } = 8;
    public int PriorityMunicipalities { get; init; } = 100;
    public TimeSpan StaleAfter { get; init; } = TimeSpan.FromMinutes(5);
    public TimeSpan NotFoundCooldown { get; init; } = TimeSpan.FromSeconds(60);
    public TimeSpan BlockPause { get; init; } = TimeSpan.FromMinutes(11);
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(8);
    /// <summary>Velocidade do replay (1, 5, 10, 30…); 0 = instantâneo.</summary>
    public double ReplaySpeed { get; init; } = 10;
    public TimeSpan ReplayStep { get; init; } = TimeSpan.FromSeconds(60);
    public int MaxSseConnections { get; init; } = 20_000;
    /// <summary>
    /// Por origem (IPv4, ou o /64 de um IPv6). Alto de propósito: operadoras móveis usam CGNAT e muitos visitantes
    /// compartilham um IP. Com o servidor sob pressão (80% de <see cref="MaxSseConnections"/>), vale o teto menor
    /// <see cref="MaxSsePerIpUnderPressure"/>: as vagas que restam ficam para origens distintas.
    /// </summary>
    public int MaxSsePerIp { get; init; } = 2_000;
    public int MaxSsePerIpUnderPressure { get; init; } = 256;
    /// <summary>Réplica seguidora: leitura incremental do banco a cada aviso da líder ou, sem aviso, neste intervalo.</summary>
    public TimeSpan FollowerSyncInterval { get; init; } = TimeSpan.FromSeconds(2);
    /// <summary>Replay: quadros em que a "fonte" fica fora do ar (teste de fonte indisponível e recuperação).</summary>
    public (int From, int To)? ReplayOutage { get; init; }
    /// <summary>Só para testes com mais de uma réplica em replay: nome fixo do ambiente (todas leem e gravam a mesma eleição).</summary>
    public string? ReplayEnvironment { get; init; }
    public TimeSpan SseHeartbeat { get; init; } = TimeSpan.FromSeconds(15);

    public int EffectiveMaxRequestsPerSecond => Math.Clamp(MaxRequestsPerSecond, 1, HardMaxRequestsPerSecond);

    public int EffectiveBackgroundRequestsPerSecond => Math.Clamp(BackgroundRequestsPerSecond, 1, EffectiveMaxRequestsPerSecond);
}

public static class LiveModes
{
    public const string Official = "official";
    public const string Simulation = "simulation";
    public const string Replay = "replay";

    public static bool IsValid(string mode) => mode is Official or Simulation or Replay;
}

/// <summary>Contexto fixo da eleição em acompanhamento (descoberto no EA11 + EA12).</summary>
public sealed class LiveElectionContext
{
    private readonly Dictionary<string, (string Uf, Ea12Municipality Municipality)> municipalities = new(StringComparer.Ordinal);

    public LiveElectionContext(string mode, TseEnvironment environment, DiscoveredElection election, int year, DateTimeOffset? totalizationStartsAt, Ea12Config? config)
    {
        Mode = mode;
        Environment = environment;
        Election = election;
        Year = year;
        TotalizationStartsAt = totalizationStartsAt;
        Config = config;
        if (config is null) return;
        foreach (var uf in config.Ufs)
            foreach (var m in uf.Municipalities)
                municipalities[m.TseCode] = (uf.Uf, m);
    }

    public string Mode { get; }
    public TseEnvironment Environment { get; }
    public DiscoveredElection Election { get; }
    public int Year { get; }
    public DateTimeOffset? TotalizationStartsAt { get; }
    public Ea12Config? Config { get; }

    public IEnumerable<Ea12Uf> Ufs => Config?.Ufs ?? [];

    public bool TryMunicipality(string tseCode, out string uf, out Ea12Municipality municipality)
    {
        if (municipalities.TryGetValue(tseCode, out var found))
        {
            uf = found.Uf;
            municipality = found.Municipality;
            return true;
        }
        uf = "";
        municipality = null!;
        return false;
    }

    public Ea12Municipality? Capital(string uf) => Config?.Ufs.FirstOrDefault(u => u.Uf == uf)?.Municipalities.FirstOrDefault(m => m.Capital);

    public int BrazilianMunicipalityCount => Config?.Ufs.Where(u => u.Uf != "zz").Sum(u => u.Municipalities.Count) ?? 0;
}

public sealed record TimelinePoint(
    long Version,
    DateTimeOffset? At,
    DateTimeOffset IngestedAt,
    decimal? SectionsPct,
    decimal? ElectoratePct,
    long? SectionsTotalized,
    long? TotalVotes,
    long? ElectorateInTotalized,
    IReadOnlyList<CandidateTally> Candidates,
    string? LeaderKey,
    long? LeadVotes,
    decimal? LeadPp)
{
    public static TimelinePoint From(long version, TerritorySnapshot s) => new(
        version,
        s.TotalizedAt,
        s.IngestedAt,
        s.Sections.TotalizedPct,
        s.Electorate.InTotalizedPct,
        s.Sections.Totalized,
        s.Votes.Total,
        s.Electorate.InTotalized,
        s.Candidates,
        s.LeaderKey,
        s.LeadVotes,
        s.LeadPp);
}

public static class LiveEventTypes
{
    public const string TotalizationStarted = "totalization-started";
    public const string SectionsMilestone = "sections-milestone";
    public const string LeadChange = "lead-change";
    public const string MathematicallyDefined = "mathematically-defined";
    public const string Finalized = "finalized";
    public const string SourceStale = "source-stale";
    public const string SourceRecovered = "source-recovered";
    public const string DataCorrection = "data-correction";
    public const string Reprocessing = "reprocessing";
    /// <summary>Interno: o validador do REPBrasil atingiu a desigualdade antes do sinal oficial md=e.</summary>
    public const string MathThreshold = "math-threshold";
    public const string ContractError = "contract-error";
    public const string DiscoveryWarning = "discovery-warning";
}

/// <summary>Evento persistido (trilha de auditoria). Visibility "internal" nunca vai para o público.</summary>
public sealed record LiveEvent(
    long Id,
    string Type,
    string Visibility,
    string? DedupeKey,
    string Scope,
    string Code,
    DateTimeOffset? At,
    DateTimeOffset DetectedAt,
    string Title,
    string? Detail,
    decimal? SectionsPct,
    IReadOnlyDictionary<string, object?> Payload)
{
    public bool IsPublic => Visibility == "public";
}

public sealed record LeadChangeRecord(
    long Id,
    DateTimeOffset? At,
    DateTimeOffset DetectedAt,
    string? PreviousLeaderKey,
    string NewLeaderKey,
    decimal? SectionsPct,
    IReadOnlyList<CandidateTally> Votes,
    long? LeadVotes,
    long SnapshotVersion);

public sealed record DefinedSnapshot(
    string LeaderKey,
    long? Votes,
    decimal? Pct,
    long? LeadVotes,
    decimal? SectionsPct,
    DateTimeOffset? DefinedAt,
    DateTimeOffset DetectedAt);

/// <summary>Os dois níveis da definição matemática: sinal oficial md=e e validador independente do REPBrasil.</summary>
public sealed record MathTracking(
    DateTimeOffset? TseDefinedAt,
    DateTimeOffset? TseSignalDetectedAt,
    DateTimeOffset? RepBrasilDetectedAt,
    DefinedSnapshot? Defined)
{
    public static readonly MathTracking Empty = new(null, null, null, null);
}

/// <summary>
/// Saúde do arquivo nacional. Três instantes distintos: LastCheckedAt = última tentativa (qualquer resultado);
/// LastSuccessAt = última resposta válida (200 ou 304); LastChangeAt = última vez em que o CONTEÚDO mudou (hash do
/// snapshot). Respostas 200 repetidas com o mesmo conteúdo não contam como mudança: é ela que define a defasagem.
/// </summary>
public sealed record SourceHealth(
    bool Healthy,
    bool Stale,
    DateTimeOffset? StaleSince,
    DateTimeOffset? LastSuccessAt,
    DateTimeOffset? LastCheckedAt,
    DateTimeOffset? LastChangeAt,
    DateTimeOffset? LastFileGeneratedAt,
    int ConsecutiveFailures,
    string? LastError,
    DateTimeOffset? BlockedUntil)
{
    public static readonly SourceHealth Initial = new(true, false, null, null, null, null, null, 0, null, null);

    public bool Failing => ConsecutiveFailures >= 3 || BlockedUntil is not null;
}

public sealed record FirstRoundBaseline(
    int ElectionCode,
    TerritorySnapshot? National,
    ImmutableDictionary<string, TerritorySnapshot> States,
    ImmutableDictionary<string, TerritorySnapshot> Municipalities)
{
    public static FirstRoundBaseline Empty(int code) =>
        new(code, null, ImmutableDictionary<string, TerritorySnapshot>.Empty, ImmutableDictionary<string, TerritorySnapshot>.Empty);
}

/// <summary>
/// Estado completo e imutável servido pela API. Trocado atomicamente (uma referência): nenhum leitor vê o candidato A
/// de um snapshot e o candidato B de outro.
/// </summary>
public sealed record LiveElectionState(
    LiveElectionContext Context,
    long NationalVersion,
    long StatesVersion,
    TerritorySnapshot? National,
    ImmutableDictionary<string, TerritorySnapshot> States,
    AccompanimentFile? NationalAccompaniment,
    ImmutableDictionary<string, AccompanimentFile> StateAccompaniment,
    ImmutableDictionary<string, TerritorySnapshot> Municipalities,
    ImmutableDictionary<string, TerritorySnapshot> Zones,
    ImmutableList<TimelinePoint> Timeline,
    ImmutableDictionary<string, ImmutableList<TimelinePoint>> StateTimelines,
    ImmutableList<LiveEvent> Events,
    ImmutableList<LeadChangeRecord> LeadChanges,
    MathTracking Math,
    SourceHealth Source,
    FirstRoundBaseline? FirstRound,
    LivePhase Phase,
    string? LastLeaderKey)
{
    public static LiveElectionState Initial(LiveElectionContext context) => new(
        context,
        0,
        0,
        null,
        ImmutableDictionary<string, TerritorySnapshot>.Empty,
        null,
        ImmutableDictionary<string, AccompanimentFile>.Empty,
        ImmutableDictionary<string, TerritorySnapshot>.Empty,
        ImmutableDictionary<string, TerritorySnapshot>.Empty,
        ImmutableList<TimelinePoint>.Empty,
        ImmutableDictionary<string, ImmutableList<TimelinePoint>>.Empty,
        ImmutableList<LiveEvent>.Empty,
        ImmutableList<LeadChangeRecord>.Empty,
        MathTracking.Empty,
        SourceHealth.Initial,
        null,
        LivePhase.PRE_ELECTION,
        null);
}

public enum TseFetchStatus
{
    Ok,
    NotModified,
    NotFound,
    Failed,
    Blocked,
    Skipped,
}

/// <summary>Crítico: nacional, EA14 e UFs; normal: capitais e municípios pedidos; background: varredura municipal e zonas.</summary>
public enum TsePriority
{
    Critical,
    Normal,
    Background,
}

public sealed record TseConditional(string? ETag, string? LastModified);

public sealed record TseFetchResult(
    TseFetchStatus Status,
    int HttpStatus,
    byte[]? Body,
    string? ETag,
    string? LastModified,
    TimeSpan Duration,
    string? Error,
    DateTimeOffset ReceivedAt);

/// <summary>Fonte dos arquivos (HTTP com limite, cache condicional e disjuntor; ou replay). Nunca lança por resposta HTTP.</summary>
public interface ITseSource
{
    Task<TseFetchResult> FetchAsync(Uri url, TseConditional? conditional, TsePriority priority, CancellationToken ct);
}

/// <summary>Posição da leitura incremental: maior id (snapshots, eventos) ou revision (último valor) já aplicado.</summary>
public sealed record LiveCursor(long Snapshot, long Event, long Territory, long Accompaniment, long Source)
{
    public static readonly LiveCursor Start = new(0, 0, 0, 0, 0);
}

/// <summary>Evento persistido com o id do snapshot nacional que o originou (evidência do md=e, votos da troca de liderança).</summary>
public sealed record StoredEvent(LiveEvent Event, long? SnapshotId);

/// <summary>
/// Linhas gravadas depois de um cursor, em ordem de gravação e numa única leitura consistente do banco. A partida
/// lê do início (em páginas); a réplica seguidora lê só o que veio depois do último cursor — o custo de cada
/// sincronização depende do que mudou, nunca do tamanho do histórico.
/// </summary>
public sealed record StoredChanges(
    IReadOnlyList<(long Id, TerritorySnapshot Snapshot)> Snapshots,
    IReadOnlyList<StoredEvent> Events,
    IReadOnlyList<TerritorySnapshot> Territories,
    IReadOnlyList<(string Scope, AccompanimentFile File)> Accompaniments,
    SourceHealth? Source,
    LiveCursor Cursor,
    bool More)
{
    public static StoredChanges Empty(LiveCursor cursor) => new([], [], [], [], null, cursor, false);

    public int Rows => Snapshots.Count + Events.Count + Territories.Count + Accompaniments.Count + (Source is null ? 0 : 1);
}

/// <summary>Gravação recusada porque esta réplica não detém a liderança: só a líder escreve na trilha.</summary>
public sealed class LiveLeadershipLostException(string message, Exception? inner = null) : InvalidOperationException(message, inner);

public interface ILiveElectionStore
{
    Task<int> EnsureElectionAsync(LiveElectionContext context, CancellationToken ct);

    /// <summary>Só leitura (réplicas seguidoras): id da eleição registrada pela líder, ou null se ainda não existe.</summary>
    Task<int?> FindElectionAsync(LiveElectionContext context, CancellationToken ct);

    /// <summary>Grava o snapshot se o conteúdo difere do último da abrangência. Retorna o id, ou null (deduplicado).</summary>
    Task<long?> SaveSnapshotAsync(int electionId, TerritorySnapshot snapshot, ReadOnlyMemory<byte>? raw, CancellationToken ct);

    Task SaveTerritoryLatestAsync(int electionId, TerritorySnapshot snapshot, CancellationToken ct);

    /// <summary>Último EA14 ('br') ou EA15 (UF) recebido; as seguidoras o leem em vez de consultar o TSE.</summary>
    Task SaveAccompanimentAsync(int electionId, string scope, AccompanimentFile file, string contentHash, DateTimeOffset ingestedAt, CancellationToken ct);

    /// <summary>Saúde da fonte vista pela líder (as seguidoras exibem a mesma fase).</summary>
    Task SaveSourceHealthAsync(int electionId, SourceHealth health, CancellationToken ct);

    /// <summary>Grava o evento (imutável). Retorna o id, ou null quando a chave de deduplicação já existia.</summary>
    Task<long?> SaveEventAsync(int electionId, LiveEvent liveEvent, long? snapshotId, CancellationToken ct);

    Task SaveSourceStateAsync(int electionId, string url, TseConditional conditional, int httpStatus, DateTimeOffset at, bool changed, CancellationToken ct);

    /// <summary>O que foi gravado depois de <paramref name="after"/> (no máximo <paramref name="limit"/> linhas por tabela).</summary>
    Task<StoredChanges> LoadChangesAsync(int electionId, LiveCursor after, int limit, CancellationToken ct);

    /// <summary>ETag/Last-Modified por URL (o GET condicional sobrevive a reinícios).</summary>
    Task<IReadOnlyDictionary<string, TseConditional>> LoadConditionalsAsync(int electionId, CancellationToken ct);

    Task<(byte[] Content, string ContentType)?> LoadPhotoAsync(string sqcand, CancellationToken ct);

    Task SavePhotoAsync(string sqcand, byte[] content, string contentType, string? etag, string sourceUrl, CancellationToken ct);

    Task<bool> PingAsync(CancellationToken ct);
}
