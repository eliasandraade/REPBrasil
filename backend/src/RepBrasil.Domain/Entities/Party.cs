namespace RepBrasil.Domain.Entities;

public class Party : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Acronym { get; set; } = string.Empty;
    public string? TseNumber { get; set; }
}
