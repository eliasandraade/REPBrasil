namespace RepBrasil.Application.Parliament;

public sealed record ParliamentMemberDto(
    long Id,
    string Institution,
    string ExternalId,
    string Name,
    string? ParliamentaryName,
    string? StateCode,
    string? PartyAcronym,
    string? PhotoUrl,
    string IdentityMethod,
    string Provider,
    string Dataset,
    string SourceUrl,
    DateTimeOffset RetrievedAt);

public sealed record ParliamentActivityDto(
    long Id,
    long MemberId,
    string Institution,
    string ActivityType,
    string ExternalId,
    DateTimeOffset? OccurredAt,
    string? Title,
    string? Description,
    string? SourceUrl,
    string Provider,
    string Dataset,
    string DatasetSourceUrl,
    DateTimeOffset RetrievedAt);

public sealed record ParliamentAmendmentDto(
    long Id,
    string ExternalId,
    long? AuthorMemberId,
    string? AuthorName,
    int? Year,
    string? AmendmentType,
    string? FunctionalProgramming,
    string? BeneficiaryDocument,
    string? BeneficiaryName,
    string? Locality,
    string? MunicipalityIbgeCode,
    decimal? CommittedAmount,
    decimal? PaidAmount,
    string Provider,
    string Dataset,
    string SourceUrl,
    DateTimeOffset RetrievedAt);

/// <summary>
/// Somas por município sobre a edição vigente. Valor ausente não entra como zero: as somas cobrem só
/// os valores publicados, e *Missing conta as emendas sem valor (soma parcial quando &gt; 0).
/// </summary>
public sealed record AmendmentMunicipalityDto(
    string MunicipalityIbgeCode,
    string MunicipalityName,
    int AmendmentCount,
    decimal? CommittedAmount,
    int CommittedAmountMissing,
    decimal? PaidAmount,
    int PaidAmountMissing,
    DateTimeOffset RetrievedAt);

/// <summary>Linha da série anual do mapa de emendas (mesmas somas de <see cref="AmendmentMunicipalityDto"/>, por ano).</summary>
public sealed record AmendmentSeriesRow(
    int Year,
    string MunicipalityIbgeCode,
    string MunicipalityName,
    int AmendmentCount,
    decimal? CommittedAmount,
    int CommittedAmountMissing,
    decimal? PaidAmount,
    int PaidAmountMissing,
    DateTimeOffset RetrievedAt);

public sealed record AmendmentSeriesYearDto(int Year, IReadOnlyList<AmendmentMunicipalityDto> Municipalities);

/// <summary>Mapa de emendas da UF, ano a ano, numa consulta (linha do tempo).</summary>
public sealed record AmendmentMapSeriesResponse(string Uf, IReadOnlyList<AmendmentSeriesYearDto> Years);

/// <summary>Total de atos do recorte, independente do limite da listagem.</summary>
public sealed record ParliamentActivityTotalDto(int Total);

public interface IParliamentRepository
{
    Task<IReadOnlyList<ParliamentMemberDto>> MembersAsync(string? uf, string? institution, CancellationToken ct);
    Task<IReadOnlyList<ParliamentActivityDto>> ActivitiesAsync(long? memberId, string? institution, string? uf, int limit, CancellationToken ct);
    Task<int> ActivityTotalAsync(long? memberId, string? institution, string? uf, CancellationToken ct);
    Task<IReadOnlyList<ParliamentAmendmentDto>> AmendmentsAsync(int? year, long? memberId, string? uf, int limit, CancellationToken ct);
    Task<IReadOnlyList<int>> AmendmentYearsAsync(string? uf, CancellationToken ct);
    Task<IReadOnlyList<AmendmentMunicipalityDto>> AmendmentMapAsync(int? year, string uf, CancellationToken ct);
    Task<IReadOnlyList<AmendmentSeriesRow>> AmendmentMapSeriesAsync(string uf, CancellationToken ct);
}

public sealed class ParliamentService(IParliamentRepository repository)
{
    private static readonly HashSet<string> Institutions = new(StringComparer.OrdinalIgnoreCase) { "camara", "senado", "alece" };

