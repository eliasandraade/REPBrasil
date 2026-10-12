namespace RepBrasil.Application.ElectoralLive;

public sealed record PollOptionDto(
    int Order,
    string Label,
    string Kind,
    Guid? CandidacyId,
    string? PartyAcronym,
    decimal? Percentage);

public sealed record PollScenarioDto(
    string Name,
    int Order,
    IReadOnlyList<PollOptionDto> Options);

public sealed record PollDto(
    Guid Id,
    string RegistrationNumber,
    string Institute,
    DateOnly FieldStart,
    DateOnly FieldEnd,
    DateTimeOffset? PublishedAt,
    int? SampleSize,
    decimal? MarginErrorPp,
    decimal? ConfidenceLevel,
    string? Methodology,
    string SourceUrl,
    DateTimeOffset RetrievedAt,
    IReadOnlyList<PollScenarioDto> Scenarios);

public sealed record PollsResponse(
    int Year,
    int Round,
    int Office,
    string? Uf,
    string? MunicipalityTseCode,
    IReadOnlyList<PollDto> Polls,
    string Methodology,
    string Caveat);

public sealed record LiveCountItemDto(
    int Position,
    Guid? CandidacyId,
    int? CandidateNumber,
    string Label,
    string? PartyAcronym,
    long? Votes,
    decimal? Percentage,
    string? ResultStatus);

public sealed record LiveCountDto(
    Guid SnapshotId,
    string Scope,
    string Status,
    int? CountedSections,
    int? TotalSections,
    decimal? CountedPercent,
    DateTimeOffset CapturedAt,
    DateTimeOffset? TseGeneratedAt,
    string SourceUrl,
    IReadOnlyList<LiveCountItemDto> Results);

public sealed record LiveCountResponse(
    int Year,
    int Round,
    int Office,
    string? Uf,
    string? MunicipalityTseCode,
    LiveCountDto? Snapshot,
    string Methodology,
    string Caveat);

public sealed record PollRow(
    Guid PollId,
    string RegistrationNumber,
    string Institute,
    DateOnly FieldStart,
    DateOnly FieldEnd,
    DateTimeOffset? PublishedAt,
    int? SampleSize,
    decimal? MarginErrorPp,
    decimal? ConfidenceLevel,
    string? Methodology,
    string SourceUrl,
    DateTimeOffset RetrievedAt,
    Guid ScenarioId,
    string ScenarioName,
    int ScenarioOrder,
    int OptionOrder,
    string OptionLabel,
    string OptionKind,
    Guid? CandidacyId,
    string? PartyAcronym,
    decimal? Percentage);

public sealed record LiveCountRow(
    Guid SnapshotId,
    string Scope,
    string Status,
    int? CountedSections,
    int? TotalSections,
    decimal? CountedPercent,
    DateTimeOffset CapturedAt,
    DateTimeOffset? TseGeneratedAt,
    string SourceUrl,
    int? Position,
    Guid? CandidacyId,
    int? CandidateNumber,
    string? OptionLabel,
    string? PartyAcronym,
    long? Votes,
    decimal? Percentage,
    string? ResultStatus);

public interface IElectoralLiveRepository
{
    Task<IReadOnlyList<PollRow>> PollsAsync(
        int year,
        int round,
        int office,
        string? uf,
        string? municipalityTseCode,
        CancellationToken ct);

    Task<IReadOnlyList<LiveCountRow>> LatestLiveCountAsync(
        int year,
        int round,
        int office,
        string scope,
        string? uf,
        string? municipalityTseCode,
        CancellationToken ct);
}

