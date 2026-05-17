using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Score.DTOs;

namespace RepBrasil.Application.Score.Queries;

// Returns the most recent ScoreSnapshot for this politician, or a v0 placeholder when none exists.
// No real score is calculated in v0 — this endpoint confirms the infrastructure is wired correctly.
// TotalScore is always null while status = "em_desenvolvimento" to prevent accidental exposure of raw Score values.
public class GetPoliticianScoreQuery(IScoreRepository repository)
{
    public async Task<ScoreStatusDto> ExecuteAsync(Guid politicianId, CancellationToken ct = default)
    {
        var snapshot = await repository.GetCurrentAsync(politicianId, ct);
        if (snapshot is null)
            return new ScoreStatusDto(ScoreConstants.StatusEmDesenvolvimento, "v0", null, null, Array.Empty<ScoreFactorDto>(), ScoreConstants.Disclaimer);

        var factors = snapshot.Factors.Select(ScoreFactorDto.FromEntity).ToList();
        return new ScoreStatusDto(
            ScoreConstants.StatusEmDesenvolvimento,
            snapshot.MethodologyVersion,
            snapshot.CalculatedAt,
            null, // TotalScore always null while em_desenvolvimento
            factors,
            ScoreConstants.Disclaimer);
    }
}
