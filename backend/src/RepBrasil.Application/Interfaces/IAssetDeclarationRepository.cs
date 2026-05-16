using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IAssetDeclarationRepository
{
    Task<IReadOnlyList<AssetDeclaration>> GetByPoliticianIdAsync(
        Guid politicianId,
        CancellationToken ct = default);
}
