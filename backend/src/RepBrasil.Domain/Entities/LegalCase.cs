namespace RepBrasil.Domain.Entities;

public class LegalCase : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public string CaseNumber { get; set; } = string.Empty;
    public string Court { get; set; } = string.Empty;
    public string? Subject { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool HasFinalConviction { get; set; }
}
