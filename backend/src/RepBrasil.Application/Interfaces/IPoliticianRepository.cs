using RepBrasil.Application.Common;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IPoliticianRepository
{
    Task<PagedResult<Politician>> SearchAsync(
        string? query,
        string? state,
        string? party,
        string? office,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<Politician?> GetByIdAsync(Guid id, CancellationToken ct = default);

    Task<Politician?> GetBySlugAsync(string slug, CancellationToken ct = default);

    /// <summary>Candidatura mais recente na camada eleitoral (a própria antes da de vice/suplente na mesma eleição).</summary>
    Task<RepBrasil.Application.Politicians.DTOs.LatestCandidacyRow?> LatestCandidacyAsync(Guid politicianId, CancellationToken ct = default);

    /// <summary>Endereços públicos de todos os políticos (sitemap): slug e última atualização.</summary>
    Task<IReadOnlyList<(string Slug, DateTime UpdatedAt)>> SlugsAsync(CancellationToken ct = default);
}
