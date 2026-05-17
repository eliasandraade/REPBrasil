namespace RepBrasil.Domain.Entities;

public class Contestation : AuditableEntity
{
    // Campos originais — mantidos intactos
    public Guid PoliticianId { get; set; }
    public Politician Politician { get; set; } = null!;
    public string DataField { get; set; } = string.Empty;
    public string CurrentValue { get; set; } = string.Empty;
    public string ClaimedValue { get; set; } = string.Empty;

    /// <summary>
    /// Status do ciclo de vida desta contestação.
    /// Valores (conforme docs/fase3/camada-de-evidencia.md):
    /// "Recebida" | "Em análise" | "Aceita" | "Parcialmente aceita" |
    /// "Rejeitada" | "Atualizada por decisão oficial posterior"
    /// NÃO usar "Resolvida" ou "Retirada" — divergem da documentação oficial.
    /// </summary>
    public string Status { get; set; } = "Recebida";

    public string? SupportingDocumentUrl { get; set; }
    public string? Resolution { get; set; }

    // Campos de rastreabilidade — Bloco 0 Fase 3

    public Guid? EvidenceId { get; set; }
    public Evidence? Evidence { get; set; }

    public Guid? SourceId { get; set; }
    public Source? Source { get; set; }

    /// <summary>
    /// Categoria do contestante. NÃO armazenar dados pessoais do contestante.
    /// Valores: "Citizen", "Journalist", "Institution", "System"
    /// </summary>
    public string? SubmitterType { get; set; }

    public DateTime? ReviewedAt { get; set; }

    /// <summary>
    /// Papel institucional do revisor. NUNCA dados pessoais identificáveis.
    /// Valores: "Moderator", "Editorial", "System"
    /// </summary>
    public string? ReviewerRole { get; set; }

    public string? ReviewNotes { get; set; }
}
