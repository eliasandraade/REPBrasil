using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using NpgsqlTypes;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Search;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// SQL da busca global. Políticos: <see cref="PoliticianNameMatch"/> (índice de trigramas, cada termo começa uma
/// palavra do nome). Catálogo (UFs, municípios, partidos, pleitos): pequeno e estável, lido uma vez e guardado na
/// memória do processo.
/// </summary>
public class SearchRepository(ApplicationDbContext db, IMemoryCache cache) : ISearchRepository
{
    public const string CatalogCacheKey = "search:catalog";
    /// <summary>Cargas do ETL são raras; dez minutos de defasagem no catálogo da busca são aceitáveis.</summary>
    private static readonly TimeSpan CatalogTtl = TimeSpan.FromMinutes(10);

    /// <summary>0 exato, 1 prefixo, 2 a consulta começa uma palavra, 3 só os termos — como <c>SearchService.Rank</c>.</summary>
    private static string Rank(string folded) =>
        $"CASE WHEN {folded} = @q THEN 0 WHEN {folded} LIKE @q || '%' THEN 1 WHEN ' ' || {folded} LIKE '% ' || @q || '%' THEN 2 ELSE 3 END";

    public async Task<IReadOnlyList<SearchPoliticianRow>> PoliticiansAsync(
        IReadOnlyList<string> terms, string text, SearchFilter filter, int limit, CancellationToken ct)
    {
        var parameters = new List<object>
        {
            new NpgsqlParameter("q", NpgsqlDbType.Text) { Value = text },
            new NpgsqlParameter("limit", NpgsqlDbType.Integer) { Value = limit },
        };
        var match = PoliticianNameMatch.Conditions(terms, parameters);
        var contest = new StringBuilder();
        if (filter.Year is { } year)
        {
            contest.Append(" AND e.year = @year");
            parameters.Add(new NpgsqlParameter("year", NpgsqlDbType.Integer) { Value = year });
        }
        if (filter.Round is { } round)
        {
            contest.Append(" AND e.round = @round");
            parameters.Add(new NpgsqlParameter("round", NpgsqlDbType.Integer) { Value = round });
        }
        if (filter.Office is { } office)
        {
            contest.Append(" AND k.office_code = @office");
            parameters.Add(new NpgsqlParameter("office", NpgsqlDbType.Integer) { Value = office });
        }
        var disputed = contest.Length == 0
            ? ""
            : $"""
               AND EXISTS (SELECT 1 FROM electoral.candidacy c
                             JOIN electoral.contest k ON k.id = c.contest_id
                             JOIN electoral.election e ON e.id = k.election_id
                            WHERE c.politician_id = p."Id"{contest})
               """;

        // 1) nomes que casam (índice), ranking barato e corte; 2) a candidatura (mais recente ou a do filtro) só para esses
        var sql = $"""
            WITH m AS (
              SELECT p."Id", p."Name", p."BallotName", p."State", p."Slug",
                     public.search_fold(p."BallotName") AS fb, public.search_fold(p."Name") AS fn
                FROM public."Politicians" p
               WHERE p."DeletedAt" IS NULL{match}
                 {disputed}
            ), ranked AS (
              SELECT m.*, LEAST({Rank("m.fb")}, {Rank("m.fn")}) AS rank FROM m ORDER BY rank, m.fb, m."Id" LIMIT 200
            )
            SELECT r."Id" AS "Id", r."Name" AS "Name", r."BallotName" AS "BallotName", r."Slug" AS "Slug", r.rank AS "Rank",
                   lc.year AS "Year", lc.round AS "Round", lc.office_code AS "OfficeCode", lc.office_name AS "OfficeName",
                   lc.unit_name AS "UnitName", COALESCE(lc.uf, r."State") AS "Uf", lc.party_acronym AS "PartyAcronym",
                   lc.elected AS "Elected"
              FROM ranked r
              LEFT JOIN LATERAL (
                SELECT e.year, e.round, k.office_code, k.office_name, k.uf::text AS uf, c.party_acronym, c.elected,
                       CASE k.scope WHEN 'federal' THEN 'Brasil' WHEN 'state' THEN st.name ELSE mu.name END AS unit_name
                  FROM electoral.candidacy c
                  JOIN electoral.contest k ON k.id = c.contest_id
                  JOIN electoral.election e ON e.id = k.election_id
                  LEFT JOIN electoral.state st ON st.code = k.uf
                  LEFT JOIN electoral.municipality mu ON k.scope = 'municipal' AND mu.state_code = k.uf AND mu.tse_code = k.electoral_unit
                 WHERE c.politician_id = r."Id"{contest}
                 ORDER BY e.year DESC, e.round DESC, (k.office_code IN (2, 4, 9, 10, 12)), k.office_code
                 LIMIT 1) lc ON true
             ORDER BY r.rank, (lc.elected IS TRUE) DESC, lc.year DESC NULLS LAST, r.fb, r."Id"
             LIMIT @limit
            """;
        return await db.Database.SqlQueryRaw<SearchPoliticianRow>(sql, parameters.ToArray()).ToListAsync(ct);
    }

