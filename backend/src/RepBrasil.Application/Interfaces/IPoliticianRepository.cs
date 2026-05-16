using RepBrasil.Application.Common;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IPoliticianRepository
{
    Task<PagedResult<Politician>> SearchAsync(
        string? query,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<Politician?> GetByIdAsync(Guid id, CancellationToken ct = default);
}
