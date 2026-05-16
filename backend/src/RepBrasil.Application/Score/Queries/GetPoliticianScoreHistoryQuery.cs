using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Score.DTOs;

namespace RepBrasil.Application.Score.Queries;

// Returns all historical snapshots in reverse chronological order.
// Snapshots are immutable — new calculations produce new rows, never overwriting existing ones.
// TotalScore is always null while status = "em_desenvolvimento" to prevent accidental exposure of raw Score values.
public class GetPoliticianScoreHistoryQuery(IScoreRepository repository)
{
    private const string StatusEmDesenvolvimento = "em_desenvolvimento";
    private const string Disclaimer =
        "Score Público em desenvolvimento. Não representa recomendação de voto, julgamento moral ou inferência automática.";

    public async Task<IReadOnlyList<ScoreStatusDto>> ExecuteAsync(
        Guid politicianId, CancellationToken ct = default)
    {
        var snapshots = await repository.GetHistoryAsync(politicianId, ct);
        return snapshots
            .Select(s => new ScoreStatusDto(
                StatusEmDesenvolvimento,
                s.MethodologyVersion,
                s.CalculatedAt,
                null, // TotalScore always null while em_desenvolvimento
                [],
                Disclaimer))
            .ToList();
    }
}
