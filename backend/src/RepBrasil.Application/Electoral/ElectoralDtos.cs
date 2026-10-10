namespace RepBrasil.Application.Electoral;

// Contratos públicos da inteligência eleitoral (JSON camelCase, como o restante da API).
// Três camadas de disponibilidade, nunca confundidas: território conhecido,
// cadastro eleitoral importado e resultados importados.

public record ElectionRefDto(int Year, int Round, DateOnly ElectionDate, string? Description);

public record ElectionDto(
    int Year, int Round, DateOnly ElectionDate, string? Description,
    bool CadasterAvailable, bool ResultsAvailable, bool Default);

public record ElectionsResponse(IReadOnlyList<ElectionDto> Elections);

public record StateDto(
    string Uf, string Slug, string Name, int? IbgeCode, bool TerritoryKnown, int Municipalities,
    bool CadasterAvailable, int CadasterMunicipalities, bool ResultsAvailable, int ResultsMunicipalities);

public record StatesResponse(ElectionRefDto Election, IReadOnlyList<StateDto> States);

public record MunicipalityDto(
    string TseCode, int? IbgeCode, string Name, string Slug, string Uf, bool TerritoryKnown,
    bool CadasterAvailable, bool ResultsAvailable, int Zones);

public record MunicipalitiesResponse(
    ElectionRefDto Election, StateDto State, string Status, IReadOnlyList<MunicipalityDto> Municipalities);

/// <summary>Aptos por cargo federal/estadual. null = não informado pela fonte (nunca 0 presumido).</summary>
public record EligibleDto(int? Federal, int? State);

public record ZoneDto(
    int Number, int Sections, int PrincipalSections, int AggregatedSections, int PollingPlaces,
    int PollingPlacesWithCoordinates, EligibleDto Eligible, bool ResultsAvailable);

public record MunicipalitySummaryDto(
    int Zones, int Sections, int PrincipalSections, int AggregatedSections, int PollingPlaces,
    int PollingPlacesWithCoordinates, EligibleDto Eligible);

public record CadasterProvenanceDto(
    string Source, string Dataset, string? ResourceId, string ResourceName, string Url, string SourceFileSha256,
    string? Checksum, string? CsvName, string? CsvSha256, string? SourceGeneratedAt, DateTime ImportedAt,
    Guid ImportBatchId);

public record MunicipalityDetailResponse(
    ElectionRefDto Election, StateDto State, MunicipalityDto Municipality, string Status,
    IReadOnlyList<ZoneDto> Zones, MunicipalitySummaryDto? Summary, CadasterProvenanceDto? Provenance);

public record CoordinatesDto(double Latitude, double Longitude, string? Source);

public record SectionDto(
    int Number, int PrincipalNumber, bool IsAggregated, string PlaceCode, IReadOnlyList<int> AggregatedSections,
    EligibleDto? Eligible);

public record PlaceDto(
    string Code, string Name, string? Address, string? Neighborhood, string? PostalCode, string? PlaceType,
    CoordinatesDto? Coordinates, IReadOnlyList<SectionDto> Sections);

public record ZoneDetailResponse(
    ElectionRefDto Election, StateDto State, MunicipalityDto Municipality, string Status, ZoneDto? Zone,
    IReadOnlyList<PlaceDto> Places, CadasterProvenanceDto? Provenance);

// ── Resultado por seção ──────────────────────────────────────────────────────

public record TerritoryRefDto(string Uf, MunicipalityRefDto Municipality, int Zone);

public record MunicipalityRefDto(string TseCode, int? IbgeCode, string Name, string Slug);

public record OfficeDto(int Code, string? Name, int ElectionCode);

public record SelectedOfficeDto(int Code, string? Name, int ElectionCode, string? ElectionDescription);

/// <summary>
/// Métricas da urna × cargo. Estruturais vêm da urna (null = não informado). Branco/nulo/válidos
/// ausentes só viram 0 quando a contabilidade da urna fecha (soma dos votos = comparecimento).
/// </summary>
public record MetricsDto(int? Eligible, int? Turnout, int? Abstentions, int? Valid, int? Blank, int? Null);

public record PercentageBasisDto(string Denominator, string Definition, IReadOnlyList<string> AppliesTo);

public record VoteTypeSourceDto(int Code, string Description);

public record VotableDto(int Number, string? Name);

/// <summary>Partido como publicado. Number null = NR_PARTIDO não publicado (nunca 0).</summary>
public record PartyDto(int? Number, string? Acronym, string? Name);

