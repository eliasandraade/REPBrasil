using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class ScoreRepository : IScoreRepository
{
    private readonly ApplicationDbContext _db;

    public ScoreRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<ScoreSnapshot?> GetCurrentAsync(Guid politicianId, CancellationToken ct = default) =>
        await _db.ScoreSnapshots
            .Include(s => s.Factors)
            .Where(s => s.PoliticianId == politicianId)
            .OrderByDescending(s => s.CalculatedAt)
            .AsNoTracking()
            .FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<ScoreSnapshot>> GetHistoryAsync(Guid politicianId, CancellationToken ct = default)
    {
        // Factors intentionally not included — history items are summary rows only (no per-factor breakdown in v0).
        return await _db.ScoreSnapshots
            .Where(s => s.PoliticianId == politicianId)
            .OrderByDescending(s => s.CalculatedAt)
            .AsNoTracking()
            .ToListAsync(ct);
    }
}
