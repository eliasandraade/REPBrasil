using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
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
}
