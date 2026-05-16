namespace RepBrasil.Domain.Entities;

public class AssetItem : AuditableEntity
{
    public Guid DeclarationId { get; set; }
    public int Order { get; set; }
    public string? TypeCode { get; set; }
    public string? TypeDescription { get; set; }
    public string? Description { get; set; }
    public decimal Value { get; set; }
    public AssetDeclaration Declaration { get; set; } = null!;
}
