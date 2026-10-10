namespace RepBrasil.Domain.Entities.Electoral;

/// <summary>
/// Disputa dentro de um pleito: CD_ELEICAO + cargo + unidade eleitoral
/// (Presidente/BR, Governador/CE, Deputado Federal/CE…). Tabela <c>electoral.contest</c>.
/// </summary>
public class Contest
{
    public Guid Id { get; init; }
    public Guid ElectionId { get; init; }
    public ElectionEvent Election { get; init; } = null!;

    /// <summary>CD_ELEICAO do TSE (ex.: 6257 federal, 6259 estadual em 2026).</summary>
    public int TseElectionCode { get; init; }

    public string? TseElectionDescription { get; init; }

    /// <summary>CD_CARGO do TSE.</summary>
    public int OfficeCode { get; init; }

    /// <summary>DS_CARGO como publicado pelo TSE.</summary>
    public string OfficeName { get; init; } = string.Empty;

    /// <summary>"federal" | "state" (TP_ABRANGENCIA).</summary>
    public string Scope { get; init; } = string.Empty;

    /// <summary>SG_UE: "BR" para disputas federais ou a sigla da UF.</summary>
    public string ElectoralUnit { get; init; } = string.Empty;

    public DateTime CreatedAt { get; init; }

    public ICollection<Candidacy> Candidacies { get; init; } = [];
}
