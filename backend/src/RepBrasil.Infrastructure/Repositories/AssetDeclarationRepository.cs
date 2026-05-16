using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class AssetDeclarationRepository(ApplicationDbContext db) : IAssetDeclarationRepository
{
    public async Task<IReadOnlyList<AssetDeclaration>> GetByPoliticianIdAsync(
        Guid politicianId,
        CancellationToken ct = default)
    {
        return await db.AssetDeclarations
            .AsNoTracking()
            .Include(d => d.Items)
            .Where(d => d.PoliticianId == politicianId)
            .OrderByDescending(d => d.ElectionYear)
            .ToListAsync(ct);
    }
}
