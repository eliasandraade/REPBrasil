using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Politicians.DTOs;

public record PoliticianDetailDto(
    Guid Id,
    string Name,
    string BallotName,
    string? TseId,
    string? CamaraId,
    string? SenateId,
    string? State,
    string? PartyAcronym,
    string? PartyName,
    string? Office,
    string? CandidacyStatus,
    DateTime CreatedAt,
    DateTime? SourceUpdatedAt,
    string? Slug,
    LatestCandidacyDto? LatestCandidacy = null
)
{
    public static PoliticianDetailDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId, p.CamaraId, p.SenateId,
            p.State, p.PartyAcronym, p.PartyName, p.Office, p.CandidacyStatus,
            p.CreatedAt, p.SourceUpdatedAt, p.Slug);
}

/// <summary>Candidatura oficial mais recente (camada eleitoral): quem a pessoa é nas urnas hoje.</summary>
public record LatestCandidacyDto(int Year, int Round, int OfficeCode, string OfficeName, string? UnitName, string? Uf,
    string? Party, string? Outcome, bool? Elected);

/// <summary>Linha lida do banco para <see cref="LatestCandidacyDto"/>.</summary>
public sealed class LatestCandidacyRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public int OfficeCode { get; init; }
    public string OfficeName { get; init; } = string.Empty;
    public string? UnitName { get; init; }
    public string? Uf { get; init; }
    public string? Party { get; init; }
    public string? Outcome { get; init; }
    public bool? Elected { get; init; }
}
