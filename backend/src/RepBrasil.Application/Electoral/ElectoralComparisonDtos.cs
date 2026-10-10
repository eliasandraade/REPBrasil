namespace RepBrasil.Application.Electoral;

/// <summary>
/// Nível territorial da comparação. Município pode cobrir uma UF inteira; zona exige município;
/// seção exige município + zona para evitar respostas gigantes e preservar o contexto eleitoral.
/// </summary>
public enum ComparisonLevel
{
    Municipality,
    Zone,
    Section,
}

public record ComparisonCandidateDto(
    Guid CandidacyId,
    Guid? PersonId,
    Guid? PoliticianId,
    int Year,
    int Round,
    int OfficeCode,
    string OfficeName,
    int Number,
    string BallotName,
    PartyDto? Party);

public record ComparisonValueDto(
    Guid CandidacyId,
    long Votes,
    long? ValidVotes,
    double? ShareOfValidVotes);

/// <summary>
/// Comparabilidade é factual, não avaliativa. Em nível de seção, duas eleições só são
/// diretamente comparáveis quando a composição principal+agregadas coincide.
/// </summary>
public record ComparisonTerritoryDto(
    string Uf,
    string MunicipalityTseCode,
    string? MunicipalityName,
    int? Zone,
    int? Section,
    IReadOnlyList<int>? SectionMembers,
    string Comparability,
    IReadOnlyList<ComparisonValueDto> Values);

public record PairwiseComparisonDto(
    Guid FirstCandidacyId,
    Guid SecondCandidacyId,
    int ComparableTerritories,
    int FirstHigher,
    int SecondHigher,
    int Ties,
    int NotComparable);

public record ElectoralComparisonResponse(
    ComparisonLevel Level,
    string Uf,
    string? MunicipalityTseCode,
    int? Zone,
    IReadOnlyList<ComparisonCandidateDto> Candidates,
    IReadOnlyList<ComparisonTerritoryDto> Territories,
    IReadOnlyList<PairwiseComparisonDto> Pairwise,
    IReadOnlyDictionary<string, string> Definitions);
