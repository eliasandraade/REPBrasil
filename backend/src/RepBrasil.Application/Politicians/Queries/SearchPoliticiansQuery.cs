using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.DTOs;

namespace RepBrasil.Application.Politicians.Queries;

public class SearchPoliticiansQuery(IPoliticianRepository repository)
{
    public async Task<PagedResult<PoliticianSummaryDto>> ExecuteAsync(
        string? query,
        int page = 1,
        int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var result = await repository.SearchAsync(query, page, pageSize, ct);
        var dtos = result.Items.Select(PoliticianSummaryDto.FromEntity).ToList();
        return new PagedResult<PoliticianSummaryDto>(dtos, result.TotalCount, page, pageSize);
    }
}
