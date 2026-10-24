namespace RepBrasil.Application.LiveElection.Tse;

public sealed class ElectionDiscoveryException(string message) : Exception(message);

/// <summary>Eleição descoberta no EA11. O código da eleição vem do arquivo oficial, nunca só da configuração.</summary>
public sealed record DiscoveredElection(
    string Cycle,
    int PleitoCode,
    DateOnly? Date,
    int ElectionCode,
    string ElectionName,
    int Round,
    int OfficeCode,
    string OfficeName,
    int? FirstRoundElectionCode,
    int? FirstRoundPleitoCode,
    IReadOnlyList<string> Warnings);

public static class ElectionDiscovery
{
    /// <summary>
    /// Encontra, no ciclo pedido, a eleição do turno <paramref name="round"/> com o cargo <paramref name="officeCode"/> na
    /// abrangência Brasil (Presidente: eleição ordinária federal). O 1º turno é a eleição cujo <c>cdt2</c> aponta para ela.
    /// Divergência com os códigos esperados vira aviso operacional; prevalece o EA11.
    /// </summary>
    public static DiscoveredElection Discover(
        Ea11Config config,
        string cycle,
        int round,
        int officeCode,
        int? expectedElectionCode = null,
        int? expectedPleitoCode = null)
    {
        var inCycle = config.Pleitos.Where(p => string.Equals(p.Cycle, cycle, StringComparison.OrdinalIgnoreCase)).ToList();
        if (inCycle.Count == 0) throw new ElectionDiscoveryException($"EA11 sem pleitos do ciclo {cycle}.");

        var matches = inCycle
            .SelectMany(p => p.Elections.Select(e => (Pleito: p, Election: e)))
            .Where(x => x.Election.Round == round && x.Election.HasOffice(officeCode, "br"))
            .ToList();
        if (matches.Count == 0)
            throw new ElectionDiscoveryException($"EA11 sem eleição do {round}º turno com o cargo {officeCode} na abrangência Brasil.");
        if (matches.Count > 1)
        {
            var preferred = matches.Where(m => m.Election.Code == expectedElectionCode).ToList();
            if (preferred.Count != 1)
                throw new ElectionDiscoveryException(
                    $"EA11 ambíguo: {matches.Count} eleições do {round}º turno com o cargo {officeCode} ({string.Join(", ", matches.Select(m => m.Election.Code))}).");
            matches = preferred;
        }

        var (pleito, election) = matches[0];
        var office = election.Scopes.SelectMany(s => s.Offices).First(o => o.Code == officeCode);
        var warnings = new List<string>();
        if (expectedElectionCode is not null && expectedElectionCode != election.Code)
            warnings.Add($"Código da eleição descoberto no EA11 ({election.Code}) difere do esperado ({expectedElectionCode}); vale o EA11.");
        if (expectedPleitoCode is not null && expectedPleitoCode != pleito.Code)
            warnings.Add($"Código do pleito descoberto no EA11 ({pleito.Code}) difere do esperado ({expectedPleitoCode}); vale o EA11.");

        int? firstRoundCode = null;
        int? firstRoundPleito = null;
        if (round == 2)
        {
            var linked = inCycle
                .SelectMany(p => p.Elections.Select(e => (Pleito: p, Election: e)))
                .Where(x => x.Election.Round == 1 && x.Election.SecondRoundCode == election.Code && x.Election.HasOffice(officeCode, "br"))
                .ToList();
            if (linked.Count == 1)
            {
                firstRoundCode = linked[0].Election.Code;
                firstRoundPleito = linked[0].Pleito.Code;
            }
            else
            {
                warnings.Add("EA11 não liga o 1º turno a esta eleição (cdt2); comparação com o 1º turno indisponível.");
            }
        }

        return new DiscoveredElection(
            pleito.Cycle,
            pleito.Code,
            pleito.Date,
            election.Code,
            election.Name,
            election.Round,
            office.Code,
            office.Name,
            firstRoundCode,
            firstRoundPleito,
            warnings);
    }
}
