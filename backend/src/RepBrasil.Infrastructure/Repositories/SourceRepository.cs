using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class SourceRepository : ISourceRepository
{
    private readonly ApplicationDbContext _db;

    public SourceRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<Source>> GetAllAsync(CancellationToken ct = default) =>
        await _db.Sources
            .AsNoTracking()
            .OrderBy(s => s.CollectedAt)
            .ToListAsync(ct);
}
