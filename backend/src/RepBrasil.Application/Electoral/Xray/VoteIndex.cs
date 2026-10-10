namespace RepBrasil.Application.Electoral;

/// <summary>Recorte territorial: UF (null = todas importadas), município e zona opcionais.</summary>
public sealed record TerritoryFilter(string? Uf, string? MunicipalityTseCode = null, int? Zone = null)
{
    public bool Includes(string uf, string municipalityTseCode, int zone) =>
        (Uf is null || Uf == uf)
        && (MunicipalityTseCode is null || MunicipalityTseCode == municipalityTseCode)
        && (Zone is null || Zone == zone);
}

/// <summary>Valor de uma candidatura num território, já com estado e cobertura.</summary>
public sealed record TerritoryAggregate(
    long? Votes, long ValidVotes, long? Eligible, long? Turnout, int Urns, int ZonesCovered, int ZonesExpected,
    string State)
{
    public double? Share => Votes is { } v ? Comparability.Pct(v, ValidVotes) : null;
}

/// <summary>
/// Índice em memória dos agregados por zona (votos das candidaturas, totais dos cargos, zonas
/// esperadas pelo cadastro). Agrega qualquer recorte territorial sem voltar ao banco e decide o
/// estado de cada valor pelas regras de <see cref="Comparability"/>.
/// </summary>
public sealed class VoteIndex
{
    private readonly Dictionary<Guid, List<CandidacyZoneVotesRow>> _votes;
    private readonly Dictionary<ElectionOffice, List<ZoneTotalsRow>> _totals;
    private readonly Dictionary<(int Year, int Round), List<ExpectedZoneRow>> _expected;
    private readonly Dictionary<(ElectionOffice, string, string, string?, TerritoryFilter), UnitTotals> _unitCache = [];

    private sealed record UnitTotals(long Valid, long? Eligible, long? Turnout, int Urns, int Covered, int Expected);

    public VoteIndex(
        IEnumerable<CandidacyZoneVotesRow> votes, IEnumerable<ZoneTotalsRow> totals, IEnumerable<ExpectedZoneRow> expected)
    {
        _votes = votes.GroupBy(v => v.CandidacyId).ToDictionary(g => g.Key, g => g.ToList());
        _totals = totals.GroupBy(t => new ElectionOffice(t.Year, t.Round, t.OfficeCode)).ToDictionary(g => g.Key, g => g.ToList());
        _expected = expected.GroupBy(e => ((int)e.Year, (int)e.Round)).ToDictionary(g => g.Key, g => g.ToList());
    }

    public IReadOnlyList<ZoneTotalsRow> Totals(ElectionOffice key) => _totals.GetValueOrDefault(key) ?? [];

    public IReadOnlyList<ExpectedZoneRow> Expected(int year, int round) => _expected.GetValueOrDefault((year, round)) ?? [];

    public IReadOnlyList<CandidacyZoneVotesRow> Votes(Guid candidacyId) => _votes.GetValueOrDefault(candidacyId) ?? [];

    private UnitTotals Unit(ContestInfo contest, TerritoryFilter t)
    {
        var cacheKey = (contest.CoverageKey, contest.Scope, contest.ElectoralUnit, contest.Uf, t);
        if (_unitCache.TryGetValue(cacheKey, out var cached)) return cached;

        var covered = Totals(contest.CoverageKey)
            .Where(z => t.Includes(z.Uf, z.MunicipalityTseCode, z.Zone) && contest.Contains(z.Uf, z.MunicipalityTseCode))
            .ToList();
        var coveredKeys = covered.Select(z => (z.Uf, z.MunicipalityTseCode, z.Zone)).ToHashSet();
        var expectedKeys = Expected(contest.Year, contest.Round)
            .Where(e => t.Includes(e.Uf, e.MunicipalityTseCode, e.Zone) && contest.Contains(e.Uf, e.MunicipalityTseCode))
            .Select(e => (e.Uf, e.MunicipalityTseCode, e.Zone))
            .ToHashSet();
        expectedKeys.UnionWith(coveredKeys);

        // Aptos/comparecimento: soma só quando todas as zonas cobertas publicam o dado.
        long? eligible = covered.Count > 0 && covered.All(z => z.Eligible is not null) ? covered.Sum(z => z.Eligible!.Value) : null;
        long? turnout = covered.Count > 0 && covered.All(z => z.Turnout is not null) ? covered.Sum(z => z.Turnout!.Value) : null;
        var unit = new UnitTotals(
            covered.Sum(z => z.ValidVotes), eligible, turnout, covered.Sum(z => z.Urns), coveredKeys.Count, expectedKeys.Count);
        _unitCache[cacheKey] = unit;
        return unit;
    }

    public TerritoryAggregate Aggregate(XrayCandidacyRow candidacy, TerritoryFilter t)
    {
        var contest = ContestInfo.From(candidacy);
        var inContest = t.Uf is null || contest.Covers(t.Uf, t.MunicipalityTseCode);
        var unit = inContest ? Unit(contest, t) : new UnitTotals(0, null, null, 0, 0, 0);
        var votes = Votes(candidacy.Id)
            .Where(v => t.Includes(v.Uf, v.MunicipalityTseCode, v.Zone) && contest.Contains(v.Uf, v.MunicipalityTseCode))
            .Sum(v => v.Votes);
        var state = Comparability.Cell(
            inContest,
            Comparability.CoverageOf(unit.Covered, unit.Expected),
            Comparability.IsTicketMember(candidacy.OfficeCode),
            Comparability.NotOnBallot(candidacy.InsertedInUrn),
            candidacy.HasLink,
            votes);
        return new TerritoryAggregate(
            Comparability.HasCount(state) ? votes : null, unit.Valid, unit.Eligible, unit.Turnout, unit.Urns,
            unit.Covered, unit.Expected, state);
    }
}
