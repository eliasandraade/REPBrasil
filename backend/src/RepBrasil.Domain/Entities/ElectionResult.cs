namespace RepBrasil.Domain.Entities;

public class ElectionResult : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public Guid ElectionId { get; set; }
    public Guid PartyId { get; set; }
    public long TotalVotes { get; set; }
    public bool Elected { get; set; }
}
