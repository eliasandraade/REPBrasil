using RepBrasil.Application.ElectionResults.DTOs;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.ElectionResults.Queries;

public class GetPoliticianElectionsQuery(IElectionResultRepository repository)
{
    public async Task<IReadOnlyList<ElectionResultDto>> ExecuteAsync(
        Guid politicianId,
        CancellationToken ct = default)
    {
        var results = await repository.GetByPoliticianIdAsync(politicianId, ct);
        return results
            .Select(r => ElectionResultDto.FromEntities(r, r.Election
                ?? throw new InvalidOperationException(
                    $"ElectionResult {r.Id} has no loaded Election navigation.")))
            .ToList();
    }
}
