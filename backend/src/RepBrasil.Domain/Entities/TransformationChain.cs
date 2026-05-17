namespace RepBrasil.Domain.Entities;

public class TransformationChain : AuditableEntity
{
    public string PipelineId { get; set; } = string.Empty;
    public string PipelineVersion { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>
    /// Status de execução da cadeia.
    /// Valores: "Running", "Completed", "Failed"
    /// </summary>
    public string Status { get; set; } = "Completed";

    public string? ErrorMessage { get; set; }

    public ICollection<TransformationStep> Steps { get; set; } = [];
    public ICollection<Evidence> Evidences { get; set; } = [];
}
