namespace RepBrasil.Domain.Entities.Electoral;

/// <summary>
/// Candidatura oficial (SQ_CANDIDATO) de uma pessoa numa disputa. Tabela <c>electoral.candidacy</c>.
/// Partido, número e cargo pertencem à candidatura — não ao estado atual do
/// <see cref="Politician"/>. Uma pessoa pode ter várias candidaturas.
/// </summary>
public class Candidacy
{
    public const string IdentityResolved = "resolved";

    public Guid Id { get; init; }
    public Guid ContestId { get; init; }
    public Contest Contest { get; init; } = null!;

    /// <summary>SQ_CANDIDATO: identificador da candidatura no TSE (não identifica a pessoa entre eleições).</summary>
    public long TseCandidateId { get; init; }

    public int CandidateNumber { get; init; }
    public string BallotName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? SocialName { get; init; }
    public string? AgremiationType { get; init; }
    public int? PartyNumber { get; init; }
    public string? PartyAcronym { get; init; }
    public string? PartyName { get; init; }
    public int? FederationNumber { get; init; }
    public string? FederationAcronym { get; init; }
    public string? FederationName { get; init; }
    public string? CoalitionName { get; init; }
    public int? CandidacyStatusCode { get; init; }
    public string? CandidacyStatus { get; init; }
    public int? RoundOutcomeCode { get; init; }

    /// <summary>DS_SIT_TOT_TURNO como publicado.</summary>
    public string? RoundOutcome { get; init; }

    /// <summary>true = eleito, false = não eleito/suplente, null = indefinido (2º turno ou não publicado).</summary>
    public bool? Elected { get; init; }

    public Guid? PersonId { get; init; }
    public Person? Person { get; init; }
    public Guid? PoliticianId { get; init; }
    public Politician? Politician { get; init; }

    /// <summary>"resolved" | "unresolved_document_unavailable" | "unresolved_document_invalid".</summary>
    public string IdentityStatus { get; init; } = string.Empty;

    public string? IdentityMethod { get; init; }
    public Guid SourceFileId { get; init; }
    public Guid IngestionRunId { get; init; }

    /// <summary>CSV dentro do ZIP oficial; <see cref="SourceLine"/> é a linha física nele.</summary>
    public string SourceMember { get; init; } = string.Empty;

    public long SourceLine { get; init; }
    public string SourceRowHash { get; init; } = string.Empty;
    public string? SourceGeneratedAt { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
