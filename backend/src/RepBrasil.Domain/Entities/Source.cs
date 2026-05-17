namespace RepBrasil.Domain.Entities;

public class Source : AuditableEntity
{
    // Campos originais — mantidos intactos
    public string Name { get; set; } = string.Empty;
    public string Organization { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string OriginalUrl { get; set; } = string.Empty;
    public DateTime CollectedAt { get; set; }
    public string? Hash { get; set; }
    public long? FileSizeBytes { get; set; }
    public string? License { get; set; }

    // Campos de rastreabilidade — Bloco 0 Fase 3

    /// <summary>
    /// Confiabilidade histórica do schema/API da fonte. Escala 1–5: 5 = máxima (schema estável,
    /// API oficial com versioning); 1 = mínima (schema instável, mudanças frequentes sem aviso).
    /// NÃO é índice de risco: 5 é o melhor valor. Ver docs/fase3/matriz-nacional-de-fontes.md.
    /// </summary>
    public int? HistoricalReliability { get; set; }

    /// <summary>
    /// Método pelo qual os dados são coletados.
    /// Valores: "API", "CSV_Download", "Scraping", "Manual", "RSS", "FTP"
    /// </summary>
    public string? CollectionMethod { get; set; }

    /// <summary>
    /// Periodicidade de atualização da fonte de origem.
    /// Valores: "Annual", "Monthly", "Weekly", "Daily", "RealTime", "OnDemand"
    /// </summary>
    public string? Periodicity { get; set; }

    /// <summary>
    /// Versão do schema do dataset coletado (quando publicada pela fonte).
    /// </summary>
    public string? SchemaVersion { get; set; }

    /// <summary>
    /// Data em que os dados na fonte de origem foram atualizados pela última vez.
    /// </summary>
    public DateTime? SourceDataUpdatedAt { get; set; }

    /// <summary>
    /// Nível de confiança atribuído a esta fonte. Escala 1–5: 5 = confiança máxima (fonte oficial,
    /// dado primário verificável); 1 = confiança mínima. Ver docs/fase3/camada-de-evidencia.md.
    /// </summary>
    public int? ConfidenceLevel { get; set; }

    /// <summary>
    /// Indica se a fonte está disponível para coleta no momento.
    /// </summary>
    public bool IsAvailable { get; set; } = true;

    /// <summary>
    /// Status operacional atual da fonte.
    /// Valores: "Active", "Degraded", "Offline", "Decommissioned"
    /// </summary>
    public string OperationalStatus { get; set; } = "Active";
}
