using RepBrasil.Application.Search;

namespace RepBrasil.Application.Interfaces;

/// <summary>
/// Leituras da busca global. Os termos chegam já normalizados (minúsculas, sem acento, só [a-z0-9]) e cada
/// termo precisa começar uma palavra do nome — sem fuzzy, sem ordem mágica: previsível e rápido.
/// </summary>
public interface ISearchRepository
{
    /// <summary>
    /// Políticos cujo nome (de urna ou civil) contém todos os termos; com filtro de pleito, só quem disputou um pleito
    /// que casa com o filtro — e a candidatura devolvida é essa. Ordem: <c>Rank</c>, eleitos, mais recentes.
    /// </summary>
    Task<IReadOnlyList<SearchPoliticianRow>> PoliticiansAsync(
        IReadOnlyList<string> terms, string text, SearchFilter filter, int limit, CancellationToken ct);

    /// <summary>UFs, municípios, partidos e pleitos importados (o repositório pode manter em cache).</summary>
    Task<SearchCatalog> CatalogAsync(CancellationToken ct);
}
