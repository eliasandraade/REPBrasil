namespace RepBrasil.Domain.Entities;

public class Flag : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public Guid? EvidenceId { get; set; }
    public bool Resolved { get; set; }
    public DateTime? ResolvedAt { get; set; }
}
