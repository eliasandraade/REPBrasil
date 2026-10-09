namespace RepBrasil.Domain.Entities.Electoral;

/// <summary>
/// Pleito oficial do TSE num turno (ex.: Eleições Gerais 2026, 1º turno).
/// Tabela <c>electoral.election</c>. Não confundir com o legado <see cref="Election"/>,
/// que agrega ano + cargo + UF + município para o resumo por político.
/// </summary>
public class ElectionEvent
{
    public Guid Id { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
    public DateOnly ElectionDate { get; init; }

    /// <summary>Código do pleito (CD_PLEITO). Nulo até o BU ser importado.</summary>
    public int? PleitoCode { get; init; }

    public int? FederalElectionCode { get; init; }
    public int? StateElectionCode { get; init; }
    public string TseCycle { get; init; } = string.Empty;
    public string Environment { get; init; } = string.Empty;
    public string? Description { get; init; }
    public DateTime CreatedAt { get; init; }

    public ICollection<Contest> Contests { get; init; } = [];
}
