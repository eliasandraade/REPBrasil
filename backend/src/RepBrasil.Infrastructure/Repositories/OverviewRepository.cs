using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Overview;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>Leituras agregadas e pequenas (visão materializada de totais por zona e o registro de arquivos), em cache por 10 min.</summary>
public class OverviewRepository(ApplicationDbContext db, IMemoryCache cache) : IOverviewRepository
{
    public const string CacheKey = "overview";
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    public async Task<OverviewData> OverviewAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync(CacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = Ttl;
            return await LoadAsync(ct);
        }))!;

    private async Task<OverviewData> LoadAsync(CancellationToken ct)
    {
        var coverage = await db.Database.SqlQueryRaw<CoverageRow>("""
            WITH per_office AS (
              SELECT year, turn, uf, office_code, sum(urns) AS urns, sum(eligible) AS eligible
                FROM electoral.zone_office_totals_current GROUP BY year, turn, uf, office_code
            ), territory AS (
              SELECT year, turn, uf, count(DISTINCT municipality_tse_code) AS municipalities, count(DISTINCT zone) AS zones,
                     string_agg(DISTINCT office_code::text, ',') AS offices
                FROM electoral.zone_office_totals_current GROUP BY year, turn, uf
            )
            SELECT t.year AS "Year", t.turn AS "Round", t.uf::text AS "Uf", s.name AS "StateName",
                   t.municipalities::int AS "Municipalities", t.zones::int AS "Zones",
                   (SELECT max(o.urns) FROM per_office o WHERE (o.year, o.turn, o.uf) = (t.year, t.turn, t.uf))::int AS "Sections",
                   (SELECT max(o.eligible) FROM per_office o WHERE (o.year, o.turn, o.uf) = (t.year, t.turn, t.uf))::bigint AS "Eligible",
                   t.offices AS "Offices"
              FROM territory t
              LEFT JOIN electoral.state s ON s.code = t.uf
            """).ToListAsync(ct);
        var sources = await db.Database.SqlQueryRaw<SourceKindRow>("""
            SELECT kind AS "Kind", count(*)::int AS "Files", max(downloaded_at) AS "LatestDownload"
              FROM electoral.open_data_source_file
             GROUP BY kind
            """).ToListAsync(ct);
        var totals = await db.Database.SqlQueryRaw<OverviewTotalsRow>("""
            SELECT (SELECT count(*) FROM electoral.candidacy)::int AS "Candidacies",
                   (SELECT count(*) FROM public."Politicians" WHERE "DeletedAt" IS NULL)::int AS "Politicians",
                   (SELECT max(finished_at) FROM electoral.ingestion_run WHERE status = 'succeeded') AS "LatestImport"
            """).SingleAsync(ct);
        return new OverviewData(coverage, sources, totals);
    }
}
