namespace RepBrasil.Application.Electoral;

/// <summary>
/// Voto de uma candidatura em uma seção do lote vigente. Votes pode ser zero: a candidatura
/// está vinculada ao pleito/cargo, a seção existe, mas não houve linha nominal para ela no BU.
/// </summary>
public sealed class CandidacySectionComparisonRow
{
    public Guid CandidacyId { get; init; }
    public short Year { get; init; }
    public short Round { get; init; }
    public int OfficeCode { get; init; }
    public string OfficeName { get; init; } = string.Empty;
    public string Uf { get; init; } = string.Empty;
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public string? MunicipalityName { get; init; }
    public int Zone { get; init; }
    public int Section { get; init; }
    public int[] SectionMembers { get; init; } = [];
    public long Votes { get; init; }
    public long? ValidVotes { get; init; }
}
