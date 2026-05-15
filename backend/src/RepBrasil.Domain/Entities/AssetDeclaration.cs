namespace RepBrasil.Domain.Entities;

public class AssetDeclaration : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public int ElectionYear { get; set; }
    public decimal TotalValue { get; set; }
    public string? TseSequential { get; set; }
}
