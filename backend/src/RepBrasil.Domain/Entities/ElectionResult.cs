namespace RepBrasil.Domain.Entities;

public class ElectionResult : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public Guid ElectionId { get; set; }
    public Guid? PartyId { get; set; }
    public int Round { get; set; } = 1;
    public long TotalVotes { get; set; }
    public decimal? Percentage { get; set; }
    public string? Situation { get; set; }
    public bool Elected { get; set; }
    public Election Election { get; set; } = null!;
}