/// <summary>Candidatura oficial vinculada ao votável. Ausente ⇒ voto continua correto, só sem perfil.</summary>
public record CandidacyLinkDto(Guid CandidacyId, long TseCandidateId, Guid? PersonId, Guid? PoliticianId);

public record VoteItemDto(
    string VoteType, VoteTypeSourceDto VoteTypeSource, VotableDto Votable, PartyDto? Party, int Votes,
    double? Percentage, CandidacyLinkDto? Candidacy, bool ProfileAvailable);

public record CandidateFilterDto(int Number, string? Name, string? Party);

public record FederationAvailabilityDto(bool Available, string Reason);

public record AvailableFiltersDto(
    IReadOnlyList<CandidateFilterDto> Candidates, IReadOnlyList<PartyDto> Parties, IReadOnlyList<string> VoteTypes,
    FederationAvailabilityDto Federation);

public record ResultFiltersDto(int? Office, int? Candidate, int? Party, string? VoteType);

public record FiltersDto(ResultFiltersDto Applied, AvailableFiltersDto Available);

public record UrnDto(int? Number, string? Type, DateTime? EmittedAt, DateTime? ReceivedAt, int? PollingPlaceCode);

public record OfficialChecksumDto(string Algorithm, bool Verified);

public record ValidationDto(string Reconciliation, string Ea20);

public record ResultProvenanceDto(
    string Source, string Dataset, string? ResourceId, string ResourceName, string Url, string SourceFileSha256,
    string CsvSha256, OfficialChecksumDto OfficialChecksum, string? SourceGeneratedAt, DateTime ImportedAt,
    Guid ImportBatchId, ValidationDto Validation, IReadOnlyList<System.Text.Json.JsonElement> Warnings);

public record SectionResultsResponse(
    ElectionRefDto Election,
    TerritoryRefDto Territory,
    int RequestedSection,
    string Status,
    int? PrincipalSection = null,
    bool? Aggregated = null,
    IReadOnlyList<int>? AggregatedSections = null,
    IReadOnlyList<OfficeDto>? AvailableOffices = null,
    SelectedOfficeDto? SelectedOffice = null,
    MetricsDto? Metrics = null,
    PercentageBasisDto? PercentageBasis = null,
    IReadOnlyList<VoteItemDto>? Votes = null,
    FiltersDto? Filters = null,
    UrnDto? Urn = null,
    ResultProvenanceDto? Provenance = null);

// ── Candidaturas e desempenho ───────────────────────────────────────────────

public record ContestDto(
    int Year, int Round, int TseElectionCode, string? TseElectionDescription, int OfficeCode, string OfficeName,
    string Scope, string ElectoralUnit);

public record CandidacySourceDto(string Source, string Url, string ZipSha256, string Member, long Line);

/// <summary>Cobertura dos votos por seção importados para a disputa (só UFs com BU carregado).</summary>
public record CoverageDto(bool Complete, IReadOnlyList<CoverageUfDto> Ufs, string Note);

/// <summary>
/// Cobertura de uma UF medida por escopo município × zona do cadastro. Completa ⇔ todos os escopos
/// esperados têm resultado. Municípios completos = todas as suas zonas importadas.
/// </summary>
public record CoverageUfDto(
    string Uf, bool Complete, int ZonesWithResults, int ZonesExpected, int MunicipalitiesComplete,
    int MunicipalitiesWithAnyResult, int MunicipalitiesExpected);

/// <summary>
/// Votos (FATO, soma dos BUs vigentes) e participação nos válidos do cargo no mesmo município
/// (MÉTRICA DERIVADA). Dados eleitorais são descritivos: não entram no Score.
/// </summary>
public record TerritoryPerformanceDto(
    string Uf, string MunicipalityTseCode, string? MunicipalityName, string? MunicipalitySlug, long Votes,
    long? ValidVotes, double? ShareOfValidVotes, int Urns);

public record CandidacyPerformanceDto(
    long Votes, CoverageDto Coverage, IReadOnlyList<TerritoryPerformanceDto> Municipalities, int MunicipalitiesWithVotes,
    IReadOnlyDictionary<string, string> Definitions);

public record CandidacyDto(
    Guid Id, long TseCandidateId, ContestDto Contest, int CandidateNumber, string BallotName, PartyDto? Party,
    string? FederationAcronym, string? CoalitionName, string? CandidacyStatus, string? RoundOutcome, bool? Elected,
    string IdentityStatus, Guid? PersonId, Guid? PoliticianId, bool ProfileAvailable, CandidacySourceDto Source,
    CandidacyPerformanceDto? Performance);

public record PoliticianCandidaciesResponse(Guid PoliticianId, IReadOnlyList<CandidacyDto> Candidacies);
