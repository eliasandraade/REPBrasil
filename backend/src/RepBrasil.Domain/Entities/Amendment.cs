namespace RepBrasil.Domain.Entities;

public class Amendment : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public decimal Value { get; set; }
    public string? Destination { get; set; }
    public int Year { get; set; }
    public string? SiopCode { get; set; }
}
