namespace RepBrasil.Domain.Entities;

public class ScoreSnapshot : AuditableEntity
{
    public Guid PoliticianId { get; init; }
    // Valor reservado para cálculo futuro. Não expor como nota ativa enquanto status = em_desenvolvimento.
    public decimal Score { get; init; }
    public string MethodologyVersion { get; init; } = string.Empty;
    public DateTime CalculatedAt { get; init; } = DateTime.UtcNow;
    public string? Notes { get; init; }

    // Navigation property — FK is on ScoreFactor.ScoreSnapshotId
    public List<ScoreFactor> Factors { get; init; } = new List<ScoreFactor>();
}
