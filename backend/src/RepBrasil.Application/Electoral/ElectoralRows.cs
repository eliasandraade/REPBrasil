namespace RepBrasil.Application.Electoral;

// Linhas lidas do schema electoral (SQL explícito em ElectoralReadRepository).
// Nulos são preservados: NULL na fonte nunca vira 0.

public sealed class ElectionRow
{
    public Guid Id { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
    public DateOnly ElectionDate { get; init; }
    public string? Description { get; init; }
    public int CadasterMunicipalities { get; init; }
    public int ResultsMunicipalities { get; init; }
}

public sealed class StateRow
{
    public string Uf { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public int? IbgeCode { get; init; }
    public int Municipalities { get; init; }
    public int CadasterMunicipalities { get; init; }
    public int ResultsMunicipalities { get; init; }
}

public sealed class MunicipalityRow
{
    public Guid Id { get; init; }
    public string Uf { get; init; } = string.Empty;
    public string TseCode { get; init; } = string.Empty;
    public int? IbgeCode { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Slug { get; init; } = string.Empty;
    public int Zones { get; init; }
    public int Sections { get; init; }
    public int ResultsZones { get; init; }
}

public sealed class ZoneRow
{
    public int Number { get; init; }
    public int Sections { get; init; }
    public int PrincipalSections { get; init; }
    public int AggregatedSections { get; init; }
    public int PollingPlaces { get; init; }
    public int PollingPlacesWithCoordinates { get; init; }

    /// <summary>Soma dos aptos das urnas; null se alguma urna não informa.</summary>
    public int? EligibleFederal { get; init; }

    public int? EligibleState { get; init; }
    public bool ResultsAvailable { get; init; }
}

public sealed class PlaceRow
{
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Address { get; init; }
    public string? Neighborhood { get; init; }
    public string? PostalCode { get; init; }
    public string? PlaceType { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public string? CoordinatesSource { get; init; }
}

public sealed class SectionRow
{
    public int Number { get; init; }
    public bool IsAggregated { get; init; }
    public int PrincipalNumber { get; init; }
    public string PlaceCode { get; init; } = string.Empty;
    public int? EligibleFederal { get; init; }
    public int? EligibleState { get; init; }
}

public sealed class CadasterProvenanceRow
{
    public string Dataset { get; init; } = string.Empty;
    public string? ResourceId { get; init; }
    public string ResourceName { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public string ZipSha256 { get; init; } = string.Empty;
    public string? ChecksumStatus { get; init; }
    public string? CsvName { get; init; }
    public string? CsvSha256 { get; init; }
    public string? SourceGeneratedAt { get; init; }
    public DateTime ImportedAt { get; init; }
    public Guid ImportBatchId { get; init; }
}

public sealed class BatchRow
{
    public Guid BatchId { get; init; }
    public DateTime FinishedAt { get; init; }
    public string? Ea20Validation { get; init; }

    /// <summary>JSON (array) dos avisos do lote, como gravado pelo ETL.</summary>
    public string WarningsJson { get; init; } = "[]";

    public string Dataset { get; init; } = string.Empty;
    public string? ResourceId { get; init; }
    public string ResourceName { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public string ZipSha256 { get; init; } = string.Empty;
    public string CsvSha256 { get; init; } = string.Empty;
    public string? SourceGeneratedAt { get; init; }
    public string OfficialChecksumAlgorithm { get; init; } = string.Empty;
}

public sealed class UrnOfficeRow
{
    public long ResultId { get; init; }
    public int ElectionCode { get; init; }
    public string? ElectionDescription { get; init; }
    public int OfficeCode { get; init; }
    public string? OfficeName { get; init; }
    public int OfficeSort { get; init; }
    public int Section { get; init; }
    public int[] AggregatedSections { get; init; } = [];
    public int? PollingPlaceCode { get; init; }
    public int? Eligible { get; init; }
    public int? Turnout { get; init; }
    public int? Abstentions { get; init; }
    public int? UrnNumber { get; init; }
    public string? UrnTypeDescription { get; init; }
    public DateTime? BuEmittedAt { get; init; }
    public DateTime? BuReceivedAt { get; init; }
    public int VotesTotal { get; init; }
}

public sealed class VoteRow
{
    /// <summary>candidate | party_legend | blank | null | technical_null | other.</summary>
    public string VoteKind { get; init; } = string.Empty;

    public short TypeCode { get; init; }
    public string TypeDescription { get; init; } = string.Empty;
    public int Number { get; init; }
    public string? Name { get; init; }
    public int? PartyNumber { get; init; }
    public string? PartyAcronym { get; init; }
    public string? PartyName { get; init; }
    public int Votes { get; init; }

    // Enriquecimento de identidade (votable_candidacy). Ausente ⇒ o resultado continua válido.
    public Guid? CandidacyId { get; init; }
    public long? TseCandidateId { get; init; }
    public Guid? PersonId { get; init; }
    public Guid? PoliticianId { get; init; }
}

public sealed class CandidacyRow
{
    public Guid Id { get; init; }
    public long TseCandidateId { get; init; }
    public int CandidateNumber { get; init; }
    public string BallotName { get; init; } = string.Empty;
    public int? PartyNumber { get; init; }
    public string? PartyAcronym { get; init; }
    public string? PartyName { get; init; }
    public string? FederationAcronym { get; init; }
    public string? CoalitionName { get; init; }
    public string? CandidacyStatus { get; init; }
    public string? RoundOutcome { get; init; }
    public bool? Elected { get; init; }
    public string IdentityStatus { get; init; } = string.Empty;
    public Guid? PersonId { get; init; }
    public Guid? PoliticianId { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
    public int TseElectionCode { get; init; }
    public string? TseElectionDescription { get; init; }
    public int OfficeCode { get; init; }
    public string OfficeName { get; init; } = string.Empty;
    public string Scope { get; init; } = string.Empty;
    public string ElectoralUnit { get; init; } = string.Empty;
    public string SourceUrl { get; init; } = string.Empty;
    public string SourceZipSha256 { get; init; } = string.Empty;
    public string SourceMember { get; init; } = string.Empty;
    public long SourceLine { get; init; }
    public bool HasVotes { get; init; }
}

public sealed class TerritoryVotesRow
{
    public string Uf { get; init; } = string.Empty;
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public string? MunicipalityName { get; init; }
    public string? MunicipalitySlug { get; init; }
    public long Votes { get; init; }

    /// <summary>Votos válidos (nominais + legenda) do cargo no mesmo recorte.</summary>
    public long ValidVotes { get; init; }

    public int Urns { get; init; }
}

public sealed class CoverageRow
{
    public string Uf { get; init; } = string.Empty;
    public int MunicipalitiesWithResults { get; init; }
    public int MunicipalitiesInCadaster { get; init; }
}
