using RepBrasil.Application.Assets.DTOs;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Assets.Queries;

public class GetPoliticianAssetsQuery
{
    private readonly IAssetDeclarationRepository _repository;

    public GetPoliticianAssetsQuery(IAssetDeclarationRepository repository)
    {
        _repository = repository;
    }

    public async Task<IReadOnlyList<AssetDeclarationDto>> ExecuteAsync(
        Guid politicianId,
        CancellationToken ct = default)
    {
        var declarations = await _repository.GetByPoliticianIdAsync(politicianId, ct);
        return declarations
            .OrderByDescending(d => d.ElectionYear)
            .Select(AssetDeclarationDto.FromEntity)
            .ToList();
    }
}
