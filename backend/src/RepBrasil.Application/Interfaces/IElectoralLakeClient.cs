using RepBrasil.Application.Electoral;

namespace RepBrasil.Application.Interfaces;

public interface IElectoralLakeClient
{
    Task<IReadOnlyList<VoteRow>> ResultVotesAsync(long resultId, string uf, CancellationToken ct);
}
