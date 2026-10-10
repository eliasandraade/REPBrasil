namespace RepBrasil.Application.Electoral;

// ── Conceitos compartilhados ────────────────────────────────────────────────

/// <summary>
/// Estado de um valor de votação num território. Ausência nunca vira zero:
/// <c>value</c>/<c>zero</c> só existem quando o BU oficial do cargo cobre o território e a
/// candidatura tem vínculo auditado com o BU.
/// </summary>
public static class CellState
{
    public const string Value = "value";
    /// <summary>Zero REAL: o BU do cargo existe no território e a candidatura não teve voto ali.</summary>
    public const string Zero = "zero";
    /// <summary>O território está fora da unidade da disputa (ex.: vereadora de outro município).</summary>
    public const string OutsideContest = "outside_contest";
    /// <summary>Sem Boletim de Urna importado para o cargo no território.</summary>
    public const string NoCoverage = "no_coverage";
    /// <summary>Parte das zonas do território tem BU importado: o número é parcial.</summary>
    public const string PartialCoverage = "partial_coverage";
    /// <summary>A candidatura não foi inserida na urna (informação complementar oficial do TSE).</summary>
    public const string NotOnBallot = "not_on_ballot";
    /// <summary>Sem vínculo auditado votável do BU → candidatura: nenhum número é afirmado.</summary>
    public const string Unlinked = "unlinked";
    /// <summary>Vice ou suplente: votado na chapa do titular (os votos são da chapa, ver <c>Ticket</c>).</summary>
    public const string TicketMember = "ticket_member";
    /// <summary>A pessoa não tem candidatura naquela eleição.</summary>
    public const string Absent = "absent";
}

/// <summary>Comparabilidade entre duas candidaturas (disputas).</summary>
public static class ContestComparability
{
    public const string Comparable = "comparable_contest";
    public const string DifferentOffice = "different_office";
    public const string DifferentTerritorialScope = "different_territorial_scope";
    public const string Unavailable = "direct_comparison_unavailable";
}

/// <summary>Comparabilidade de um território entre eleições.</summary>
public static class TerritoryComparability
{
    public const string Comparable = "comparable";
    /// <summary>Mesma seção (UF + município + zona + número), conjunto principal+agregadas diferente.</summary>
    public const string SectionCompositionChanged = "section_composition_changed";
    public const string CoverageOrSectionMissing = "coverage_or_section_missing";
}

public record InsightDto(string Code, IReadOnlyDictionary<string, object?> Values, string Text);

public record ElectoralUnitDto(string Scope, string Code, string Name, string? Uf);

public record ContestRefDto(
    int Year, int Round, int ElectionCode, int OfficeCode, string OfficeName, ElectoralUnitDto Unit);

public record DerivedFreshnessDto(bool Stale, DateTime? RefreshedAt, string Note);

// ── Raio X do perfil ────────────────────────────────────────────────────────

public record TicketDto(
    string Role, Guid? HeadCandidacyId, string? HeadBallotName, int? HeadOfficeCode, long? HeadVotes, double? HeadShare,
    string Note);

public record CandidacyTotalsDto(
    long? Votes, long? ValidVotes, double? ShareOfValidVotes, int? Rank, int? CandidatesWithVotes,
    string State, CoverageSummaryDto Coverage);

public record CoverageSummaryDto(bool Complete, int ZonesImported, int ZonesExpected, string Note);

public record CandidacyRecordsDto(
    IReadOnlyList<string> SocialNetworks,
    IReadOnlyDictionary<string, object?>? Complement);

public record AssetsSummaryDto(int Items, decimal Total);

public record FinanceSummaryDto(
    decimal? Revenues, decimal? ExpensesContracted, decimal? ExpensesPaid, int Records, string? AccountsType);

public record XrayCandidacyDto(
    Guid CandidacyId,
    long TseCandidateId,
    ContestRefDto Contest,
    int Number,
    string BallotName,
    PartyDto? Party,
    string? FederationAcronym,
    string? CoalitionName,
    string? CandidacyStatus,
    string? RoundOutcome,
    bool? Elected,
    string IdentityStatus,
    string? IdentityMethod,
    TicketDto? Ticket,
    CandidacyTotalsDto Totals,
    AssetsSummaryDto? Assets,
    FinanceSummaryDto? Finance,
    CandidacyRecordsDto Records,
    CandidacySourceDto Source);

