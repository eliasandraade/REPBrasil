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
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var q = db.Politicians.AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = $"%{query.Trim()}%";
            q = q.Where(p =>
                EF.Functions.ILike(p.Name, pattern) ||
                EF.Functions.ILike(p.BallotName, pattern));
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
        await db.Politicians.FirstOrDefaultAsync(p => p.Id == id, ct);
}
