using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.DTOs;

namespace RepBrasil.Application.Politicians.Queries;

public class GetPoliticianByIdQuery
{
    private readonly IPoliticianRepository _repository;

    public GetPoliticianByIdQuery(IPoliticianRepository repository)
    {
        _repository = repository;
    }

    public async Task<PoliticianDetailDto?> ExecuteAsync(Guid id, CancellationToken ct = default)
    {
        var politician = await _repository.GetByIdAsync(id, ct);
        return politician is null ? null : PoliticianDetailDto.FromEntity(politician);
    }
}
