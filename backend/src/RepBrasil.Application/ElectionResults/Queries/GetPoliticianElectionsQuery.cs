using RepBrasil.Application.ElectionResults.DTOs;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.ElectionResults.Queries;

public class GetPoliticianElectionsQuery
{
    private readonly IElectionResultRepository _repository;

    public GetPoliticianElectionsQuery(IElectionResultRepository repository)
    {
        _repository = repository;
    }

    public async Task<IReadOnlyList<ElectionResultDto>> ExecuteAsync(
        Guid politicianId,
        CancellationToken ct = default)
    {
        var results = await _repository.GetByPoliticianIdAsync(politicianId, ct);
        return results
            .Select(r => ElectionResultDto.FromEntities(r, r.Election
                ?? throw new InvalidOperationException(
                    $"ElectionResult {r.Id} has no loaded Election navigation.")))
            .ToList();
    }
}
