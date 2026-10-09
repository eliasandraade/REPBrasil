using RepBrasil.Application.Electoral;

namespace RepBrasil.Application.Interfaces;

/// <summary>
/// Leitura do schema <c>electoral</c> (território, cadastro, Boletim de Urna, candidaturas).
/// Somente leitura: a escrita é exclusiva do ETL Python, a partir dos arquivos oficiais.
/// </summary>
public interface IElectoralReadRepository
{
    Task<IReadOnlyList<ElectionRow>> ElectionsAsync(CancellationToken ct);
    Task<ElectionRow?> ElectionAsync(int year, int round, CancellationToken ct);
    Task<IReadOnlyList<StateRow>> StatesAsync(Guid electionId, CancellationToken ct);
    Task<StateRow?> StateAsync(Guid electionId, string uf, CancellationToken ct);

    /// <summary>Municípios da UF; <paramref name="slugQuery"/> filtra por nome (slug) e <paramref name="code"/> por código exato.</summary>
    Task<IReadOnlyList<MunicipalityRow>> MunicipalitiesAsync(
        Guid electionId, string uf, string? slugQuery, string? code, CancellationToken ct);

    /// <summary>Resolve por slug, código TSE (5 dígitos) ou IBGE (7 dígitos).</summary>
    Task<IReadOnlyList<MunicipalityRow>> MunicipalityAsync(Guid electionId, string uf, string key, CancellationToken ct);

    Task<IReadOnlyList<ZoneRow>> ZonesAsync(Guid electionId, Guid municipalityId, CancellationToken ct);
    Task<IReadOnlyList<PlaceRow>> PlacesAsync(Guid electionId, Guid municipalityId, int zone, CancellationToken ct);
    Task<IReadOnlyList<SectionRow>> SectionsAsync(Guid electionId, Guid municipalityId, int zone, CancellationToken ct);
    Task<CadasterProvenanceRow?> CadasterProvenanceAsync(Guid electionId, Guid municipalityId, CancellationToken ct);

    /// <summary>Lote bem-sucedido mais recente do BU que cobre o município + zona (versão de fonte vigente).</summary>
    Task<BatchRow?> LatestBatchAsync(int year, int round, string uf, string municipalityTseCode, int zone, CancellationToken ct);

    Task<IReadOnlyList<UrnOfficeRow>> UrnOfficesAsync(Guid batchId, string municipalityTseCode, int zone, int principal, CancellationToken ct);

    /// <summary>Seções principais (no lote) cuja lista de agregadas contém <paramref name="section"/>.</summary>
    Task<IReadOnlyList<int>> PrincipalsForAsync(Guid batchId, string municipalityTseCode, int zone, int section, CancellationToken ct);

    Task<IReadOnlyList<VoteRow>> VotesAsync(long resultId, string uf, CancellationToken ct);

    Task<IReadOnlyList<CandidacyRow>> CandidaciesByPoliticianAsync(Guid politicianId, CancellationToken ct);
    Task<CandidacyRow?> CandidacyAsync(Guid candidacyId, CancellationToken ct);

    /// <summary>Votos da candidatura por município, só nos lotes vigentes (nunca soma versões).</summary>
    Task<IReadOnlyList<TerritoryVotesRow>> CandidacyVotesByMunicipalityAsync(Guid candidacyId, CancellationToken ct);

    /// <summary>Cobertura de resultados importados por UF para o pleito/turno.</summary>
    Task<IReadOnlyList<CoverageRow>> ResultsCoverageAsync(int year, int round, CancellationToken ct);
}
