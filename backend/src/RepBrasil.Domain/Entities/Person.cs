namespace RepBrasil.Domain.Entities;

public class Person : AuditableEntity
{
    public string FullName { get; set; } = string.Empty;

    /// <summary>
    /// Lista de nomes alternativos ou apelidos documentados. Mapeado para text[] no Postgres.
    /// </summary>
    public string[]? Aliases { get; set; }

    /// <summary>
    /// HMAC-SHA256 (chave secreta do ambiente, REPBRASIL_PERSON_DOCUMENT_KEY) do CPF normalizado
    /// (dígitos apenas). Um SHA-256 sem chave de um CPF seria revertido por enumeração.
    /// NUNCA armazenar CPF completo em plaintext. Ver docs/TSE_IDENTITY.md.
    /// Quando a fonte pública oferecer apenas CPF parcial (ex: "***.***.123-**"),
    /// armazenar somente o fragmento público disponível.
    /// Armazenar hash somente quando juridicamente permitido pela fonte.
    /// </summary>
    public string? NormalizedDocumentHash { get; set; }

    /// <summary>
    /// Tipo do documento referenciado em NormalizedDocumentHash.
    /// Valores: "CPF", "CNPJ", "Passport", "RG"
    /// </summary>
    public string? DocumentType { get; set; }

    /// <summary>
    /// Identificador externo de sistema de origem (ex: ID em base de dados pública).
    /// </summary>
    public string? ExternalId { get; set; }

    /// <summary>
    /// Metadados livres em JSONB para campos futuros.
    /// </summary>
    public string? Metadata { get; set; }

    public ICollection<Politician> Politicians { get; set; } = [];
}