    public async Task<SearchCatalog> CatalogAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync(CatalogCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CatalogTtl;
            return await LoadCatalogAsync(ct);
        }))!;

    private async Task<SearchCatalog> LoadCatalogAsync(CancellationToken ct)
    {
        var territories = await db.Database.SqlQueryRaw<SearchTerritoryRow>("""
            WITH pleitos AS (SELECT DISTINCT year, turn, uf, municipality_tse_code FROM electoral.zone_office_totals_current),
            by_mun AS (
              SELECT uf, municipality_tse_code, string_agg(year::text || '-' || turn::text, ',' ORDER BY year DESC, turn DESC) AS elections
                FROM pleitos GROUP BY uf, municipality_tse_code
            ),
            by_state AS (
              SELECT uf, string_agg(year::text || '-' || turn::text, ',' ORDER BY year DESC, turn DESC) AS elections
                FROM (SELECT DISTINCT year, turn, uf FROM pleitos) d GROUP BY uf
            )
            SELECT 'state' AS "Kind", s.code::text AS "Uf", NULL::text AS "TseCode", s.name AS "Name", NULL::text AS "Slug",
                   NULL::text AS "StateName", bs.elections AS "Elections"
              FROM electoral.state s LEFT JOIN by_state bs ON bs.uf = s.code
            UNION ALL
            SELECT 'municipality', m.state_code::text, m.tse_code::text, m.name, m.slug, s.name, bm.elections
              FROM electoral.municipality m
              JOIN electoral.state s ON s.code = m.state_code
              LEFT JOIN by_mun bm ON bm.uf = m.state_code AND bm.municipality_tse_code = m.tse_code
            """).ToListAsync(ct);
        var parties = await db.Database.SqlQueryRaw<SearchPartyRow>("""
            SELECT c.party_acronym AS "Acronym", max(c.party_name) AS "Name", max(c.party_number) AS "Number",
                   count(*)::int AS "Candidacies",
                   (max(e.year * 10 + e.round) / 10)::smallint AS "Year", (max(e.year * 10 + e.round) % 10)::smallint AS "Round"
              FROM electoral.candidacy c
              JOIN electoral.contest k ON k.id = c.contest_id
              JOIN electoral.election e ON e.id = k.election_id
             WHERE c.party_acronym IS NOT NULL
             GROUP BY c.party_acronym
            """).ToListAsync(ct);
        // pleito × UF × cargo com Boletim de Urna importado (vices e suplentes não têm voto próprio)
        var elections = await db.Database.SqlQueryRaw<SearchElectionRow>("""
            SELECT DISTINCT year AS "Year", turn AS "Round", uf::text AS "Uf", office_code AS "OfficeCode"
              FROM electoral.zone_office_totals_current
            """).ToListAsync(ct);
        return new SearchCatalog(territories, parties, elections);
    }
}