public sealed class ElectoralLiveService(IElectoralLiveRepository repository)
{
    public async Task<PollsResponse> PollsAsync(
        int year,
        int round,
        int office,
        string? uf,
        string? municipalityTseCode,
        CancellationToken ct)
    {
        ValidateElection(year, round, office);
        var normalizedUf = NormalizeUf(uf);
        var municipality = NormalizeMunicipality(municipalityTseCode);
        if (municipality is not null && normalizedUf is null)
            throw new ArgumentException("municipalityTseCode requires uf");

        var rows = await repository.PollsAsync(year, round, office, normalizedUf, municipality, ct);
        var polls = rows
            .GroupBy(r => new
            {
                r.PollId,
                r.RegistrationNumber,
                r.Institute,
                r.FieldStart,
                r.FieldEnd,
                r.PublishedAt,
                r.SampleSize,
                r.MarginErrorPp,
                r.ConfidenceLevel,
                r.Methodology,
                r.SourceUrl,
                r.RetrievedAt,
            })
            .Select(group => new PollDto(
                group.Key.PollId,
                group.Key.RegistrationNumber,
                group.Key.Institute,
                group.Key.FieldStart,
                group.Key.FieldEnd,
                group.Key.PublishedAt,
                group.Key.SampleSize,
                group.Key.MarginErrorPp,
                group.Key.ConfidenceLevel,
                group.Key.Methodology,
                group.Key.SourceUrl,
                group.Key.RetrievedAt,
                group.GroupBy(r => new { r.ScenarioId, r.ScenarioName, r.ScenarioOrder })
                    .OrderBy(s => s.Key.ScenarioOrder)
                    .Select(s => new PollScenarioDto(
                        s.Key.ScenarioName,
                        s.Key.ScenarioOrder,
                        s.OrderBy(o => o.OptionOrder)
                            .Select(o => new PollOptionDto(
                                o.OptionOrder,
                                o.OptionLabel,
                                o.OptionKind,
                                o.CandidacyId,
                                o.PartyAcronym,
                                o.Percentage))
                            .ToArray()))
                    .ToArray()))
            .OrderByDescending(p => p.FieldEnd)
            .ThenByDescending(p => p.PublishedAt)
            .ThenBy(p => p.RegistrationNumber, StringComparer.Ordinal)
            .ToArray();

        return new PollsResponse(
            year,
            round,
            office,
            normalizedUf,
            municipality,
            polls,
            "Cada registro representa a edição oficial mais recente, por número de registro, entre as fontes auditadas carregadas. Cenários permanecem separados e valores ausentes permanecem ausentes.",
            "Pesquisa eleitoral é uma estimativa amostral, não uma previsão nem o resultado da eleição. Margem de erro e nível de confiança são exibidos somente quando publicados pela fonte.");
    }

    public async Task<LiveCountResponse> LiveCountAsync(
        int year,
        int round,
        int office,
        string? uf,
        string? municipalityTseCode,
        CancellationToken ct)
    {
        ValidateElection(year, round, office);
        var normalizedUf = NormalizeUf(uf);
        var municipality = NormalizeMunicipality(municipalityTseCode);
        if (municipality is not null && normalizedUf is null)
            throw new ArgumentException("municipalityTseCode requires uf");

        var scope = municipality is not null ? "municipal" : normalizedUf is not null ? "state" : "national";
        var rows = await repository.LatestLiveCountAsync(year, round, office, scope, normalizedUf, municipality, ct);
        LiveCountDto? snapshot = null;
        if (rows.Count > 0)
        {
            var first = rows[0];
            var results = rows
                .Where(r => r.Position is not null && r.OptionLabel is not null)
                .OrderBy(r => r.Position)
                .Select(r => new LiveCountItemDto(
                    r.Position!.Value,
                    r.CandidacyId,
                    r.CandidateNumber,
                    r.OptionLabel!,
                    r.PartyAcronym,
                    r.Votes,
                    r.Percentage,
                    r.ResultStatus))
                .ToArray();
            snapshot = new LiveCountDto(
                first.SnapshotId,
                first.Scope,
                first.Status,
                first.CountedSections,
                first.TotalSections,
                first.CountedPercent,
                first.CapturedAt,
                first.TseGeneratedAt,
                first.SourceUrl,
                results);
        }

        return new LiveCountResponse(
            year,
            round,
            office,
            normalizedUf,
            municipality,
            snapshot,
            "O endpoint serve somente o snapshot oficial auditado mais recente para o recorte exato. Não sintetiza apuração a partir de BUs históricos e não preenche campos ausentes com zero.",
            "Enquanto o status for parcial, os números podem mudar a cada atualização oficial. Somente um snapshot marcado como final pela fonte deve ser tratado como encerrado.");
    }

    private static void ValidateElection(int year, int round, int office)
    {
        if (year is < 1900 or > 2200) throw new ArgumentOutOfRangeException(nameof(year));
        if (round is < 1 or > 2) throw new ArgumentOutOfRangeException(nameof(round));
        if (office <= 0) throw new ArgumentOutOfRangeException(nameof(office));
    }

    private static string? NormalizeUf(string? uf)
    {
        if (string.IsNullOrWhiteSpace(uf)) return null;
        var normalized = uf.Trim().ToUpperInvariant();
        if (normalized.Length != 2 || normalized.Any(c => c is < 'A' or > 'Z'))
            throw new ArgumentException("uf must have two letters", nameof(uf));
        return normalized;
    }

    private static string? NormalizeMunicipality(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var normalized = code.Trim();
        if (normalized.Length != 5 || normalized.Any(c => c is < '0' or > '9'))
            throw new ArgumentException("municipalityTseCode must have five digits", nameof(code));
        return normalized;
    }
}