public record PriorCandidacyDto(
    int Year, int Round, long TseCandidateId, int? OfficeCode, string? OfficeName, string? Unit, string? UnitName,
    int? Number, string? BallotName, string? PartyAcronym, string? Outcome, bool Imported, Guid? CandidacyId);

public record EvolutionStepDto(
    Guid FromCandidacyId, Guid ToCandidacyId, string Comparability,
    long? FromVotes, long? ToVotes, long? DeltaVotes, double? DeltaPercent,
    double? FromShare, double? ToShare, double? DeltaSharePoints);

public record AssetsStepDto(
    Guid FromCandidacyId, Guid ToCandidacyId, decimal FromTotal, decimal ToTotal, decimal Delta, double? DeltaPercent,
    int Added, int Removed, int Kept);

public record XrayResponse(
    Guid PoliticianId,
    Guid? PersonId,
    string Name,
    IReadOnlyList<XrayCandidacyDto> Candidacies,
    IReadOnlyList<PriorCandidacyDto> OfficialHistory,
    IReadOnlyList<EvolutionStepDto> Evolution,
    IReadOnlyList<AssetsStepDto> AssetsEvolution,
    IReadOnlyList<InsightDto> Insights,
    DerivedFreshnessDto Freshness,
    IReadOnlyDictionary<string, string> Definitions);

// ── Distribuição territorial de uma candidatura ─────────────────────────────

public record TerritoryValueDto(
    string Uf, string? MunicipalityTseCode, string? MunicipalityName, int? Zone, int? Section,
    IReadOnlyList<int>? SectionMembers, string? PlaceCode, string? PlaceName, double? Latitude, double? Longitude,
    long? Votes, long? ValidVotes, double? Share, long? Eligible, long? Turnout, int Urns, string State);

public record DistributionSummaryDto(
    long? Votes, int TerritoriesWithVotes, int TerritoriesCovered, double? TopFiveConcentration, double? Hhi,
    TerritoryValueDto? Best, TerritoryValueDto? Worst, TerritoryValueDto? BestShare);

public record CandidacyTerritoryResponse(
    Guid CandidacyId, ContestRefDto Contest, string Level, string? MunicipalityTseCode, int? Zone,
    IReadOnlyList<TerritoryValueDto> Territories, DistributionSummaryDto Summary, IReadOnlyList<InsightDto> Insights,
    DerivedFreshnessDto Freshness, IReadOnlyDictionary<string, string> Definitions);

// ── Bens declarados ─────────────────────────────────────────────────────────

public record AssetItemDto(int? TypeCode, string? Type, string? Description, decimal Value);

public record AssetDiffItemDto(string Status, int? TypeCode, string? Type, string? Description, decimal? FromValue, decimal? ToValue);

public record CandidacyAssetsResponse(
    Guid CandidacyId, int Year, IReadOnlyList<AssetItemDto> Items, decimal Total,
    Guid? CompareToCandidacyId, int? CompareToYear, decimal? CompareToTotal, decimal? Delta, double? DeltaPercent,
    IReadOnlyList<AssetDiffItemDto> Diff, IReadOnlyList<AssetTypeTotalDto> ByType, string Note);

public record AssetTypeTotalDto(int? TypeCode, string? Type, decimal Total, int Items, decimal? CompareToTotal);

// ── Prestação de contas ─────────────────────────────────────────────────────

public record FinanceCategoryDto(string Kind, string Category, decimal Amount, int Records);

public record FinanceCounterpartyDto(string Kind, string? Name, string CounterpartyKind, string? Cnpj, decimal Amount, int Records);

public record CandidacyFinanceResponse(
    Guid CandidacyId, decimal? Revenues, decimal? ExpensesContracted, decimal? ExpensesPaid,
    IReadOnlyList<FinanceCategoryDto> Categories, IReadOnlyList<FinanceCounterpartyDto> TopDonors,
    IReadOnlyList<FinanceCounterpartyDto> TopSuppliers, string? AccountsType, string Note);

// ── Território → candidaturas ───────────────────────────────────────────────

