using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class ElectionResultRepository : IElectionResultRepository
{
    private readonly ApplicationDbContext _db;

    public ElectionResultRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<ElectionResult>> GetByPoliticianIdAsync(
        Guid politicianId,
        CancellationToken ct = default)
    {
        return await _db.ElectionResults
            .AsNoTracking()
            .Include(r => r.Election)
            .Where(r => r.PoliticianId == politicianId)
            .OrderByDescending(r => r.Election.Year)
            .ThenBy(r => r.Round)
            .ToListAsync(ct);
    }
}
