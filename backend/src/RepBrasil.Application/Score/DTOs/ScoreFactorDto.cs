using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Score.DTOs;

public record ScoreFactorDto(
    string FactorKey,
    string FactorCategory,
    string FactorLabel,
    decimal? FactorValue,
    decimal? FactorWeight,
    Guid? EvidenceId,
    Guid? SourceId,
    string? EvidenceReference,
    string? SourceReference,
    string? Explanation
)
{
    public static ScoreFactorDto FromEntity(ScoreFactor f) =>
        new(f.FactorKey, f.FactorCategory, f.FactorLabel,
            f.FactorValue, f.FactorWeight,
            f.EvidenceId, f.SourceId,
            f.EvidenceReference, f.SourceReference, f.Explanation);
}
