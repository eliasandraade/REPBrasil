namespace RepBrasil.Domain.Entities;

public class Contract : AuditableEntity
{
    public Guid CompanyId { get; set; }
    public string ContractNumber { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public DateTime SignedAt { get; set; }
    public string? PublicBody { get; set; }
}
