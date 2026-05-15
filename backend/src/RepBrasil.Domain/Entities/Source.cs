namespace RepBrasil.Domain.Entities;

public class Source : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string OriginalUrl { get; set; } = string.Empty;
    public DateTime CollectedAt { get; set; }
    public string? Hash { get; set; }
    public string? License { get; set; }
}
