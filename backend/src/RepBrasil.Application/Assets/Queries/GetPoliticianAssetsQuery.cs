using RepBrasil.Application.Assets.DTOs;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Assets.Queries;

public class GetPoliticianAssetsQuery(IAssetDeclarationRepository repository)
{
    public async Task<IReadOnlyList<AssetDeclarationDto>> ExecuteAsync(
        Guid politicianId,
        CancellationToken ct = default)
    {
        var declarations = await repository.GetByPoliticianIdAsync(politicianId, ct);
        return declarations
            .OrderByDescending(d => d.ElectionYear)
            .Select(AssetDeclarationDto.FromEntity)
            .ToList();
    }
}
