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
    DateTime? SourceUpdatedAt
)
{
    public static PoliticianDetailDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId, p.CamaraId, p.SenateId,
            p.State, p.PartyAcronym, p.PartyName, p.Office, p.CandidacyStatus,
            p.CreatedAt, p.SourceUpdatedAt);
}
