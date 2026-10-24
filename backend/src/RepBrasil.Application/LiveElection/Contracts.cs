namespace RepBrasil.Application.LiveElection;

// Contrato público da apuração ao vivo. Espelhado em frontend/src/lib/live-election/types.ts (JSON camelCase).
// null = não publicado pela fonte / ainda indisponível; nunca zero. Percentuais em 0–100.

public sealed record LiveEnvelope<T>(T Data, LiveMetaDto Meta);

public sealed record LiveMetaDto(
    string Source,
    string Mode,
    string Phase,
    int ElectionCode,
    long SnapshotVersion,
    DateTimeOffset? SourceGeneratedAt,
    DateTimeOffset? TotalizedAt,
    DateTimeOffset? IngestedAt,
    DateTimeOffset PublishedAt,
    double? AgeSeconds,
    double? SourceDelaySeconds,
    string Coverage,
    bool IsFinal,
    bool IsMathematicallyDefined);

public sealed record SectionTotalsDto(
    long? Total,
    long? Totalized,
    long? NotTotalized,
    long? Installed,
    long? NotInstalled,
    long? Counted,
    long? NotCounted,
    decimal? TotalizedPct,
    decimal? InstalledPct,
    decimal? CountedPct);

public sealed record ElectorateTotalsDto(
    long? Total,
    long? InTotalized,
    long? InNotTotalized,
    long? InInstalled,
    long? InNotInstalled,
    long? InCounted,
    long? InNotCounted,
    long? Turnout,
    long? Abstention,
    decimal? InTotalizedPct,
    decimal? InCountedPct,
    decimal? InCountedOfTotalPct,
    decimal? TurnoutPct,
    decimal? AbstentionPct);

public sealed record VoteTotalsDto(
    long? Total,
    long? ToCandidates,
    long? Valid,
    long? Nominal,
    long? Annulled,
    long? AnnulledSubJudice,
    long? Blank,
    long? NullTotal,
    long? Null,
    long? TechnicalNull,
    long? AnnulledSections,
    long? NoCandidate,
    decimal? ValidPct,
    decimal? BlankPct,
    decimal? NullTotalPct,
    decimal? AnnulledPct);

public sealed record CoalitionDto(string Name, string Kind, string? Composition);

public sealed record RunningMateDto(string Name, string BallotName, string? Party);

public sealed record LiveCandidateDto(
    string Key,
    string Slot,
    int Number,
    string Name,
    string BallotName,
    string? Party,
    string? PartyName,
    CoalitionDto? Coalition,
    RunningMateDto? Vice,
    string? PhotoUrl,
    string? Destination,
    string? Situation,
    bool Elected,
    int Position);

public sealed record CandidateVotesDto(string Key, long? Votes, decimal? Pct);

public sealed record TerritoryResultDto(
    string Scope,
    string Code,
    string? Uf,
    string Name,
    string? Region,
    bool Capital,
    IReadOnlyList<CandidateVotesDto> Candidates,
    string? LeaderKey,
    long? LeadVotes,
    decimal? LeadPp,
    SectionTotalsDto Sections,
    ElectorateTotalsDto Electorate,
    VoteTotalsDto Votes,
    string Progress,
    DateTimeOffset? TotalizedAt,
    DateTimeOffset? GeneratedAt,
    DateTimeOffset? IngestedAt,
    string Coverage,
    bool Available);

public sealed record OfficialStatusDto(
    string Progress,
    bool FinalTotalization,
    string? MathematicallyDefinedFlag,
    bool VotesReleased,
    string? NonFinalReason,
    bool? NoElectedAttribution,
    IReadOnlyList<string> NoElectedReasons);

public sealed record IndependentMathDto(
    bool Available,
    string? Reason,
    string? LeaderKey,
    string? RunnerUpKey,
    long? LeaderVotes,
    long? RunnerUpVotes,
    long? LeadVotes,
    long? RemainingElectorateUpperBound,
    long? MaxPossibleTrailingCandidate,
    long? VotesNeededForTrailingCandidate,
    long? DistanceToIrreversibility,
    bool InvariantsOk);

public sealed record OfficialMathDto(string? Flag, bool Defined, DateTimeOffset? DefinedAt, DateTimeOffset? DetectedAt);

public sealed record MathStatusDto(OfficialMathDto Official, IndependentMathDto Independent);

public sealed record SourceStatusDto(
    bool Healthy,
    bool Stale,
    DateTimeOffset? StaleSince,
    DateTimeOffset? LastFileGeneratedAt,
    DateTimeOffset? LastReceivedAt,
    DateTimeOffset? LastCheckedAt,
    double? DelaySeconds,
    string? Message);

public sealed record VelocityWindowDto(int Minutes, decimal? VotesPerMinute, decimal? SectionsPerMinute, decimal? ElectoratePerMinute, int Samples);

public sealed record EtaDto(DateTimeOffset At, int BasisMinutes);

public sealed record VelocityDto(IReadOnlyList<VelocityWindowDto> Windows, EtaDto? Eta);

public sealed record LiveTimelineEventDto(
    long Id,
    string Type,
    DateTimeOffset? At,
    DateTimeOffset DetectedAt,
    string Title,
    string? Detail,
    decimal? SectionsPct);

public sealed record DefinedSnapshotDto(
    string LeaderKey,
    long? Votes,
    decimal? Pct,
    long? LeadVotes,
    decimal? SectionsPct,
    DateTimeOffset? DefinedAt,
    DateTimeOffset DetectedAt);

