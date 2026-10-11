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

    public async Task<IReadOnlyList<VoteRow>> ResultVotesAsync(long resultId, string uf, CancellationToken ct)
    {
        using var response = await http.PostAsJsonAsync(
            "/v1/result-votes",
            new { resultId, uf = uf.Trim().ToUpperInvariant() },
            JsonOptions,
            ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Electoral lake returned {(int)response.StatusCode} for result {resultId}: {body}",
                null,
                response.StatusCode);
        }

        return await response.Content.ReadFromJsonAsync<List<VoteRow>>(JsonOptions, ct) ?? [];
    }
}