public record TerritoryCandidateDto(
    Guid CandidacyId, Guid? PoliticianId, ContestRefDto Contest, int Number, string BallotName, PartyDto? Party,
    string? FederationAcronym, string? CandidacyStatus, string? RoundOutcome, bool? Elected,
    long? Votes, double? Share, int? Rank, string State);

public record FacetDto(string Value, string Label, int Count);

public record TerritoryCandidatesResponse(
    int Year, int Round, string Uf, string? MunicipalityTseCode, string? MunicipalityName, int? Zone,
    IReadOnlyList<TerritoryCandidateDto> Items, int Total, int Page, int PageSize,
    IReadOnlyList<FacetDto> Offices, IReadOnlyList<FacetDto> Parties, IReadOnlyList<FacetDto> Statuses,
    DerivedFreshnessDto Freshness);

// ── Camadas do mapa ─────────────────────────────────────────────────────────

public record MapFeatureDto(
    string Key, string? MunicipalityTseCode, int? IbgeCode, string Name, int? Zone, string? PlaceCode,
    double? Latitude, double? Longitude, double? Value, string? Category, string? CategoryLabel, string State,
    IReadOnlyDictionary<string, object?> Details);

public record MapLegendItemDto(string Category, string Label, int Rank);

public record MapLayerResponse(
    int Year, int Round, string Uf, string? MunicipalityTseCode, string Layer, string Level, int? OfficeCode,
    IReadOnlyList<MapFeatureDto> Features, IReadOnlyList<MapLegendItemDto> Legend, double? Min, double? Max,
    string? Comparability, string Note, DerivedFreshnessDto Freshness);

// ── Comparação (até 5 candidaturas) ─────────────────────────────────────────

public record CompareSubjectDto(int Index, Guid? PoliticianId, Guid? PersonId, string Name, IReadOnlyList<Guid> CandidacyIds);

public record CompareElectionDto(int Index, int Year, int Round);

public record CompareCandidacyDto(
    Guid CandidacyId, int Subject, int Election, ContestRefDto Contest, int Number, string BallotName, PartyDto? Party,
    string? CandidacyStatus, string? RoundOutcome, bool? Elected, long? Votes, double? Share, string State);

public record ComparePairDto(Guid First, Guid Second, string Comparability);

public record CompareCellDto(Guid CandidacyId, long? Votes, long? ValidVotes, double? Share, string State);

public record CompareEvolutionDto(
    int Subject, Guid FromCandidacyId, Guid ToCandidacyId, string Comparability,
    long? DeltaVotes, double? DeltaPercent, double? DeltaSharePoints);

public record CompareLeaderDto(int Election, Guid? CandidacyId, bool Tie);

public record CompareTerritoryDto(
    string Key, string Uf, string? MunicipalityTseCode, string? MunicipalityName, int? Zone, int? Section,
    string? PlaceCode, string? PlaceName, string Comparability, IReadOnlyDictionary<int, IReadOnlyList<int>>? MembersByElection,
    IReadOnlyList<CompareCellDto> Cells, IReadOnlyList<CompareEvolutionDto> Evolution, IReadOnlyList<CompareLeaderDto> Leaders);

public record OvertakeDto(int Subject, int OvertakenSubject, int FromElection, int ToElection, int Territories, IReadOnlyList<string> Keys);

public record ExtremeDto(int Subject, Guid FromCandidacyId, Guid ToCandidacyId, string Kind, string Key, string Label, long DeltaVotes, double? DeltaPercent);

public record ElectoralComparisonResponse(
    string Level, string Uf, string? MunicipalityTseCode, int? Zone,
    IReadOnlyList<CompareSubjectDto> Subjects, IReadOnlyList<CompareElectionDto> Elections,
    IReadOnlyList<CompareCandidacyDto> Candidacies, IReadOnlyList<ComparePairDto> Pairs,
    IReadOnlyList<CompareTerritoryDto> Territories, IReadOnlyList<OvertakeDto> Overtakes,
    IReadOnlyList<ExtremeDto> Extremes, IReadOnlyList<InsightDto> Insights,
    DerivedFreshnessDto Freshness, IReadOnlyDictionary<string, string> Definitions);
