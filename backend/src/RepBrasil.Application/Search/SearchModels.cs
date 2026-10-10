namespace RepBrasil.Application.Search;

// ── Linhas lidas do banco (SQL explícito no repositório) ────────────────────

public sealed class SearchPoliticianRow
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? BallotName { get; init; }
    public int Rank { get; init; }
    public short? Year { get; init; }
    public short? Round { get; init; }
    public int? OfficeCode { get; init; }
    public string? OfficeName { get; init; }
    public string? UnitName { get; init; }
    public string? Uf { get; init; }
    public string? PartyAcronym { get; init; }
    public bool? Elected { get; init; }
}

public sealed class SearchTerritoryRow
{
    public string Kind { get; init; } = "municipality"; // state | municipality
    public string Uf { get; init; } = string.Empty;
    public string? TseCode { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Slug { get; init; }
    public string? StateName { get; init; }
    /// <summary>Pleitos com Boletim de Urna importado no território, "ano-turno" separados por vírgula (mais recente primeiro).</summary>
    public string? Elections { get; init; }
}

public sealed class SearchPartyRow
{
    public string Acronym { get; init; } = string.Empty;
    public string? Name { get; init; }
    public int? Number { get; init; }
    public int Candidacies { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
}

/// <summary>Pleito × UF × cargo com Boletim de Urna importado (o que a busca pode sugerir).</summary>
public sealed class SearchElectionRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public string Uf { get; init; } = string.Empty;
    public int OfficeCode { get; init; }
}

/// <summary>Filtro de pleito extraído da consulta ("Deputado Federal 2022", "2º turno").</summary>
public sealed record SearchFilter(int? Year, int? Round, int? Office)
{
    public bool IsEmpty => Year is null && Round is null && Office is null;
}

// ── Catálogo pequeno e estável (UFs, municípios, partidos, pleitos) ─────────

public sealed record ElectionKey(int Year, int Round);

public sealed class CatalogTerritory
{
    public required SearchTerritoryRow Row { get; init; }
    public required string Folded { get; init; }
    public required string FoldedState { get; init; }
    public required string UfLower { get; init; }
    public required IReadOnlyList<ElectionKey> Elections { get; init; }
    public bool IsState => Row.Kind == "state";
}

public sealed class CatalogParty
{
    public required SearchPartyRow Row { get; init; }
    public required string FoldedAcronym { get; init; }
    public required string CompactAcronym { get; init; }
    public required string FoldedName { get; init; }
}

/// <summary>
/// Catálogo da busca com os nomes já normalizados (uma vez por carga, não a cada tecla). Pequeno: 27 UFs,
/// ~5.570 municípios, dezenas de partidos e os pleitos importados — cabe na memória do processo.
/// </summary>
public sealed class SearchCatalog
{
    public SearchCatalog(
        IReadOnlyList<SearchTerritoryRow> territories, IReadOnlyList<SearchPartyRow> parties, IReadOnlyList<SearchElectionRow> elections)
    {
        Territories = territories.Select(t => new CatalogTerritory
        {
            Row = t,
            Folded = SearchService.Fold(t.Name),
            FoldedState = SearchService.Fold(t.StateName),
            UfLower = t.Uf.Trim().ToLowerInvariant(),
            Elections = SearchService.ParseElections(t.Elections),
        }).ToList();
        // a mesma sigla com outra grafia no TSE ("PC do B" e "PCDOB") é um partido só: vale a grafia mais recente
        Parties = parties
            .GroupBy(p => SearchService.Fold(p.Acronym).Replace(" ", "", StringComparison.Ordinal))
            .Select(g =>
            {
                var latest = g.OrderByDescending(p => p.Year).ThenByDescending(p => p.Round).ThenByDescending(p => p.Candidacies).First();
                var row = new SearchPartyRow
                {
                    Acronym = latest.Acronym,
                    Name = latest.Name,
                    Number = latest.Number,
                    Candidacies = g.Sum(p => p.Candidacies),
                    Year = latest.Year,
                    Round = latest.Round,
                };
                return new CatalogParty
                {
                    Row = row,
                    FoldedAcronym = SearchService.Fold(row.Acronym),
                    CompactAcronym = g.Key,
                    FoldedName = SearchService.Fold(row.Name),
                };
            })
            .ToList();
        Elections = elections;
    }

    public IReadOnlyList<CatalogTerritory> Territories { get; }
    public IReadOnlyList<CatalogParty> Parties { get; }
    public IReadOnlyList<SearchElectionRow> Elections { get; }
}

// ── Resposta ────────────────────────────────────────────────────────────────

/// <summary>Grupos da resposta, na ordem em que a interface deve mostrá-los (melhor correspondência primeiro).</summary>
public static class SearchGroups
{
    public const string Politicians = "politicians";
    public const string Territories = "territories";
    public const string Elections = "elections";
    public const string Parties = "parties";
}

public record SearchCandidacyRef(int Year, int Round, int? OfficeCode, string? OfficeName, string? UnitName, string? Uf, string? Party, bool? Elected);

/// <summary><c>Rank</c>: 0 nome exato, 1 começa com a consulta, 2 a consulta começa uma palavra, 3 todos os termos (em qualquer ordem).</summary>
public record SearchPoliticianDto(Guid Id, string Name, string? BallotName, int Rank, SearchCandidacyRef? Candidacy);

public record SearchTerritoryDto(string Kind, string Uf, string? TseCode, string Name, string? Slug, string? StateName, int Rank,
    IReadOnlyList<ElectionKey> Elections);

public record SearchPartyDto(string Acronym, string? Name, int? Number, int Candidacies, int Year, int Round, int Rank);

/// <summary>Sugestão de pleito: ano/turno, UF, município (slug) e cargo opcionais — o frontend monta a rota do explorador.</summary>
public record SearchElectionDto(int Year, int Round, string Uf, string? Municipality, string PlaceName, int? OfficeCode, string? OfficeName,
    int Rank, string Label);

public record SearchFilterDto(int? Year, int? Round, int? OfficeCode, string? OfficeName);

public record SearchResponse(
    string Query,
    SearchFilterDto Filter,
    IReadOnlyList<string> Order,
    IReadOnlyList<SearchPoliticianDto> Politicians,
    IReadOnlyList<SearchTerritoryDto> Territories,
    IReadOnlyList<SearchPartyDto> Parties,
    IReadOnlyList<SearchElectionDto> Elections);
