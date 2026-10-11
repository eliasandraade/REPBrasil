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
}
