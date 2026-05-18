namespace RepBrasil.Domain.Entities;

public class Mandate : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public Politician Politician { get; set; } = null!;

    /// <summary>Valores: "CAMARA" | "SENADO" | "ASSEMBLEIA_ESTADUAL"</summary>
    public string House { get; set; } = string.Empty;

    public int Legislature { get; set; }

    public string? Title { get; set; }
    public string? State { get; set; }
    public string? PartyAcronym { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }

    /// <summary>ID externo: CamaraId ou SenateId. Mesmo valor de Politician.CamaraId para deputados.</summary>
    public string? ExternalId { get; set; }
    public string? ExternalUrl { get; set; }

    public Guid? SourceId { get; set; }
    public Source? Source { get; set; }
}
