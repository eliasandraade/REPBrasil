using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Search;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class PoliticianRepository : IPoliticianRepository
{
    private readonly ApplicationDbContext _db;

    public PoliticianRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<PagedResult<Politician>> SearchAsync(
        string? query,
        string? state,
        string? party,
        string? office,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        // nome sem acento e por início de palavra ("andre moura" acha "André Fernandes de Moura"), pelo índice de trigramas
        var terms = SearchService.NameTerms(query);
        IQueryable<Politician> q;
        if (terms.Count > 0)
        {
            // o texto do SQL só ganha nomes de parâmetro (@t0, @t1…); os termos vão como valores
            var parameters = new List<object>();
            var sql = $"""SELECT p.* FROM public."Politicians" p WHERE p."DeletedAt" IS NULL{PoliticianNameMatch.Conditions(terms, parameters)}""";
            q = _db.Politicians.FromSqlRaw(sql, parameters.ToArray());
        }
        else
        {
            q = _db.Politicians;
        }
        q = q.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(state))
            q = q.Where(p => p.State != null &&
                EF.Functions.ILike(p.State, state.Trim(), @"\"));

        // a mesma sigla com outra grafia no TSE ("PC do B" e "PCDOB") é o mesmo partido; sem curinga de LIKE
        if (!string.IsNullOrWhiteSpace(party))
        {
            var compact = party.Replace(" ", "", StringComparison.Ordinal).ToLowerInvariant();
            q = q.Where(p => p.PartyAcronym != null && p.PartyAcronym.Replace(" ", "").ToLower() == compact);
        }

        if (!string.IsNullOrWhiteSpace(office))
        {
            var escaped = office.Trim()
                .Replace(@"\", @"\\")
                .Replace("%", @"\%")
                .Replace("_", @"\_");
            var pattern = $"%{escaped}%";
            q = q.Where(p => p.Office != null &&
                EF.Functions.ILike(p.Office, pattern, @"\"));
        }

        var total = await q.CountAsync(ct);
        var items = await q
            .OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return new PagedResult<Politician>(items, total, page, pageSize);
    }

    public async Task<Politician?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        await _db.Politicians.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);

    public async Task<Politician?> GetBySlugAsync(string slug, CancellationToken ct = default) =>
        await _db.Politicians.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug, ct);

    public async Task<LatestCandidacyRow?> LatestCandidacyAsync(Guid politicianId, CancellationToken ct = default) =>
        (await _db.Database.SqlQueryRaw<LatestCandidacyRow>("""
            SELECT e.year AS "Year", e.round AS "Round", k.office_code AS "OfficeCode", k.office_name AS "OfficeName",
                   CASE k.scope WHEN 'federal' THEN 'Brasil' WHEN 'state' THEN st.name ELSE mu.name END AS "UnitName",
                   k.uf::text AS "Uf", c.party_acronym AS "Party", c.round_outcome AS "Outcome", c.elected AS "Elected"
              FROM electoral.candidacy c
              JOIN electoral.contest k ON k.id = c.contest_id
              JOIN electoral.election e ON e.id = k.election_id
              LEFT JOIN electoral.state st ON st.code = k.uf
              LEFT JOIN electoral.municipality mu ON k.scope = 'municipal' AND mu.state_code = k.uf AND mu.tse_code = k.electoral_unit
             WHERE c.politician_id = {0}
             ORDER BY e.year DESC, e.round DESC, (k.office_code IN (2, 4, 9, 10, 12)), k.office_code
             LIMIT 1
            """, politicianId).ToListAsync(ct)).FirstOrDefault();

    public async Task<IReadOnlyList<(string Slug, DateTime UpdatedAt)>> SlugsAsync(CancellationToken ct = default) =>
        (await _db.Politicians.AsNoTracking()
            .Where(p => p.Slug != null)
            .OrderBy(p => p.Slug)
            .Select(p => new { p.Slug, p.UpdatedAt })
            .ToListAsync(ct))
        .Select(p => (p.Slug!, p.UpdatedAt))
        .ToList();
}
