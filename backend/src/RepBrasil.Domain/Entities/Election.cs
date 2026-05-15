namespace RepBrasil.Domain.Entities;

public class Election : AuditableEntity
{
    public int Year { get; set; }
    public string Office { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? City { get; set; }
}
