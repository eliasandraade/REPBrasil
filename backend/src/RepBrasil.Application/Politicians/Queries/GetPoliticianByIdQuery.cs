using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Search;

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
        return politician is null ? null : await WithLatestAsync(PoliticianDetailDto.FromEntity(politician), ct);
    }

    /// <summary>Slug normalizado como o banco o gera (minúsculas, [a-z0-9-]); fora disso não existe.</summary>
    public async Task<PoliticianDetailDto?> BySlugAsync(string slug, CancellationToken ct = default)
    {
        var normalized = (slug ?? "").Trim().ToLowerInvariant();
        if (normalized.Length is 0 or > 120 || !normalized.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-'))
            return null;
        var politician = await _repository.GetBySlugAsync(normalized, ct);
        return politician is null ? null : await WithLatestAsync(PoliticianDetailDto.FromEntity(politician), ct);
    }

    private async Task<PoliticianDetailDto> WithLatestAsync(PoliticianDetailDto dto, CancellationToken ct)
    {
        var c = await _repository.LatestCandidacyAsync(dto.Id, ct);
        if (c is null) return dto;
        var office = SearchService.OfficeNames.TryGetValue(c.OfficeCode, out var name) ? name : Fmt.Name(c.OfficeName);
        return dto with
        {
            LatestCandidacy = new LatestCandidacyDto(c.Year, c.Round, c.OfficeCode, office, c.UnitName, c.Uf?.Trim(), c.Party, c.Outcome, c.Elected),
        };
    }

    public Task<IReadOnlyList<(string Slug, DateTime UpdatedAt)>> SlugsAsync(CancellationToken ct = default) =>
        _repository.SlugsAsync(ct);
}
