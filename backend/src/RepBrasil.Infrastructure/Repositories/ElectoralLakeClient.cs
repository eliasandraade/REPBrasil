using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// Cliente do worker do lake eleitoral (Parquet). O token (quando configurado no worker com
/// REPBRASIL_LAKE_TOKEN) vai em <c>Authorization: Bearer</c>, configurado no <see cref="HttpClient"/>.
/// Falha de rede, timeout ou resposta não-2xx viram <see cref="ElectoralUnavailableException"/> (503
/// "indisponível"): o corpo da resposta do worker nunca é repassado ao cliente da API.
/// </summary>
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

    /// <summary>Configura o token do worker (vazio ⇒ sem cabeçalho, para workers sem token).</summary>
    public static void ConfigureAuthorization(HttpClient client, string? token)
    {
        if (!string.IsNullOrWhiteSpace(token))
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Trim());
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

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw new ElectoralUnavailableException($"electoral lake unreachable for {context}", e);
        }
        catch (TaskCanceledException e) when (!ct.IsCancellationRequested)
        {
            throw new ElectoralUnavailableException($"electoral lake timed out for {context}", e);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new ElectoralUnavailableException(
                    $"electoral lake returned {(int)response.StatusCode} for {context}",
                    new HttpRequestException(null, null, response.StatusCode));
            }

            return (await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct))!;
        }
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

    public async Task<IReadOnlyList<ContestStatsRow>> SectionContestStatsAsync(ContestStatsQuery query, CancellationToken ct) =>
        await PostAsync<List<ContestStatsRow>>(
            "/v1/section-contest-stats",
            new
            {
                candidacyId = query.CandidacyId,
                year = query.Year,
                round = query.Round,
                electionCode = query.ElectionCode,
                officeCode = query.OfficeCode,
                uf = query.Uf.Trim().ToUpperInvariant(),
                municipalityTseCode = query.MunicipalityTseCode,
                zone = query.Zone,
                level = query.Level,
            },
            $"contest stats {query.Year}/{query.Round}/{query.Uf}/{query.MunicipalityTseCode}",
            ct) ?? [];
}
