namespace RepBrasil.Domain.Entities;

public class Contestation : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public string DataField { get; set; } = string.Empty;
    public string CurrentValue { get; set; } = string.Empty;
    public string ClaimedValue { get; set; } = string.Empty;
    public string Status { get; set; } = "Recebida";
    public string? SupportingDocumentUrl { get; set; }
    public string? Resolution { get; set; }
}
