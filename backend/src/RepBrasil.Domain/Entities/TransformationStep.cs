namespace RepBrasil.Domain.Entities;

public class TransformationStep : AuditableEntity
{
    public Guid ChainId { get; set; }
    public TransformationChain Chain { get; set; } = null!;

    /// <summary>Ordem de execução desta etapa na cadeia (base 0).</summary>
    public int Order { get; set; }

    /// <summary>
    /// Tipo de transformação executada nesta etapa.
    /// Valores: "Extraction", "Normalization", "Matching", "Derivation", "Presentation"
    /// </summary>
    public string StepType { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>
    /// Parâmetros de configuração usados nesta etapa. JSONB livre.
    /// Exemplo: {"rules_version": "v1.0", "encoding": "latin1"}
    /// </summary>
    public string? Parameters { get; set; }

    public DateTime ExecutedAt { get; set; }

    /// <summary>Hash SHA-256 dos dados de entrada desta etapa.</summary>
    public string? SourceHash { get; set; }

    /// <summary>Hash SHA-256 dos dados de saída desta etapa.</summary>
    public string? OutputHash { get; set; }

    /// <summary>
    /// Referência ao objeto/arquivo/registro de entrada (URI, path ou ID).
    /// Complementa SourceHash para rastreamento sem depender apenas de hash.
    /// </summary>
    public string? InputReference { get; set; }

    /// <summary>
    /// Referência ao objeto/arquivo/registro de saída (URI, path ou ID).
    /// Complementa OutputHash para rastreamento sem depender apenas de hash.
    /// </summary>
    public string? OutputReference { get; set; }
}
