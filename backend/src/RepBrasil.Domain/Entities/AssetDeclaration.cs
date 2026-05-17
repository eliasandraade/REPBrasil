namespace RepBrasil.Domain.Entities;

public class AssetDeclaration : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public int ElectionYear { get; set; }
    public string? SourceElectionYear { get; set; }
    public decimal TotalValue { get; set; }
    public string? TseSequential { get; set; }
    public ICollection<AssetItem> Items { get; set; } = new List<AssetItem>();
}
