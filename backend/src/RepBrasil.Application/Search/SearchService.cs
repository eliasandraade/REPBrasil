using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Search;

/// <summary>
/// Busca global: políticos/candidaturas, territórios (UF e município), partidos e pleitos.
/// Previsível: a consulta é normalizada (minúsculas, sem acento, sem pontuação), ano/turno/cargo viram
/// filtro de pleito ("Deputado Federal 2022", "prefeito 2024 2º turno") e cada termo restante precisa
/// começar uma palavra do nome. Sem fuzzy e sem ranking opaco: exato, prefixo, início de palavra, termos.
/// </summary>
public sealed partial class SearchService(ISearchRepository repo)
{
    public const int MinQueryLength = 2;
    public const int MaxQueryLength = 80;
    public const int MaxLimit = 10;
    public const int MaxTerms = 6;

    /// <summary>Cargos que a busca reconhece (forma sem acento → código do TSE). Mais longos primeiro.</summary>
    private static readonly (string Phrase, int Code)[] OfficePhrases =
    [
        ("vice presidente", 2), ("vice governador", 4), ("vice prefeito", 12), ("vice prefeita", 12),
        ("deputado federal", 6), ("deputada federal", 6), ("deputados federais", 6),
        ("deputado estadual", 7), ("deputada estadual", 7), ("deputados estaduais", 7),
        ("deputado distrital", 8), ("deputada distrital", 8),
        ("presidente", 1), ("presidenta", 1), ("governador", 3), ("governadora", 3),
        ("senador", 5), ("senadora", 5), ("senadores", 5),
        ("prefeito", 11), ("prefeita", 11), ("prefeitos", 11),
        ("vereador", 13), ("vereadora", 13), ("vereadores", 13),
    ];

    public static readonly IReadOnlyDictionary<int, string> OfficeNames = new Dictionary<int, string>
    {
        [1] = "Presidente",
        [2] = "Vice-Presidente",
        [3] = "Governador",
        [4] = "Vice-Governador",
        [5] = "Senador",
        [6] = "Deputado Federal",
        [7] = "Deputado Estadual",
        [8] = "Deputado Distrital",
        [9] = "1º Suplente",
        [10] = "2º Suplente",
        [11] = "Prefeito",
        [12] = "Vice-Prefeito",
        [13] = "Vereador",
    };

    /// <summary>Partículas: ficam no texto do ranking ("juazeiro do norte" é exato), mas não são termo obrigatório.</summary>
    private static readonly HashSet<string> Particles = ["da", "de", "do", "das", "dos", "e", "o", "a"];

    /// <summary>Vocabulário da própria busca: não identifica ninguém nem entra no ranking.</summary>
    private static readonly HashSet<string> Vocabulary = ["eleicao", "eleicoes", "turno"];

    /// <param name="Normalized">Consulta inteira normalizada.</param>
    /// <param name="Text">O que sobra sem ano/turno/cargo (com partículas) — base do ranking.</param>
    /// <param name="Terms">Palavras de <paramref name="Text"/> que precisam começar uma palavra do nome.</param>
    public sealed record ParsedQuery(string Normalized, string Text, IReadOnlyList<string> Terms, SearchFilter Filter);

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex NonAlnum();

    [GeneratedRegex(@"\b(19|20)\d{2}\b")]
    private static partial Regex YearToken();

    [GeneratedRegex(@"\b(?:(1|2)\s*o?\s*turno|turno\s*(1|2)|(primeiro|segundo)\s+turno)\b")]
    private static partial Regex RoundToken();

    /// <summary>Sem acento, minúsculas, pontuação vira espaço, espaços colapsados. Igual a <c>public.search_fold</c> (SQL).</summary>
    public static string Fold(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var decomposed = value.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return NonAlnum().Replace(sb.ToString().Normalize(NormalizationForm.FormC), " ").Trim();
    }

