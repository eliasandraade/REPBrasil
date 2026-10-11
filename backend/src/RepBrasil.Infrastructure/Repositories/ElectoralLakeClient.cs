using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class ElectoralLakeClient(HttpClient http) : IElectoralLakeClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    private sealed class ValidVotesRow
    {
        public long ResultId { get; init; }
        public long ValidVotes { get; init; }
    }

    private async Task<T> PostAsync<T>(string path, object body, string context, CancellationToken ct)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(body, JsonOptions);
        using var content = new ByteArrayContent(payload);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        content.Headers.ContentLength = payload.Length;
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = content,
        };
        using var response = await http.SendAsync(request, ct);

        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Electoral lake returned {(int)response.StatusCode} for {context}: {responseBody}",
                null,
                response.StatusCode);
        }

        return (await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct))!;
    }

    public async Task<IReadOnlyList<VoteRow>> ResultVotesAsync(long resultId, string uf, CancellationToken ct) =>
        await PostAsync<List<VoteRow>>(
            "/v1/result-votes",
            new { resultId, uf = uf.Trim().ToUpperInvariant() },
            $"result {resultId}",
            ct) ?? [];

    public async Task<IReadOnlyDictionary<long, long>> ValidVotesByResultAsync(
        int year,
        int round,
        string uf,
        string municipalityTseCode,
        IReadOnlyList<int> officeCodes,
        int? zone,
        CancellationToken ct)
    {
        var rows = await PostAsync<List<ValidVotesRow>>(
            "/v1/valid-votes",
            new
            {
                year,
                round,
                uf = uf.Trim().ToUpperInvariant(),
                municipalityTseCode,
                officeCodes,
                zone,
            },
            $"valid votes {year}/{round}/{uf}/{municipalityTseCode}",
            ct) ?? [];
        return rows.ToDictionary(row => row.ResultId, row => row.ValidVotes);
    }

    public async Task<IReadOnlyList<SectionCandidacyVotesRow>> CandidacyVotesByResultAsync(
        IReadOnlyList<Guid> candidacyIds,
        IReadOnlyList<ElectionOffice> scopes,
        string uf,
        string municipalityTseCode,
        int? zone,
        CancellationToken ct) =>
        await PostAsync<List<SectionCandidacyVotesRow>>(
            "/v1/candidacy-votes",
            new
            {
                candidacyIds,
                scopes = scopes.Select(scope => new { year = scope.Year, round = scope.Round, officeCode = scope.OfficeCode }),
                uf = uf.Trim().ToUpperInvariant(),
                municipalityTseCode,
                zone,
            },
            $"candidacy votes {uf}/{municipalityTseCode}",
            ct) ?? [];
}
