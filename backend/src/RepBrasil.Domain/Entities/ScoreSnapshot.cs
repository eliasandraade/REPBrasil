namespace RepBrasil.Domain.Entities;

public class ScoreSnapshot : AuditableEntity
{
    public Guid PoliticianId { get; init; }
    public decimal Score { get; init; }
    public string MethodologyVersion { get; init; } = string.Empty;
    public DateTime CalculatedAt { get; init; } = DateTime.UtcNow;
    public string? Notes { get; init; }
}
