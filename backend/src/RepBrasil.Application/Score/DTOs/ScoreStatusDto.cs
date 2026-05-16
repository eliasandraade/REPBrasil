namespace RepBrasil.Application.Score.DTOs;

public record ScoreStatusDto(
    string Status,
    string MethodologyVersion,
    DateTime? GeneratedAt,
    decimal? TotalScore,
    IReadOnlyList<ScoreFactorDto> Factors,
    string Disclaimer
);
