namespace RepBrasil.Domain.Entities;

public class Municipality : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? IbgeCode { get; set; }
}
