using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IElectionResultRepository
{
    Task<IReadOnlyList<ElectionResult>> GetByPoliticianIdAsync(
        Guid politicianId,
        CancellationToken ct = default);
}
