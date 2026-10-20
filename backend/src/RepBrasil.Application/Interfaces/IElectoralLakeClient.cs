using RepBrasil.Application.Electoral;

namespace RepBrasil.Application.Interfaces;

public interface IElectoralLakeClient
{
    Task<IReadOnlyList<VoteRow>> ResultVotesAsync(long resultId, string uf, CancellationToken ct);

    Task<IReadOnlyDictionary<long, long>> ValidVotesByResultAsync(
        int year,
        int round,
        string uf,
        string municipalityTseCode,
        IReadOnlyList<int> officeCodes,
        int? zone,
        CancellationToken ct);

    Task<IReadOnlyList<SectionCandidacyVotesRow>> CandidacyVotesByResultAsync(
        IReadOnlyList<Guid> candidacyIds,
        IReadOnlyList<ElectionOffice> scopes,
        string uf,
        string municipalityTseCode,
        int? zone,
        CancellationToken ct);

    /// <summary>Base Eleitoral (escopo frio): posição da candidatura na disputa por urna ou local de votação.</summary>
    Task<IReadOnlyList<ContestStatsRow>> SectionContestStatsAsync(ContestStatsQuery query, CancellationToken ct);

    /// <summary>Saúde do worker (<c>GET /health</c>): falha de rede, prazo esgotado ou resposta não-2xx viram <c>false</c>.</summary>
    Task<bool> HealthAsync(CancellationToken ct);
}
