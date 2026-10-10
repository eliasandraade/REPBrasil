namespace RepBrasil.Application.Electoral;

/// <summary>Cargo de uma eleição (chave dos agregados por zona).</summary>
public readonly record struct ElectionOffice(int Year, int Round, int OfficeCode);

/// <summary>Candidatura com a disputa, a unidade eleitoral e os sinais de presença no BU.</summary>
public sealed class XrayCandidacyRow
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
    public string? IdentityMethod { get; init; }
    public Guid? PersonId { get; init; }
    public Guid? PoliticianId { get; init; }
    public string? PoliticianName { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
    public int TseElectionCode { get; init; }
    public int OfficeCode { get; init; }
    public string OfficeName { get; init; } = string.Empty;
    public string Scope { get; init; } = string.Empty;
    public string ElectoralUnit { get; init; } = string.Empty;
    public string? ContestUf { get; init; }
    public string? UnitName { get; init; }
    public string SourceUrl { get; init; } = string.Empty;
    public string SourceZipSha256 { get; init; } = string.Empty;
    public string SourceMember { get; init; } = string.Empty;
    public long SourceLine { get; init; }
    /// <summary>Existe vínculo auditado votável do BU → candidatura.</summary>
    public bool HasLink { get; init; }
    /// <summary>ST_CANDIDATO_INSERIDO_URNA das informações complementares ("SIM"/"NÃO"), quando importadas.</summary>
    public string? InsertedInUrn { get; init; }
}

/// <summary>Votos de uma candidatura numa zona (agregado derivado do BU vigente).</summary>
public sealed class CandidacyZoneVotesRow
{
    public Guid CandidacyId { get; init; }
    public string Uf { get; init; } = string.Empty;
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public int Zone { get; init; }
    public long Votes { get; init; }
    public int UrnsWithVotes { get; init; }
}

/// <summary>Totais de um cargo numa zona (agregado derivado do BU vigente).</summary>
public sealed class ZoneTotalsRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public int OfficeCode { get; init; }
    public string Uf { get; init; } = string.Empty;
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public string? MunicipalityName { get; init; }
    public int Zone { get; init; }
    public int Urns { get; init; }
    public long? Eligible { get; init; }
    public long? Turnout { get; init; }
    public long ValidVotes { get; init; }
    public long VotesTotal { get; init; }
}

/// <summary>Zona esperada pelo cadastro oficial da eleição (base da cobertura).</summary>
public sealed class ExpectedZoneRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public string Uf { get; init; } = string.Empty;
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public string MunicipalityName { get; init; } = string.Empty;
    public int? IbgeCode { get; init; }
    public int Zone { get; init; }
}

public sealed class ContestRankRow
{
    public Guid CandidacyId { get; init; }
    public long? Votes { get; init; }
    public int? Rank { get; init; }
    public int CandidatesWithVotes { get; init; }
}

public sealed class TicketRow
{
    public Guid CandidacyId { get; init; }
    public Guid HeadCandidacyId { get; init; }
    public string HeadBallotName { get; init; } = string.Empty;
    public int HeadOfficeCode { get; init; }
}

public sealed class AssetRow
{
    public Guid CandidacyId { get; init; }
    public int? TypeCode { get; init; }
    public string? Type { get; init; }
    public string? Description { get; init; }
    public decimal Value { get; init; }
}

public sealed class SourceRecordRow
{
    public Guid CandidacyId { get; init; }
    public string Kind { get; init; } = string.Empty;
    public string PayloadJson { get; init; } = "{}";
}

public sealed class FinanceTotalsRow
{
    public Guid CandidacyId { get; init; }
    public string RecordKind { get; init; } = string.Empty;
    public decimal Amount { get; init; }
    public int Records { get; init; }
    public string? AccountsType { get; init; }
}

public sealed class FinanceCategoryRow
{
    public string RecordKind { get; init; } = string.Empty;
    public string Category { get; init; } = string.Empty;
    public decimal Amount { get; init; }
    public int Records { get; init; }
}

public sealed class FinanceCounterpartyRow
{
    public string RecordKind { get; init; } = string.Empty;
    public string? Name { get; init; }
    public string CounterpartyKind { get; init; } = "unidentified";
    public string? Cnpj { get; init; }
    public decimal Amount { get; init; }
    public int Records { get; init; }
}

public sealed class PriorRow
{
    public Guid CandidacyId { get; init; }
    public short PriorYear { get; init; }
    public short PriorTurn { get; init; }
    public long PriorTseCandidateId { get; init; }
    public int? PriorOfficeCode { get; init; }
    public string? PriorOfficeName { get; init; }
    public string? PriorElectoralUnit { get; init; }
    public string? PriorUnitName { get; init; }
    public int? PriorCandidateNumber { get; init; }
    public string? PriorBallotName { get; init; }
    public string? PriorPartyAcronym { get; init; }
    public string? PriorRoundOutcome { get; init; }
    /// <summary>Candidatura importada com o mesmo SQ_CANDIDATO e ano (quando existe no banco).</summary>
    public Guid? ImportedCandidacyId { get; init; }
}

/// <summary>Resultado de uma urna (seção principal) do BU vigente, com os votos válidos do cargo.</summary>
public sealed class SectionResultRow
{
    public long ResultId { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
    public int OfficeCode { get; init; }
    public string Uf { get; init; } = string.Empty;
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public string? MunicipalityName { get; init; }
    public int Zone { get; init; }
    public int Section { get; init; }
    public int[] SectionMembers { get; init; } = [];
    public string? PollingPlaceCode { get; init; }
    public int? Eligible { get; init; }
    public int? Turnout { get; init; }
    public long ValidVotes { get; init; }
}

public sealed class SectionCandidacyVotesRow
{
    public long ResultId { get; init; }
    public Guid CandidacyId { get; init; }
    public long Votes { get; init; }
}

public sealed class PlaceNameRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public int Zone { get; init; }
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
}

public sealed class MunicipalityRefRow
{
    public string Uf { get; init; } = string.Empty;
    public string TseCode { get; init; } = string.Empty;
    public int? IbgeCode { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Slug { get; init; } = string.Empty;
}

public sealed class PoliticianRefRow
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public Guid? PersonId { get; init; }
}

public sealed class FreshnessRow
{
    public DateTime? RefreshedAt { get; init; }
    public int StoredRuns { get; init; }
    public DateTime? StoredLastFinishedAt { get; init; }
    public int CurrentRuns { get; init; }
    public DateTime? CurrentLastFinishedAt { get; init; }
}
