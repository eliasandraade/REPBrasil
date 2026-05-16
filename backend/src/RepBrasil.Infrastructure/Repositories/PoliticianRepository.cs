using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class PoliticianRepository(ApplicationDbContext db) : IPoliticianRepository
{
    public async Task<PagedResult<Politician>> SearchAsync(
        string? query,
        string? state,
        string? party,
        string? office,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var q = db.Politicians.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var escaped = query.Trim()
                .Replace(@"\", @"\\")
                .Replace("%", @"\%")
                .Replace("_", @"\_");
            var pattern = $"%{escaped}%";
            q = q.Where(p =>
                EF.Functions.ILike(p.Name, pattern, @"\") ||
                EF.Functions.ILike(p.BallotName, pattern, @"\"));
        }

        if (!string.IsNullOrWhiteSpace(state))
            q = q.Where(p => p.State != null &&
                EF.Functions.ILike(p.State, state.Trim(), @"\"));

        if (!string.IsNullOrWhiteSpace(party))
            q = q.Where(p => p.PartyAcronym != null &&
                EF.Functions.ILike(p.PartyAcronym, party.Trim(), @"\"));

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
        await db.Politicians.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
}
