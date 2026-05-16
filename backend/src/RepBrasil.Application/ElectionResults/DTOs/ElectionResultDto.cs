using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.ElectionResults.DTOs;

public record ElectionResultDto(
    int Year,
    int Round,
    string Office,
    string State,
    string? City,
    long TotalVotes,
    string? Situation,
    bool Elected
)
{
    public static ElectionResultDto FromEntities(ElectionResult result, Election election) =>
        new(election.Year, result.Round, election.Office, election.State, election.City,
            result.TotalVotes, result.Situation, result.Elected);
}
