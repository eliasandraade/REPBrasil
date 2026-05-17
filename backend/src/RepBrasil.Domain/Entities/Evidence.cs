namespace RepBrasil.Domain.Entities;

public class Evidence : AuditableEntity
{
    // Campos originais — mantidos intactos
    public Guid SourceId { get; set; }
    public Source Source { get; set; } = null!;
    public string Description { get; set; } = string.Empty;
    public string? RawValue { get; set; }
    public string? DocumentUrl { get; set; }

    // Campos de rastreabilidade — Bloco 0 Fase 3

    /// <summary>Identificador do dataset específico dentro da fonte.</summary>
    public string? DatasetId { get; set; }

    /// <summary>Hash SHA-256 do valor bruto (RawValue) para verificação de integridade.</summary>
    public string? ContentHash { get; set; }

    public DateTime CollectedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Data em que o fato foi observado na fonte (pode diferir de CollectedAt).</summary>
    public DateTime? ObservedAt { get; set; }

    /// <summary>
    /// Tipo de evidência conforme docs/fase3/camada-de-evidencia.md.
    /// Valores: "Primary", "Derived", "Documentary"
    /// "Testimonial" é explicitamente proibido — não usar.
    /// </summary>
    public string EvidenceType { get; set; } = "Primary";

    /// <summary>
    /// Nível de confiança na evidência. Escala 1–5: 5 = confiança máxima (dado primário
    /// verificável em fonte oficial); 1 = confiança mínima. NÃO confundir com CertaintyGrade.
    /// Ver docs/fase3/camada-de-evidencia.md.
    /// </summary>
    public int ConfidenceLevel { get; set; } = 1;

    /// <summary>
    /// Grau de certeza ontológica conforme docs/fase3/ontologia-repbrasil.md. Escala 1–6:
    /// 1 = Fato confirmado; 2 = Vínculo documental; 3 = Relação indireta;
    /// 4 = Hipótese (não exibida publicamente); 5 = Ausência de evidência;
    /// 6 = Conflito de evidência (exibido com aviso).
    /// </summary>
    public int? CertaintyGrade { get; set; }

    /// <summary>Forma normalizada da referência bruta (ex: nome canonicalizado, data ISO 8601).</summary>
    public string? NormalizedReference { get; set; }

    public Guid? TransformationChainId { get; set; }
    public TransformationChain? TransformationChain { get; set; }

    /// <summary>Metadados livres em JSONB.</summary>
    public string? Metadata { get; set; }

    /// <summary>
    /// Status de contestação pública desta evidência.
    /// Valores: "None", "Pending", "Resolved", "Withdrawn"
    /// </summary>
    public string ContestationStatus { get; set; } = "None";
}
