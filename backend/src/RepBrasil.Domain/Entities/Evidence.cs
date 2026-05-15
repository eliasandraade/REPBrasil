namespace RepBrasil.Domain.Entities;

public class Evidence : AuditableEntity
{
    public Guid SourceId { get; set; }
    public string Description { get; set; } = string.Empty;
    public string? RawValue { get; set; }
    public string? DocumentUrl { get; set; }
}
