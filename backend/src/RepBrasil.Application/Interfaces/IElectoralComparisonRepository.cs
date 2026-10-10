using RepBrasil.Application.Electoral;

namespace RepBrasil.Application.Interfaces;

/// <summary>Leituras analíticas derivadas dos fatos eleitorais oficiais.</summary>
public interface IElectoralComparisonRepository
{
    /// <summary>
    /// Votos das candidaturas em cada seção principal do BU vigente. Quando a candidatura está vinculada
    /// ao pleito/cargo mas não possui linha nominal naquele BU, Votes = 0; ausência de cobertura nunca vira zero.
    /// </summary>
    Task<IReadOnlyList<CandidacySectionComparisonRow>> SectionsAsync(
        IReadOnlyList<Guid> candidacyIds,
        string uf,
        string? municipalityTseCode,
        int? zone,
        CancellationToken ct);
}