public sealed record ElectionInfoDto(
    int Year,
    int Round,
    int ElectionCode,
    int? FirstRoundElectionCode,
    int? PleitoCode,
    int OfficeCode,
    string OfficeName,
    string? Date,
    string Mode,
    string Environment,
    string Cycle);

public sealed record LiveSummaryDto(
    ElectionInfoDto Election,
    string Phase,
    OfficialStatusDto Official,
    IReadOnlyList<LiveCandidateDto> Candidates,
    TerritoryResultDto National,
    MathStatusDto Math,
    SourceStatusDto Source,
    VelocityDto Velocity,
    IReadOnlyList<LiveTimelineEventDto> Events,
    DefinedSnapshotDto? Defined);

public sealed record NationalUpdateDto(
    string Phase,
    OfficialStatusDto Official,
    TerritoryResultDto National,
    MathStatusDto Math,
    SourceStatusDto Source,
    VelocityDto Velocity,
    DefinedSnapshotDto? Defined);

public sealed record CandidatesPayloadDto(IReadOnlyList<LiveCandidateDto> Candidates);

public sealed record RemainingByUfDto(
    string Uf,
    string Name,
    string? Region,
    long? SectionsRemaining,
    long? ElectorateNotTotalized,
    long? ElectorateNotCounted,
    long? RemainingUpperBound,
    decimal? ShareOfRemaining,
    decimal? TotalizedPct,
    DateTimeOffset? UpdatedAt);

public sealed record MunicipalityCoverageDto(int Total, int WithData, decimal CoveragePct, bool Complete, IReadOnlyDictionary<string, int>? Leading);

public sealed record TerritorialSummaryDto(
    IReadOnlyDictionary<string, int> UfsLeading,
    int UfsTied,
    int UfsWithoutVotes,
    MunicipalityCoverageDto Municipalities);

public sealed record LiveStatesPayloadDto(
    IReadOnlyList<TerritoryResultDto> States,
    TerritoryResultDto? Exterior,
    IReadOnlyList<TerritoryResultDto> Regions,
    IReadOnlyList<RemainingByUfDto> Remaining,
    TerritorialSummaryDto Summary);

public sealed record TimelinePointDto(
    DateTimeOffset? At,
    DateTimeOffset IngestedAt,
    decimal? SectionsPct,
    decimal? ElectoratePct,
    IReadOnlyList<CandidateVotesDto> Candidates,
    string? LeaderKey,
    long? LeadVotes,
    decimal? LeadPp);

public sealed record LeadChangeDto(
    long Id,
    DateTimeOffset? At,
    DateTimeOffset DetectedAt,
    string? PreviousLeaderKey,
    string NewLeaderKey,
    decimal? SectionsPct,
    IReadOnlyList<CandidateVotesDto> Votes,
    long? LeadVotes,
    long SnapshotVersion);

public sealed record LiveTimelinePayloadDto(string Scope, string Code, IReadOnlyList<TimelinePointDto> Points, IReadOnlyList<LeadChangeDto> LeadChanges);

public sealed record StateDetailPayloadDto(
    TerritoryResultDto State,
    TerritoryResultDto? Capital,
    TerritoryResultDto? Interior,
    IReadOnlyList<TimelinePointDto> Timeline,
    FirstRoundComparisonDto? FirstRound);

public sealed record MunicipalityListItemDto(
    string Code,
    string? IbgeCode,
    string Name,
    string Uf,
    bool Capital,
    long? Electorate,
    decimal? SectionsPct,
    string Progress,
    DateTimeOffset? TotalizedAt,
    TerritoryResultDto? Result);

public sealed record MunicipalitiesPayloadDto(string Uf, string Name, IReadOnlyList<MunicipalityListItemDto> Municipalities, decimal CoveragePct);

public sealed record MunicipalityDetailPayloadDto(TerritoryResultDto Municipality, string? IbgeCode, IReadOnlyList<string> Zones, FirstRoundComparisonDto? FirstRound);

public sealed record ZoneMunicipalityDto(string Code, string Name, string Uf);

public sealed record ZonesPayloadDto(ZoneMunicipalityDto Municipality, IReadOnlyList<TerritoryResultDto> Zones);

public sealed record RankingPayloadDto(string Kind, string Basis, IReadOnlyList<TerritoryResultDto> Items, decimal CoveragePct);

public sealed record FirstRoundSideDto(long? Votes, decimal? Pct, int? Position);

public sealed record SecondRoundSideDto(long? Votes, decimal? Pct);

public sealed record RoundComparisonCandidateDto(
    string Key,
    string? MatchedBy,
    FirstRoundSideDto? FirstRound,
    SecondRoundSideDto SecondRound,
    long? DiffVotes,
    decimal? DeltaPp);

public sealed record RoundValueDto(long? Count, decimal? Pct);

public sealed record TurnoutComparisonDto(string Metric, RoundValueDto FirstRound, RoundValueDto SecondRound, long? DeltaCount, decimal? DeltaPp);

public sealed record FirstRoundComparisonDto(
    bool Available,
    int? FirstRoundElectionCode,
    string Scope,
    string Code,
    string Name,
    IReadOnlyList<RoundComparisonCandidateDto> Candidates,
    IReadOnlyList<TurnoutComparisonDto> Turnout,
    decimal? SecondRoundSectionsPct,
    string Note);

public sealed record LiveHealthPublicDto(
    string Status,
    string Mode,
    string Phase,
    DateTimeOffset? LastSuccessAt,
    DateTimeOffset? LastNationalUpdateAt,
    double? DataAgeSeconds,
    bool Stale,
    long TseRequests);
