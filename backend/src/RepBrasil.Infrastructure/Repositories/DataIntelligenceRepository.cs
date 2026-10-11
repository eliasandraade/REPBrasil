using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.DataIntelligence;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class DataIntelligenceRepository(ApplicationDbContext db) : IDataIntelligenceRepository
{
    private async Task<IReadOnlyList<T>> Query<T>(string sql, CancellationToken ct, params object[] parameters) =>
        await db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync(ct);

    public Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct) =>
        Query<IndicatorDto>("""
            SELECT i.code AS "Code", i.name AS "Name", i.unit AS "Unit", i.provider AS "Provider",
                   i.description AS "Description", i.derived AS "Derived"
              FROM electoral.indicator i
             ORDER BY i.provider, i.name, i.code
            """, ct);

    public Task<IReadOnlyList<IndicatorValueDto>> ValuesAsync(string indicator, int? period, string? uf, CancellationToken ct)
    {
        object periodParameter = period.HasValue ? period.Value : DBNull.Value;
        return Query<IndicatorValueDto>("""
            WITH current_value AS (
              SELECT DISTINCT ON (v.indicator_code, v.municipality_ibge_code, v.period)
                     v.indicator_code, v.municipality_ibge_code, v.period, v.value,
                     s.provider, s.dataset, s.retrieved_at
                FROM electoral.indicator_value v
                JOIN electoral.socioeconomic_source s ON s.id = v.source_id
               WHERE v.indicator_code = {0} AND ({1}::int IS NULL OR v.period = {1})
               ORDER BY v.indicator_code, v.municipality_ibge_code, v.period, s.retrieved_at DESC, s.id DESC
            )
            SELECT c.indicator_code AS "IndicatorCode", c.municipality_ibge_code::text AS "MunicipalityIbgeCode",
                   coalesce(m.name, c.municipality_ibge_code::text) AS "MunicipalityName", c.period AS "Period",
                   c.value AS "Value", c.provider AS "Provider", c.dataset AS "Dataset", c.retrieved_at AS "RetrievedAt"
              FROM current_value c
              LEFT JOIN electoral.municipality m ON m.ibge_code::text = c.municipality_ibge_code::text
             WHERE ({2} = '' OR m.state_code = {2})
             ORDER BY c.period DESC, c.value DESC, c.municipality_ibge_code
            """, ct, indicator, periodParameter, uf ?? "");
    }

    public Task<IReadOnlyList<CorrelationPointDto>> IndicatorPairsAsync(
        string xIndicator, string yIndicator, int period, string? uf, CancellationToken ct) =>
        Query<CorrelationPointDto>("""
            WITH current_value AS (
              SELECT DISTINCT ON (v.indicator_code, v.municipality_ibge_code, v.period)
                     v.indicator_code, v.municipality_ibge_code, v.period, v.value
                FROM electoral.indicator_value v
                JOIN electoral.socioeconomic_source s ON s.id = v.source_id
               WHERE v.indicator_code IN ({0}, {1}) AND v.period = {2}
               ORDER BY v.indicator_code, v.municipality_ibge_code, v.period, s.retrieved_at DESC, s.id DESC
            ), x AS (
              SELECT municipality_ibge_code, value FROM current_value WHERE indicator_code = {0}
            ), y AS (
              SELECT municipality_ibge_code, value FROM current_value WHERE indicator_code = {1}
            )
            SELECT x.municipality_ibge_code::text AS "MunicipalityIbgeCode",
                   coalesce(m.name, x.municipality_ibge_code::text) AS "MunicipalityName",
                   x.value::double precision AS "X", y.value::double precision AS "Y"
              FROM x JOIN y USING (municipality_ibge_code)
              LEFT JOIN electoral.municipality m ON m.ibge_code::text = x.municipality_ibge_code::text
             WHERE ({3} = '' OR m.state_code = {3})
             ORDER BY x.municipality_ibge_code
            """, ct, xIndicator, yIndicator, period, uf ?? "");

    public async Task<IReadOnlyList<CorrelationPointDto>> CandidacySharePairsAsync(
        string xIndicator,
        Guid candidacyId,
        int period,
        string uf,
        int year,
        int round,
        int office,
        CancellationToken ct)
    {
        var match = await Query<FlagRow>("""
            SELECT EXISTS (
              SELECT 1
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
               WHERE c.id = {0} AND e.year = {1} AND e.round = {2} AND k.office_code = {3}
                 AND (k.uf = {4} OR k.scope = 'federal')
            ) AS "Value"
            """, ct, candidacyId, year, round, office, uf);
        if (match.Count == 0 || !match[0].Value)
            throw new ArgumentException("candidacyId does not belong to the requested election, office and UF");

        return await Query<CorrelationPointDto>("""
            WITH selected AS (
              SELECT c.id, k.scope, k.electoral_unit
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
               WHERE c.id = {1} AND e.year = {2} AND e.round = {3} AND k.office_code = {4}
                 AND (k.uf = {5} OR k.scope = 'federal')
            ), current_x AS (
              SELECT DISTINCT ON (v.municipality_ibge_code)
                     v.municipality_ibge_code, v.value
                FROM electoral.indicator_value v
                JOIN electoral.socioeconomic_source s ON s.id = v.source_id
               WHERE v.indicator_code = {0} AND v.period = {6}
               ORDER BY v.municipality_ibge_code, s.retrieved_at DESC, s.id DESC
            ), valid AS (
              SELECT z.municipality_tse_code, sum(z.nominal_votes + z.legend_votes)::bigint AS valid_votes
                FROM electoral.zone_office_totals_current z
                CROSS JOIN selected s
               WHERE z.uf = {5} AND z.year = {2} AND z.turn = {3} AND z.office_code = {4}
                 AND (s.scope <> 'municipal' OR z.municipality_tse_code = s.electoral_unit)
               GROUP BY z.municipality_tse_code
            ), votes AS (
              SELECT m.municipality_tse_code, sum(m.votes)::bigint AS votes
                FROM selected s
                JOIN electoral.votable_candidacy vc ON vc.candidacy_id = s.id AND vc.uf = {5}
                JOIN electoral.votable_zone_votes_current m
                  ON m.votable_id = vc.votable_id AND m.uf = vc.uf AND m.year = {2} AND m.turn = {3} AND m.office_code = {4}
               GROUP BY m.municipality_tse_code
            )
            SELECT x.municipality_ibge_code::text AS "MunicipalityIbgeCode", mu.name AS "MunicipalityName",
                   x.value::double precision AS "X",
                   (100.0 * coalesce(votes.votes, 0) / valid.valid_votes)::double precision AS "Y"
              FROM current_x x
              JOIN electoral.municipality mu ON mu.ibge_code::text = x.municipality_ibge_code::text AND mu.state_code = {5}
              JOIN valid ON valid.municipality_tse_code = mu.tse_code AND valid.valid_votes > 0
              LEFT JOIN votes ON votes.municipality_tse_code = valid.municipality_tse_code
             ORDER BY x.municipality_ibge_code
            """, ct, xIndicator, candidacyId, year, round, office, uf, period);
    }

    private sealed record FlagRow(bool Value);
}
