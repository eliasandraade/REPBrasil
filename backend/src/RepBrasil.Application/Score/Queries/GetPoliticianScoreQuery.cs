using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Score.DTOs;

namespace RepBrasil.Application.Score.Queries;

// Returns the most recent ScoreSnapshot for this politician, or a v0 placeholder when none exists.
// No real score is calculated in v0 — this endpoint confirms the infrastructure is wired correctly.
// TotalScore is always null while status = "em_desenvolvimento" to prevent accidental exposure of raw Score values.
public class GetPoliticianScoreQuery(IScoreRepository repository)
{
    private const string StatusEmDesenvolvimento = "em_desenvolvimento";
    private const string Disclaimer =
        "Score Público em desenvolvimento. Não representa recomendação de voto, julgamento moral ou inferência automática.";

    public async Task<ScoreStatusDto> ExecuteAsync(Guid politicianId, CancellationToken ct = default)
    {
        var snapshot = await repository.GetCurrentAsync(politicianId, ct);
        if (snapshot is null)
            return new ScoreStatusDto(StatusEmDesenvolvimento, "v0", null, null, [], Disclaimer);

        var factors = snapshot.Factors.Select(ScoreFactorDto.FromEntity).ToList();
        return new ScoreStatusDto(
            StatusEmDesenvolvimento,
            snapshot.MethodologyVersion,
            snapshot.CalculatedAt,
            null, // TotalScore always null while em_desenvolvimento
            factors,
            Disclaimer);
    }
}
