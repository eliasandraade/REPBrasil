using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IScoreRepository
{
    Task<ScoreSnapshot?> GetCurrentAsync(Guid politicianId, CancellationToken ct = default);
    Task<IReadOnlyList<ScoreSnapshot>> GetHistoryAsync(Guid politicianId, CancellationToken ct = default);
}
