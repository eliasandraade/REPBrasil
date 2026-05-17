using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Sources.DTOs;

namespace RepBrasil.Application.Sources.Queries;

// Returns all dataset-level sources currently in the system.
// Every politician's data originates from the same TSE 2024 CSV datasets,
// so sources are not filtered per politician at this stage.
public class GetPoliticianSourcesQuery
{
    private readonly ISourceRepository _repository;

    public GetPoliticianSourcesQuery(ISourceRepository repository)
    {
        _repository = repository;
    }

    public async Task<IReadOnlyList<DataSourceDto>> ExecuteAsync(
        CancellationToken ct = default)
    {
        var sources = await _repository.GetAllAsync(ct);
        return sources.Select(DataSourceDto.FromEntity).ToList();
    }
}
