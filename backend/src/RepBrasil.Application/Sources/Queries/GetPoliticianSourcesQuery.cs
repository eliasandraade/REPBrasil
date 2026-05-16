using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Sources.DTOs;

namespace RepBrasil.Application.Sources.Queries;

// Returns all dataset-level sources currently in the system.
// Every politician's data originates from the same TSE 2024 CSV datasets,
// so sources are not filtered per politician at this stage.
public class GetPoliticianSourcesQuery(ISourceRepository repository)
{
    public async Task<IReadOnlyList<DataSourceDto>> ExecuteAsync(
        CancellationToken ct = default)
    {
        var sources = await repository.GetAllAsync(ct);
        return sources.Select(DataSourceDto.FromEntity).ToList();
    }
}
