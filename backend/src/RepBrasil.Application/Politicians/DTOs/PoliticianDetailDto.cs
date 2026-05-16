using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Politicians.DTOs;

public record PoliticianDetailDto(
    Guid Id,
    string Name,
    string BallotName,
    string? TseId,
    string? CamaraId,
    string? SenateId,
    DateTime CreatedAt,
    DateTime? SourceUpdatedAt
)
{
    public static PoliticianDetailDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId, p.CamaraId, p.SenateId,
            p.CreatedAt, p.SourceUpdatedAt);
}
