namespace RepBrasil.Domain.Entities;

public abstract class AuditableEntity
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
    public DateTime? SourceUpdatedAt { get; set; }
}
