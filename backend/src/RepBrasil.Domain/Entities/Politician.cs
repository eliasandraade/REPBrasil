namespace RepBrasil.Domain.Entities;

public class Politician : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string BallotName { get; set; } = string.Empty;
    public string? TseId { get; set; }
    public string? CamaraId { get; set; }
    public string? SenateId { get; set; }
    public string? State { get; set; }
    public string? PartyAcronym { get; set; }
    public string? PartyName { get; set; }
    public string? Office { get; set; }
    public string? CandidacyStatus { get; set; }

    /// <summary>Endereço público permanente (/politicos/&lt;slug&gt;). Escolhido pelo banco no INSERT; nunca muda.</summary>
    public string? Slug { get; set; }

    /// <summary>Vínculo opcional com a entidade Person. Nullable — não afeta registros existentes.</summary>
    public Guid? PersonId { get; set; }
    public Person? Person { get; set; }
}
