namespace RepBrasil.Domain.Entities;

public class ScoreFactor : AuditableEntity
{
    public Guid ScoreSnapshotId { get; init; }
    public string FactorKey { get; init; } = string.Empty;
    public string FactorCategory { get; init; } = string.Empty;
    public string FactorLabel { get; init; } = string.Empty;
    public decimal? FactorValue { get; init; }
    public decimal? FactorWeight { get; init; }
    // Prepared for future FK without losing free-text flexibility now
    public Guid? EvidenceId { get; init; }
    public Guid? SourceId { get; init; }
    public string? EvidenceReference { get; init; }
    public string? SourceReference { get; init; }
    public string? Explanation { get; init; }
}
