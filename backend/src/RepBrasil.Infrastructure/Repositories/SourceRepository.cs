using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class SourceRepository(ApplicationDbContext db) : ISourceRepository
{
    public async Task<IReadOnlyList<Source>> GetAllAsync(CancellationToken ct = default) =>
        await db.Sources
            .AsNoTracking()
            .OrderBy(s => s.CollectedAt)
            .ToListAsync(ct);
}
