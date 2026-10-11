using RepBrasil.Application.Electoral;

namespace RepBrasil.Application.Interfaces;

/// <summary>
/// Leituras do Raio X eleitoral. Fatos (candidaturas, BU, bens, registros, contas) e agregados
/// DERIVADOS do BU vigente (zona × cargo). Nenhum método transforma ausência em zero: linhas
/// inexistentes voltam como ausentes e a camada de aplicação decide o estado.
/// </summary>
public interface IElectoralXrayRepository
{
    Task<PoliticianRefRow?> PoliticianAsync(Guid politicianId, CancellationToken ct);

    /// <summary>Candidaturas do perfil: mesmo perfil OU mesma pessoa (identidade canônica).</summary>
    Task<IReadOnlyList<XrayCandidacyRow>> SubjectCandidaciesAsync(Guid politicianId, Guid? personId, CancellationToken ct);

    Task<IReadOnlyList<XrayCandidacyRow>> CandidaciesAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    /// <summary>Votos por zona das candidaturas (via vínculo auditado votável → candidatura).</summary>
    Task<IReadOnlyList<CandidacyZoneVotesRow>> ZoneVotesAsync(
        IReadOnlyList<Guid> candidacyIds, string? uf, string? municipalityTseCode, CancellationToken ct);

    /// <summary>Totais por zona dos cargos pedidos (somente zonas com BU vigente).</summary>
    Task<IReadOnlyList<ZoneTotalsRow>> ZoneTotalsAsync(
        IReadOnlyList<ElectionOffice> keys, string? uf, string? municipalityTseCode, CancellationToken ct);

    /// <summary>Zonas esperadas pelo cadastro oficial de cada eleição (base da cobertura).</summary>
    Task<IReadOnlyList<ExpectedZoneRow>> ExpectedZonesAsync(
        IReadOnlyList<(int Year, int Round)> elections, string? uf, string? municipalityTseCode, CancellationToken ct);

    /// <summary>Posição de cada candidatura entre os números votados da própria disputa (unidade inteira).</summary>
    Task<IReadOnlyList<ContestRankRow>> RanksAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    /// <summary>Titular da chapa de vices e suplentes (mesma eleição, unidade e número).</summary>
    Task<IReadOnlyList<TicketRow>> TicketsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    Task<IReadOnlyList<AssetRow>> AssetsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    Task<IReadOnlyList<SourceRecordRow>> RecordsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    Task<IReadOnlyList<FinanceTotalsRow>> FinanceTotalsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    Task<IReadOnlyList<FinanceCategoryRow>> FinanceCategoriesAsync(Guid candidacyId, CancellationToken ct);

    Task<IReadOnlyList<FinanceCounterpartyRow>> FinanceCounterpartiesAsync(
        Guid candidacyId, string recordKind, int limit, CancellationToken ct);

    Task<IReadOnlyList<PriorRow>> PriorsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct);

    /// <summary>Urnas (seções principais) do BU vigente dos cargos pedidos num município (e zona).</summary>
    Task<IReadOnlyList<SectionResultRow>> SectionResultsAsync(
        IReadOnlyList<ElectionOffice> keys, string uf, string municipalityTseCode, int? zone, CancellationToken ct);

    /// <summary>Votos das candidaturas por urna do BU vigente num município (e zona). Sem linha ⇒ sem voto naquela urna.</summary>
    Task<IReadOnlyList<SectionCandidacyVotesRow>> SectionVotesAsync(
        IReadOnlyList<Guid> candidacyIds, string uf, string municipalityTseCode, int? zone, CancellationToken ct);

    Task<IReadOnlyList<PlaceNameRow>> PlacesAsync(
        IReadOnlyList<(int Year, int Round)> elections, string uf, string municipalityTseCode, int? zone, CancellationToken ct);

    /// <summary>Candidaturas de disputas que alcançam o território, com votos no território (agregado).</summary>
    Task<IReadOnlyList<XrayCandidacyRow>> ElectionCandidaciesAsync(
        int year, int round, string uf, string? municipalityTseCode, CancellationToken ct);

    Task<IReadOnlyList<MunicipalityRefRow>> MunicipalitiesAsync(string uf, CancellationToken ct);

    /// <summary>
    /// Base Eleitoral: posição da candidatura entre os números votados da disputa em cada território do nível pedido
    /// (município ou zona: agregados derivados híbridos; seção ou local: fatos do BU — no lake quando o escopo é frio).
    /// </summary>
    Task<IReadOnlyList<ContestStatsRow>> ContestStatsAsync(ContestStatsQuery query, CancellationToken ct);

    Task<FreshnessRow?> FreshnessAsync(CancellationToken ct);
}
