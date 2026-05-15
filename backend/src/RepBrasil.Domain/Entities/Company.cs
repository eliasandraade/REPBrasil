namespace RepBrasil.Domain.Entities;

public class Company : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Cnpj { get; set; } = string.Empty;
    public string? LegalNature { get; set; }
    public string? Status { get; set; }
    public DateTime? OpenedAt { get; set; }
}
