using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Politicians.DTOs;

public record PoliticianSummaryDto(
    Guid Id,
    string Name,
    string BallotName,
    string? TseId
)
{
    public static PoliticianSummaryDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId);
}