    public static ParsedQuery Parse(string? raw)
    {
        var text = (raw ?? string.Empty).Trim();
        if (text.Length > MaxQueryLength) text = text[..MaxQueryLength];
        // "2º turno" → "2o turno" antes de tirar a pontuação
        var folded = Fold(text.Replace('º', 'o').Replace('ª', 'a'));
        var normalized = folded;
        int? year = null, round = null, office = null;
        var y = YearToken().Match(folded);
        if (y.Success)
        {
            year = int.Parse(y.Value, CultureInfo.InvariantCulture);
            folded = folded.Remove(y.Index, y.Length);
        }
        var r = RoundToken().Match(folded);
        if (r.Success)
        {
            var digit = r.Groups[1].Success ? r.Groups[1].Value : r.Groups[2].Value;
            round = digit is "1" or "2" ? int.Parse(digit, CultureInfo.InvariantCulture) : r.Groups[3].Value == "primeiro" ? 1 : 2;
            folded = folded.Remove(r.Index, r.Length);
        }
        var padded = $" {NonAlnum().Replace(folded, " ").Trim()} ";
        foreach (var (phrase, code) in OfficePhrases)
        {
            var i = padded.IndexOf($" {phrase} ", StringComparison.Ordinal);
            if (i < 0) continue;
            office = code;
            padded = padded.Remove(i, phrase.Length + 1);
            break;
        }
        var words = padded.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !Vocabulary.Contains(w)).ToList();
        var terms = words.Where(t => !Particles.Contains(t)).Distinct().Take(MaxTerms).ToList();
        return new ParsedQuery(normalized, string.Join(' ', words), terms, new SearchFilter(year, round, office));
    }

    /// <summary>
    /// Termos de um filtro só de nome (lista de políticos): palavras normalizadas, sem partículas — a não ser que a
    /// consulta seja só partícula ("da").
    /// </summary>
    public static IReadOnlyList<string> NameTerms(string? raw)
    {
        var text = (raw ?? string.Empty).Trim();
        if (text.Length > MaxQueryLength) text = text[..MaxQueryLength];
        var words = Fold(text).Split(' ', StringSplitOptions.RemoveEmptyEntries).Distinct().ToList();
        var terms = words.Where(w => !Particles.Contains(w)).ToList();
        return (terms.Count > 0 ? terms : words).Take(MaxTerms).ToList();
    }

    /// <summary>0 exato, 1 começa com a consulta, 2 a consulta começa uma palavra, 3 só os termos (em qualquer ordem).</summary>
    public static int Rank(string folded, string text) =>
        folded == text ? 0
        : folded.StartsWith(text, StringComparison.Ordinal) ? 1
        : $" {folded}".Contains($" {text}", StringComparison.Ordinal) ? 2
        : 3;

    /// <summary>O termo começa uma palavra do texto ("fern" em "andre fernandes"; "pt" não casa com "dix sept").</summary>
    public static bool StartsWord(string folded, string term) =>
        folded.StartsWith(term, StringComparison.Ordinal) || folded.Contains($" {term}", StringComparison.Ordinal);

    public async Task<SearchResponse> SearchAsync(string? q, int limit, CancellationToken ct)
    {
        var parsed = Parse(q);
        limit = Math.Clamp(limit, 1, MaxLimit);
        var filter = new SearchFilterDto(parsed.Filter.Year, parsed.Filter.Round, parsed.Filter.Office,
            parsed.Filter.Office is { } o ? OfficeNames.GetValueOrDefault(o) : null);
        if (parsed.Normalized.Length < MinQueryLength)
            return new SearchResponse(parsed.Normalized, filter, [], [], [], [], []);

        // termos curtos demais (1 letra no total) não buscam entidades: devolveriam o banco inteiro
        var searchEntities = parsed.Terms.Count > 0 && parsed.Terms.Sum(t => t.Length) >= MinQueryLength;
        if (!searchEntities && parsed.Filter.IsEmpty)
            return new SearchResponse(parsed.Normalized, filter, [], [], [], [], []);

        var catalog = await repo.CatalogAsync(ct);
        var territories = searchEntities ? MatchTerritories(catalog, parsed).Take(limit).ToList() : [];
        // cargo/ano + um lugar exato ("vereador fortaleza", "ceará 2022"): procura-se a eleição do lugar,
        // não pessoas com "Fortaleza" no nome
        var aboutPlace = !parsed.Filter.IsEmpty && territories.Any(t => t.Rank == 0);
        var politicians = searchEntities && !aboutPlace
            ? await repo.PoliticiansAsync(parsed.Terms, parsed.Text, parsed.Filter, limit, ct)
            : [];
        // partido não tem pleito: com filtro de pleito, a consulta é sobre candidatos/territórios
        var parties = searchEntities && parsed.Filter.IsEmpty ? MatchParties(catalog, parsed).Take(limit).ToList() : [];
        var elections = Suggest(catalog, parsed, territories, limit);

        var response = new SearchResponse(
            parsed.Normalized,
            filter,
            [],
            politicians.Select(ToDto).ToList(),
            territories.Select(t => new SearchTerritoryDto(t.Item.Row.Kind, t.Item.Row.Uf.Trim(), t.Item.Row.TseCode?.Trim(), t.Item.Row.Name,
                t.Item.Row.Slug, t.Item.Row.StateName, t.Rank, t.Item.Elections)).ToList(),
            parties.Select(p => new SearchPartyDto(p.Item.Row.Acronym, p.Item.Row.Name, p.Item.Row.Number, p.Item.Row.Candidacies,
                p.Item.Row.Year, p.Item.Row.Round, p.Rank)).ToList(),
            elections);
        return response with { Order = GroupOrder(response, parsed.Filter) };
    }

    private static SearchPoliticianDto ToDto(SearchPoliticianRow p) => new(p.Id, p.Name, p.BallotName, p.Rank,
        p.Year is null
            ? null
            : new SearchCandidacyRef(p.Year.Value, p.Round ?? 1, p.OfficeCode,
                p.OfficeCode is { } code && OfficeNames.TryGetValue(code, out var office) ? office : Fmt.Name(p.OfficeName),
                p.UnitName, p.Uf?.Trim(), p.PartyAcronym, p.Elected));

    public sealed record Ranked<T>(T Item, int Rank);

    /// <summary>
    /// UF: todos os termos no nome (ou a sigla). Município: cada termo no nome, na sigla ou no nome da UF — mas ao menos
    /// um no nome ("sao paulo" não traz os 645 municípios paulistas). Lugares com pleito importado vêm primeiro.
    /// </summary>
    public static IEnumerable<Ranked<CatalogTerritory>> MatchTerritories(SearchCatalog catalog, ParsedQuery q)
    {
        var matches = new List<Ranked<CatalogTerritory>>();
        foreach (var t in catalog.Territories)
        {
            var inName = 0;
            var ok = true;
            foreach (var term in q.Terms)
            {
                if (StartsWord(t.Folded, term)) inName++;
                else if (term == t.UfLower || (!t.IsState && StartsWord(t.FoldedState, term))) continue;
                else { ok = false; break; }
            }
            if (!ok || (inName == 0 && !(t.IsState && q.Terms.All(term => term == t.UfLower)))) continue;
            var rank = t.IsState
                ? Math.Min(Rank(t.Folded, q.Text), Rank(t.UfLower, q.Text))
                : Math.Min(Rank(t.Folded, q.Text), Math.Min(Rank($"{t.Folded} {t.UfLower}", q.Text), Rank($"{t.Folded} {t.FoldedState}", q.Text)));
            matches.Add(new Ranked<CatalogTerritory>(t, rank));
        }
        return matches
            .OrderByDescending(m => m.Item.Elections.Count > 0)
            .ThenBy(m => m.Rank)
            .ThenByDescending(m => m.Item.IsState)
            .ThenBy(m => m.Item.Folded, StringComparer.Ordinal)
            .ThenBy(m => m.Item.UfLower, StringComparer.Ordinal);
    }

    /// <summary>Cada termo na sigla ("pc do b", "pcdob") ou no nome; sigla exata primeiro, depois os maiores.</summary>
    public static IEnumerable<Ranked<CatalogParty>> MatchParties(SearchCatalog catalog, ParsedQuery q)
    {
        var compactText = q.Text.Replace(" ", "", StringComparison.Ordinal);
        return catalog.Parties
            .Where(p => q.Terms.All(term => StartsWord(p.FoldedAcronym, term) || p.CompactAcronym.StartsWith(term, StringComparison.Ordinal)
                                            || StartsWord(p.FoldedName, term)))
            .Select(p => new Ranked<CatalogParty>(p, Math.Min(Math.Min(Rank(p.FoldedAcronym, q.Text), Rank(p.CompactAcronym, compactText)),
                Rank(p.FoldedName, q.Text))))
            .OrderBy(m => m.Rank)
            .ThenByDescending(m => m.Item.Row.Candidacies)
            .ThenBy(m => m.Item.FoldedAcronym, StringComparer.Ordinal);
    }

    /// <summary>
    /// Pleitos que casam com ano/turno/cargo pedidos. Sem outros termos: em cada UF com dados. Com termos: só nos
    /// lugares encontrados (o município, quando é ele) — termos que não são lugar falam de pessoa ou partido.
    /// </summary>
    public static IReadOnlyList<SearchElectionDto> Suggest(
        SearchCatalog catalog, ParsedQuery q, IReadOnlyList<Ranked<CatalogTerritory>> territories, int limit)
    {
        var f = q.Filter;
        if (f.IsEmpty) return [];
        var scopes = q.Terms.Count == 0
            ? catalog.Elections.Select(e => e.Uf.Trim()).Distinct().Order(StringComparer.Ordinal)
                .Select(uf => (Uf: uf, Place: catalog.Territories.FirstOrDefault(t => t.IsState && t.Row.Uf.Trim() == uf), Rank: 0))
                .ToList()
            : territories.Where(t => t.Item.Elections.Count > 0).Take(2).Select(t => (Uf: t.Item.Row.Uf.Trim(), Place: (CatalogTerritory?)t.Item, t.Rank)).ToList();

        var suggestions = new List<SearchElectionDto>();
        foreach (var (uf, place, rank) in scopes)
        {
            var municipality = place is { IsState: false } ? place : null;
            var rows = catalog.Elections.Where(e => e.Uf.Trim() == uf && (f.Year is null || e.Year == f.Year)
                                                     && (f.Round is null || e.Round == f.Round) && (f.Office is null || e.OfficeCode == f.Office)
                                                     && (municipality is null || municipality.Elections.Contains(new ElectionKey(e.Year, e.Round))));
            var keys = rows.Select(e => (Year: (int)e.Year, Round: (int)e.Round, Office: f.Office is null ? (int?)null : e.OfficeCode)).Distinct();
            var placeName = place?.Row.Name ?? uf;
            foreach (var k in keys)
            {
                var office = k.Office is { } o ? OfficeNames.GetValueOrDefault(o) : null;
                var label = string.Join(" · ", new[] { office, placeName, $"Eleições {k.Year}", $"{k.Round}º turno" }.Where(s => s is not null));
                suggestions.Add(new SearchElectionDto(k.Year, k.Round, uf, municipality?.Row.Slug, placeName, k.Office, office, rank, label));
            }
        }
        return suggestions
            .OrderBy(s => s.Rank)
            .ThenByDescending(s => s.Year)
            .ThenBy(s => s.Round)
            .ThenBy(s => s.Uf, StringComparer.Ordinal)
            .Take(limit)
            .ToList();
    }

    /// <summary>Grupos não vazios pela melhor correspondência; empate: com filtro de pleito, pleitos primeiro.</summary>
    public static IReadOnlyList<string> GroupOrder(SearchResponse r, SearchFilter filter)
    {
        var groups = new List<(string Name, int Best, int Priority)>();
        if (r.Elections.Count > 0) groups.Add((SearchGroups.Elections, r.Elections.Min(e => e.Rank), filter.IsEmpty ? 3 : 0));
        if (r.Politicians.Count > 0) groups.Add((SearchGroups.Politicians, r.Politicians.Min(p => p.Rank), 1));
        if (r.Territories.Count > 0) groups.Add((SearchGroups.Territories, r.Territories.Min(t => t.Rank), 2));
        if (r.Parties.Count > 0) groups.Add((SearchGroups.Parties, r.Parties.Min(p => p.Rank), 4));
        return groups.OrderBy(g => g.Best).ThenBy(g => g.Priority).Select(g => g.Name).ToList();
    }

    public static IReadOnlyList<ElectionKey> ParseElections(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Split('-'))
                .Where(p => p.Length == 2 && int.TryParse(p[0], out _) && int.TryParse(p[1], out _))
                .Select(p => new ElectionKey(int.Parse(p[0], CultureInfo.InvariantCulture), int.Parse(p[1], CultureInfo.InvariantCulture)))
                .ToList();
}
