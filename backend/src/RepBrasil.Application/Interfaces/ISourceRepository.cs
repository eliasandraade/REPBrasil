using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface ISourceRepository
{
    Task<IReadOnlyList<Source>> GetAllAsync(CancellationToken ct = default);
}
