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
            WITH latest_source AS (
              SELECT DISTINCT ON (s.indicator_code, s.period)
                     s.id, s.indicator_code, s.period, s.provider, s.dataset, s.retrieved_at
                FROM electoral.socioeconomic_source s
               WHERE s.indicator_code = {0} AND ({1}::int IS NULL OR s.period = {1})
               ORDER BY s.indicator_code, s.period, s.retrieved_at DESC, s.id DESC
            )
            SELECT v.indicator_code AS "IndicatorCode", v.municipality_ibge_code::text AS "MunicipalityIbgeCode",
                   coalesce(m.name, v.municipality_ibge_code::text) AS "MunicipalityName", v.period AS "Period",
                   v.value AS "Value", s.provider AS "Provider", s.dataset AS "Dataset", s.retrieved_at AS "RetrievedAt"
              FROM latest_source s
              JOIN electoral.indicator_value v ON v.source_id = s.id AND v.indicator_code = s.indicator_code AND v.period = s.period
              LEFT JOIN electoral.municipality m ON m.ibge_code::text = v.municipality_ibge_code::text
             WHERE ({2} = '' OR m.state_code = {2})
             ORDER BY v.period DESC, v.value DESC, v.municipality_ibge_code
            """, ct, indicator, periodParameter, uf ?? "");
    }

    public Task<IReadOnlyList<IndicatorValueDto>> StateValuesAsync(string uf, int? period, CancellationToken ct)
    {
        object periodParameter = period.HasValue ? period.Value : DBNull.Value;
        return Query<IndicatorValueDto>("""
            WITH latest_source AS (
              SELECT DISTINCT ON (s.indicator_code, s.period)
                     s.id, s.indicator_code, s.period, s.provider, s.dataset, s.retrieved_at
                FROM electoral.socioeconomic_source s
               WHERE ({0}::int IS NULL OR s.period = {0})
               ORDER BY s.indicator_code, s.period, s.retrieved_at DESC, s.id DESC
            )
            SELECT v.indicator_code AS "IndicatorCode", v.municipality_ibge_code::text AS "MunicipalityIbgeCode",
                   m.name AS "MunicipalityName", v.period AS "Period",
                   v.value AS "Value", s.provider AS "Provider", s.dataset AS "Dataset", s.retrieved_at AS "RetrievedAt"
              FROM latest_source s
              JOIN electoral.indicator_value v ON v.source_id = s.id AND v.indicator_code = s.indicator_code AND v.period = s.period
              JOIN electoral.municipality m ON m.ibge_code::text = v.municipality_ibge_code::text AND m.state_code = {1}
             ORDER BY v.indicator_code, v.period DESC, v.municipality_ibge_code
            """, ct, periodParameter, uf);
    }

    /// <summary>
    /// Cobertura por UF em quatro leituras: catálogo de UFs, indicadores vigentes, pleitos com Boletim de Urna
    /// carregado e anos de emendas da edição vigente. Cada domínio usa a mesma regra de "vigente" das suas telas.
    /// </summary>
    public async Task<CoverageRows> CoverageAsync(CancellationToken ct)
    {
        var states = await Query<CoverageStateRow>("""
            SELECT st.code::text AS "Uf", st.name AS "Name", st.ibge_code AS "IbgeCode",
                   (SELECT count(*)::int FROM electoral.municipality m WHERE m.state_code = st.code) AS "Municipalities"
              FROM electoral.state st
             ORDER BY st.code
            """, ct);
        var indicators = await Query<CoverageIndicatorRow>("""
            WITH latest_source AS (
              SELECT DISTINCT ON (s.indicator_code, s.period) s.id, s.indicator_code, s.period
                FROM electoral.socioeconomic_source s
               ORDER BY s.indicator_code, s.period, s.retrieved_at DESC, s.id DESC
            )
            SELECT m.state_code::text AS "Uf", v.indicator_code AS "Indicator", v.period AS "Period",
                   count(DISTINCT v.municipality_ibge_code)::int AS "Municipalities"
              FROM latest_source s
              JOIN electoral.indicator_value v ON v.source_id = s.id AND v.indicator_code = s.indicator_code AND v.period = s.period
              JOIN electoral.municipality m ON m.ibge_code::text = v.municipality_ibge_code::text
             GROUP BY m.state_code, v.indicator_code, v.period
            """, ct);
        var elections = await Query<CoverageElectionRow>("""
            SELECT f.uf::text AS "Uf", e.year AS "Year", e.round AS "Round",
                   count(DISTINCT r.scope->>'municipality')::int AS "Municipalities"
              FROM electoral.ingestion_run r
              JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
              JOIN electoral.election e ON e.year = f.year AND e.round = f.turn
             WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded'
             GROUP BY f.uf, e.year, e.round
            """, ct);
        var amendments = await Query<CoverageAmendmentRow>(ParliamentSql.CurrentEditions + """
            SELECT e.uf AS "Uf", a.year AS "Year",
                   count(DISTINCT m.ibge_code)::int AS "Municipalities",
                   count(*)::int AS "Amendments"
              FROM electoral.parliament_amendment a
              JOIN current_edition e ON e.id = a.source_id
              LEFT JOIN electoral.municipality m ON m.ibge_code::text = a.municipality_ibge_code AND m.state_code::text = e.uf
             WHERE a.year IS NOT NULL AND e.uf IS NOT NULL
             GROUP BY e.uf, a.year
            """, ct);
        return new CoverageRows(states, indicators, elections, amendments);
    }

    public Task<IReadOnlyList<CorrelationPointDto>> IndicatorPairsAsync(
        string xIndicator, string yIndicator, int period, string? uf, CancellationToken ct) =>
        Query<CorrelationPointDto>("""
            WITH latest_source AS (
              SELECT DISTINCT ON (s.indicator_code) s.id, s.indicator_code
                FROM electoral.socioeconomic_source s
               WHERE s.indicator_code IN ({0}, {1}) AND s.period = {2}
               ORDER BY s.indicator_code, s.retrieved_at DESC, s.id DESC
            ), current_value AS (
              SELECT v.indicator_code, v.municipality_ibge_code, v.value
                FROM latest_source s
                JOIN electoral.indicator_value v ON v.source_id = s.id AND v.indicator_code = s.indicator_code AND v.period = {2}
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
                 AND EXISTS (
                     SELECT 1 FROM electoral.votable_candidacy vc
                      WHERE vc.candidacy_id = c.id AND vc.uf = {4}
                 )
            ) AS "Value"
            """, ct, candidacyId, year, round, office, uf);
        if (match.Count == 0 || !match[0].Value)
            throw new ArgumentException("candidacyId has no auditable vote mapping for the requested election, office and UF");

        return await Query<CorrelationPointDto>("""
            WITH selected AS (
              SELECT c.id, k.scope, k.electoral_unit
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
               WHERE c.id = {1} AND e.year = {2} AND e.round = {3} AND k.office_code = {4}
                 AND (k.uf = {5} OR k.scope = 'federal')
            ), latest_source AS (
              SELECT s.id
                FROM electoral.socioeconomic_source s
               WHERE s.indicator_code = {0} AND s.period = {6}
               ORDER BY s.retrieved_at DESC, s.id DESC
               LIMIT 1
            ), current_x AS (
              SELECT v.municipality_ibge_code, v.value
                FROM latest_source s
                JOIN electoral.indicator_value v ON v.source_id = s.id AND v.indicator_code = {0} AND v.period = {6}
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