    public Task<IReadOnlyList<ParliamentMemberDto>> MembersAsync(string? uf, string? institution, CancellationToken ct) =>
        repository.MembersAsync(NormalizeUf(uf), NormalizeInstitution(institution), ct);

    public Task<IReadOnlyList<ParliamentActivityDto>> ActivitiesAsync(long? memberId, string? institution, string? uf, int limit, CancellationToken ct)
    {
        if (memberId is <= 0) throw new ArgumentOutOfRangeException(nameof(memberId));
        return repository.ActivitiesAsync(memberId, NormalizeInstitution(institution), NormalizeUf(uf), NormalizeLimit(limit), ct);
    }

    public async Task<ParliamentActivityTotalDto> ActivityTotalAsync(long? memberId, string? institution, string? uf, CancellationToken ct)
    {
        if (memberId is <= 0) throw new ArgumentOutOfRangeException(nameof(memberId));
        return new ParliamentActivityTotalDto(
            await repository.ActivityTotalAsync(memberId, NormalizeInstitution(institution), NormalizeUf(uf), ct));
    }

    public Task<IReadOnlyList<ParliamentAmendmentDto>> AmendmentsAsync(int? year, long? memberId, string? uf, int limit, CancellationToken ct)
    {
        ValidateYear(year);
        if (memberId is <= 0) throw new ArgumentOutOfRangeException(nameof(memberId));
        return repository.AmendmentsAsync(year, memberId, NormalizeUf(uf), NormalizeLimit(limit), ct);
    }

    public Task<IReadOnlyList<int>> AmendmentYearsAsync(string? uf, CancellationToken ct) =>
        repository.AmendmentYearsAsync(NormalizeUf(uf), ct);

    public Task<IReadOnlyList<AmendmentMunicipalityDto>> AmendmentMapAsync(int? year, string uf, CancellationToken ct)
    {
        ValidateYear(year);
        return repository.AmendmentMapAsync(year, NormalizeUf(uf) ?? throw new ArgumentException("uf is required", nameof(uf)), ct);
    }

    public async Task<AmendmentMapSeriesResponse> AmendmentMapSeriesAsync(string? uf, CancellationToken ct)
    {
        var state = NormalizeUf(uf) ?? throw new ArgumentException("uf is required", nameof(uf));
        var rows = await repository.AmendmentMapSeriesAsync(state, ct);
        return new AmendmentMapSeriesResponse(
            state,
            rows.GroupBy(r => r.Year)
                .OrderBy(g => g.Key)
                .Select(g => new AmendmentSeriesYearDto(g.Key, g
                    .Select(r => new AmendmentMunicipalityDto(
                        r.MunicipalityIbgeCode, r.MunicipalityName, r.AmendmentCount, r.CommittedAmount,
                        r.CommittedAmountMissing, r.PaidAmount, r.PaidAmountMissing, r.RetrievedAt))
                    .ToList()))
                .ToList());
    }

    private static int NormalizeLimit(int limit) => limit is >= 1 and <= 200 ? limit : throw new ArgumentOutOfRangeException(nameof(limit), "limit must be between 1 and 200");

    private static void ValidateYear(int? year)
    {
        if (year is < 1988 or > 2200) throw new ArgumentOutOfRangeException(nameof(year));
    }

    private static string? NormalizeUf(string? uf)
    {
        if (string.IsNullOrWhiteSpace(uf)) return null;
        var normalized = uf.Trim().ToUpperInvariant();
        if (normalized.Length != 2 || normalized.Any(c => c is < 'A' or > 'Z'))
            throw new ArgumentException("uf must be a two-letter state code", nameof(uf));
        return normalized;
    }

    private static string? NormalizeInstitution(string? institution)
    {
        if (string.IsNullOrWhiteSpace(institution)) return null;
        var normalized = institution.Trim().ToLowerInvariant();
        if (!Institutions.Contains(normalized))
            throw new ArgumentException("institution must be camara, senado or alece", nameof(institution));
        return normalized;
    }
}
