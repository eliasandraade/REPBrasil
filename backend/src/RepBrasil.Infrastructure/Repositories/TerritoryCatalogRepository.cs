using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Territories;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class TerritoryCatalogRepository(ApplicationDbContext db) : ITerritoryCatalogRepository
{
    public async Task<IReadOnlyList<TerritoryStateDto>> StatesAsync(CancellationToken ct) =>
        await db.Database.SqlQueryRaw<TerritoryStateDto>("""
            SELECT s.code::text AS "Code", s.name AS "Name", s.ibge_code AS "IbgeCode",
                   (SELECT count(*)::int FROM electoral.municipality m WHERE m.state_code = s.code AND m.ibge_code IS NOT NULL) AS "Municipalities"
              FROM electoral.state s
             ORDER BY s.name
            """).ToListAsync(ct);

    public async Task<IReadOnlyList<TerritoryMunicipalityDto>> MunicipalitiesAsync(string uf, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<TerritoryMunicipalityDto>("""
            SELECT lpad(m.ibge_code::text, 7, '0') AS "IbgeCode", m.name AS "Name", m.slug AS "Slug",
                   m.tse_code::text AS "TseCode", m.state_code::text AS "StateCode"
              FROM electoral.municipality m
             WHERE m.state_code = {0} AND m.ibge_code IS NOT NULL
             ORDER BY m.name
            """, uf).ToListAsync(ct);

    public async Task<TerritoryMunicipalityDto?> MunicipalityAsync(string uf, string ibgeCode, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<TerritoryMunicipalityDto>("""
            SELECT lpad(m.ibge_code::text, 7, '0') AS "IbgeCode", m.name AS "Name", m.slug AS "Slug",
                   m.tse_code::text AS "TseCode", m.state_code::text AS "StateCode"
              FROM electoral.municipality m
             WHERE m.state_code = {0} AND m.ibge_code = {1}
             LIMIT 1
            """, uf, int.Parse(ibgeCode, System.Globalization.CultureInfo.InvariantCulture)).ToListAsync(ct)).FirstOrDefault();
}
