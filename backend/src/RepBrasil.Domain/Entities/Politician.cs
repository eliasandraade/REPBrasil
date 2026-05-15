namespace RepBrasil.Domain.Entities;

public class Politician : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string BallotName { get; set; } = string.Empty;
    public string? TseId { get; set; }
    public string? CamaraId { get; set; }
    public string? SenateId { get; set; }
}
