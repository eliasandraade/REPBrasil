using System.Globalization;
using System.Text;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Rankings;

namespace RepBrasil.Application.Parties;

// ── Linhas do repositório ───────────────────────────────────────────────────

/// <summary>Partido × eleição × cargo numa UF: candidaturas oficiais e votos do BU (nominais + legenda).</summary>
public sealed class PartyOfficeRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public int OfficeCode { get; init; }
    public string OfficeName { get; init; } = string.Empty;
    public int PartyNumber { get; init; }
    public string? PartyAcronym { get; init; }
    public string? PartyName { get; init; }
    public string? Federations { get; init; }
    public int Candidacies { get; init; }
    public int Elected { get; init; }
    /// <summary>Votos nominais nos números do partido (null = sem Boletim de Urna do cargo na UF).</summary>
    public long? NominalVotes { get; init; }
    public long? LegendVotes { get; init; }
    /// <summary>Válidos do cargo na UF (nominais + legenda); null = sem Boletim de Urna.</summary>
    public long? ValidVotes { get; init; }
    public int MunicipalitiesWithVotes { get; init; }
    public int MunicipalitiesCovered { get; init; }
}

/// <summary>Partido num município (ou zona): votos, válidos do cargo e candidaturas do partido ali.</summary>
public sealed class PartyTerritoryRow
{
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public string? MunicipalityName { get; init; }
    public string? MunicipalitySlug { get; init; }
    public int? IbgeCode { get; init; }
    public int? Zone { get; init; }
    public long ValidVotes { get; init; }
    public long NominalVotes { get; init; }
    public long LegendVotes { get; init; }
    /// <summary>Candidaturas do partido na disputa municipal (null para cargos estaduais e federais).</summary>
    public int? Candidacies { get; init; }
    public int? Elected { get; init; }
}

public sealed class PartyCandidateRow
{
    public Guid CandidacyId { get; init; }
    public Guid? PoliticianId { get; init; }
    public string? Slug { get; init; }
    public string BallotName { get; init; } = string.Empty;
    public int CandidateNumber { get; init; }
    public string? UnitName { get; init; }
    public bool HasLink { get; init; }
    public long? Votes { get; init; }
    public bool? Elected { get; init; }
    public string? RoundOutcome { get; init; }
}

public interface IPartyRepository
{
    /// <summary>Todos os partidos × eleições × cargos titulares da UF (vice e suplentes ficam fora).</summary>
    Task<IReadOnlyList<PartyOfficeRow>> OfficeStatsAsync(string uf, CancellationToken ct);

    /// <summary>Municípios (ou zonas de um município) com Boletim de Urna do cargo, com os votos dos números do partido.</summary>
    Task<IReadOnlyList<PartyTerritoryRow>> TerritoriesAsync(
        string uf, int year, int round, int office, IReadOnlyList<int> partyNumbers, string? municipalityTseCode, CancellationToken ct);

    Task<IReadOnlyList<PartyCandidateRow>> CandidatesAsync(
        string uf, int year, int round, int office, IReadOnlyList<int> partyNumbers, string? municipalityTseCode, int limit, CancellationToken ct);
}

// ── Contrato da API ─────────────────────────────────────────────────────────

public record PartyChangeDto(
    int FromYear, int FromRound, int FromPartyNumber, long? FromVotes, double? FromShare, int FromElected,
    long? DeltaVotes, double? DeltaPercent, double? DeltaSharePoints, string Comparability, string Note);

public record PartyResultDto(
    int Year, int Round, int OfficeCode, string OfficeName, int PartyNumber, string? Federations,
    long? Votes, long? NominalVotes, long? LegendVotes, long? ValidVotes, double? Share,
    int Candidacies, int Elected, int MunicipalitiesWithVotes, int MunicipalitiesCovered, PartyChangeDto? Change);

public record PartyIdentityDto(int Year, int Round, int Number, string Acronym, string? Name, string? Federations);

public record PartySummaryDto(string Slug, string Acronym, string? Name, IReadOnlyList<int> Numbers, IReadOnlyList<PartyResultDto> Results);

public record PartyElectionDto(int Year, int Round, IReadOnlyList<PartyOfficeRefDto> Offices);

public record PartyOfficeRefDto(int Code, string Name, bool Covered);

public record PartiesResponse(
    string Uf, IReadOnlyList<PartyElectionDto> Elections, IReadOnlyList<PartySummaryDto> Parties, string Methodology,
    IReadOnlyDictionary<string, string> Definitions, DerivedFreshnessDto Freshness);

public record PartyTerritoryDto(
    string MunicipalityTseCode, string Name, string? Slug, int? Zone, long Votes, long ValidVotes, double? Share,
    int? Candidacies, int? Elected);

public record PartyCandidateDto(
    Guid CandidacyId, Guid? PoliticianId, string? Slug, string Name, int Number, string? Unit, long? Votes, bool? Elected, string? Outcome);

public record PartyDetailDto(
    int Year, int Round, int OfficeCode, string OfficeName, IReadOnlyList<int> PartyNumbers,
    IReadOnlyList<PartyTerritoryDto> Strongest, IReadOnlyList<PartyTerritoryDto> Weakest, int TerritoriesWithVotes,
    int TerritoriesConsidered, IReadOnlyList<PartyCandidateDto> Candidates, RankingCoverageDto? Coverage, string Note);

public record PartyProfileResponse(
    string Slug, string Acronym, string? Name, string Uf, IReadOnlyList<PartyIdentityDto> Identity,
    IReadOnlyList<PartyResultDto> Results, PartyDetailDto? Detail, IReadOnlyList<string> Notes, string Methodology,
    IReadOnlyDictionary<string, string> Definitions, DerivedFreshnessDto Freshness);

// ── Serviço ─────────────────────────────────────────────────────────────────

/// <summary>
/// Partidos e força partidária numa UF, só com dados oficiais: candidaturas (TSE — Candidatos) e votos do Boletim de
/// Urna (nominais nos números do partido + legenda). Identidade do partido = sigla oficial do TSE (o número de cada
/// eleição fica registrado); fusões e incorporações nunca são inferidas. Sem cor de partido, sem ideologia.
/// </summary>
public class PartyService(IPartyRepository repo, IRankingRepository rankings, IElectoralXrayRepository xray)
{
    public const int TopTerritories = 10;
    public const int TopCandidates = 20;

    /// <summary>Cargos proporcionais: o voto de legenda conta para o partido.</summary>
    public static bool IsProportional(int office) => RankingService.ProportionalOffices.Contains(office);

    private static bool IsMunicipalOffice(int office) => office is 11 or 13;

    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["votes"] = "votos do partido no cargo: nominais nos números do partido + legenda (só cargos proporcionais), segundo o Boletim de Urna",
        ["share"] = "votos do partido ÷ votos válidos do cargo no recorte (nominais + legenda)",
        ["candidacies"] = "candidaturas titulares registradas pelo partido no cargo (TSE — Candidatos); vice e suplentes ficam fora",
        ["elected"] = "candidaturas do partido com resultado oficial de eleita",
        ["change"] = "variação em relação à eleição anterior importada do MESMO cargo e turno, só com Boletim de Urna completo nas duas",
        ["identity"] = "o partido é identificado pela sigla oficial do TSE; números de cada eleição ficam registrados; fusões não são inferidas",
    };

    public const string Methodology =
        "Fatos: candidaturas oficiais do TSE e votos dos Boletins de Urna por zona e cargo. Métricas: participação e variação "
        + "entre eleições do mesmo cargo. Federação aparece como informação; os votos são do partido. Nenhuma classificação "
        + "ideológica, nenhuma cor de partido; dados descrevem a votação e não avaliam nem recomendam.";

    /// <summary>Sigla → endereço estável: sem acento, minúsculas, só letras e números ("PC do B" e "PCdoB" → "pcdob").</summary>
    public static string Slug(string? acronym)
    {
        var folded = (acronym ?? string.Empty).Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(folded.Length);
        foreach (var ch in folded)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsAsciiLetterOrDigit(ch)) sb.Append(char.ToLowerInvariant(ch));
        }
        return sb.ToString();
    }

    private static string Uf(string? uf)
    {
        var value = (uf ?? "").Trim().ToUpperInvariant();
        if (value.Length != 2 || !value.All(char.IsAsciiLetter)) throw new ElectoralBadRequestException("uf é obrigatória (duas letras).");
        return value;
    }

    /// <summary>Votos do partido no cargo: nominais + legenda nos proporcionais; null quando não há BU.</summary>
    public static long? Votes(PartyOfficeRow r) =>
        r.ValidVotes is null ? null : (r.NominalVotes ?? 0) + (IsProportional(r.OfficeCode) ? r.LegendVotes ?? 0 : 0);

    public async Task<PartiesResponse> ListAsync(string? uf, CancellationToken ct)
    {
        var ufCode = Uf(uf);
        var rows = await repo.OfficeStatsAsync(ufCode, ct);
        var coverage = await CoverageByOfficeAsync(ufCode, rows, ct);
        var parties = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.PartyAcronym))
            .GroupBy(r => Slug(r.PartyAcronym))
            .Where(g => g.Key.Length > 0)
            .Select(g => Summary(g.Key, g.ToList(), rows, coverage))
            .OrderByDescending(p => p.Results.Where(x => x.Votes is not null).Select(x => (long?)x.Votes).DefaultIfEmpty(null).Max() ?? -1)
            .ThenBy(p => p.Acronym, StringComparer.Ordinal)
            .ToList();
        return new PartiesResponse(ufCode, Elections(rows, coverage), parties, Methodology, Definitions, XrayService.Freshness(await xray.FreshnessAsync(ct)));
    }

    public async Task<PartyProfileResponse> ProfileAsync(
        string slug, string? uf, int? year, int? round, int? office, CancellationToken ct)
    {
        var ufCode = Uf(uf);
        var key = Slug(slug);
        var rows = await repo.OfficeStatsAsync(ufCode, ct);
        var mine = rows.Where(r => Slug(r.PartyAcronym) == key && key.Length > 0).ToList();
        if (mine.Count == 0) throw new ElectoralNotFoundException($"Partido \"{slug}\" sem candidaturas importadas em {ufCode}.");
        var coverage = await CoverageByOfficeAsync(ufCode, rows, ct);
        var summary = Summary(key, mine, rows, coverage);
        var identity = mine
            .GroupBy(r => (r.Year, r.Round, r.PartyNumber, Acronym: r.PartyAcronym!.Trim()))
            .Select(g => new PartyIdentityDto(
                g.Key.Year, g.Key.Round, g.Key.PartyNumber, g.Key.Acronym, g.Select(r => r.PartyName).FirstOrDefault(n => n is not null),
                JoinFederations(g.Select(r => r.Federations))))
            .OrderByDescending(i => i.Year).ThenByDescending(i => i.Round).ThenBy(i => i.Number)
            .ToList();

        var notes = new List<string>();
        if (identity.Select(i => i.Number).Distinct().Count() > 1)
            notes.Add($"A sigla {summary.Acronym} usou mais de um número nas eleições importadas ({string.Join(", ", identity.Select(i => i.Number).Distinct())}).");
        if (identity.Select(i => i.Acronym).Distinct(StringComparer.Ordinal).Count() > 1)
            notes.Add($"Grafias da sigla no TSE: {string.Join(", ", identity.Select(i => i.Acronym).Distinct(StringComparer.Ordinal))} (mesmo endereço).");
        if (identity.Any(i => i.Federations is not null))
            notes.Add("Federação partidária aparece como informação da candidatura; os votos e as candidaturas contados aqui são do partido.");

        var pick = Pick(summary.Results, year, round, office);
        PartyDetailDto? detail = null;
        if (pick is not null) detail = await DetailAsync(ufCode, pick, mine, ct);
        else if (year is not null || round is not null || office is not null)
            throw new ElectoralBadRequestException("O partido não tem candidaturas nem votos nessa eleição e cargo.");

        return new PartyProfileResponse(
            key, summary.Acronym, summary.Name, ufCode, identity, summary.Results, detail, notes, Methodology, Definitions,
            XrayService.Freshness(await xray.FreshnessAsync(ct)));
    }

    /// <summary>Camada "partido" do mapa: participação do partido em cada município (ou zona do município).</summary>
    public async Task<MapLayerResponse> MapAsync(MapQuery q, int? party, CancellationToken ct)
    {
        if (party is not { } number) throw new ElectoralBadRequestException("layer partido exige party (número do partido).");
        if (q.Office is not { } office) throw new ElectoralBadRequestException("layer partido exige office.");
        if (Comparability.IsTicketMember(office)) throw new ElectoralBadRequestException("Vice e suplente são votados na chapa: escolha o cargo do titular.");
        var uf = Uf(q.Uf);
        var mun = string.IsNullOrWhiteSpace(q.Municipality) ? null : q.Municipality.Trim().PadLeft(5, '0');
        var rows = await repo.TerritoriesAsync(uf, q.Year, q.Round, office, [number], mun, ct);
        var municipal = IsMunicipalOffice(office);
        var features = rows.Select(r =>
        {
            var votes = r.NominalVotes + (IsProportional(office) ? r.LegendVotes : 0);
            // cargo municipal: partido sem candidatura no município não estava na urna (nunca zero)
            var onBallot = !municipal || r.Candidacies is > 0;
            var share = onBallot ? Comparability.Pct(votes, r.ValidVotes) : null;
            return new MapFeatureDto(
                r.Zone is null ? $"{uf}|{r.MunicipalityTseCode}" : $"{uf}|{r.MunicipalityTseCode}|{r.Zone}",
                r.MunicipalityTseCode, r.IbgeCode, r.MunicipalityName ?? r.MunicipalityTseCode, r.Zone, null, null, null,
                share, null, null, State(onBallot, share),
                new Dictionary<string, object?>
                {
                    ["votes"] = onBallot ? votes : null,
                    ["validVotes"] = r.ValidVotes,
                    ["candidacies"] = r.Candidacies,
                    ["elected"] = r.Elected,
                });
        }).ToList();
        var values = features.Where(f => f.Value is not null).Select(f => f.Value!.Value).ToList();
        return new MapLayerResponse(
            q.Year, q.Round, uf, mun, "party", mun is null ? "municipality" : "zone", office, features, [],
            values.Count > 0 ? values.Min() : null, values.Count > 0 ? values.Max() : null, null,
            "Participação do partido: votos nominais nos números do partido (+ legenda nos cargos proporcionais) ÷ válidos do cargo. "
            + (municipal ? "Município sem candidatura do partido fica sem cor (não estava na urna)." : ""),
            XrayService.Freshness(await xray.FreshnessAsync(ct)));
    }

    // ── internos ──────────────────────────────────────────────────────────────

    /// <summary>Zero só com o partido na urna e BU do cargo no território; fora da disputa municipal nunca é zero.</summary>
    private static string State(bool onBallot, double? share) =>
        !onBallot ? CellState.NotOnBallot : share is null ? CellState.NoCoverage : share == 0 ? CellState.Zero : CellState.Value;

    /// <summary>Cobertura do BU por (ano, turno, cargo) na UF inteira: completa quando toda zona do cadastro tem BU.</summary>
    private async Task<Dictionary<(int Year, int Round, int Office), bool>> CoverageByOfficeAsync(
        string uf, IReadOnlyList<PartyOfficeRow> rows, CancellationToken ct)
    {
        var result = new Dictionary<(int, int, int), bool>();
        foreach (var office in rows.Select(r => r.OfficeCode).Distinct())
        {
            var cov = await rankings.CoverageAsync(office, uf, null, ct);
            foreach (var g in cov.GroupBy(c => ((int)c.Year, (int)c.Round)))
                result[(g.Key.Item1, g.Key.Item2, office)] = g.All(c => c.ZonesExpected > 0 && c.ZonesCovered >= c.ZonesExpected);
        }
        return result;
    }

    private static IReadOnlyList<PartyElectionDto> Elections(
        IReadOnlyList<PartyOfficeRow> rows, Dictionary<(int Year, int Round, int Office), bool> coverage) =>
        rows.GroupBy(r => ((int)r.Year, (int)r.Round))
            .OrderByDescending(g => g.Key.Item1).ThenBy(g => g.Key.Item2)
            .Select(g => new PartyElectionDto(g.Key.Item1, g.Key.Item2,
                g.GroupBy(r => r.OfficeCode).OrderBy(o => OfficeOrder(o.Key))
                    .Select(o => new PartyOfficeRefDto(o.Key, o.First().OfficeName, o.Any(r => r.ValidVotes is not null)))
                    .ToList()))
            .ToList();

    private static int OfficeOrder(int office) => office switch { 1 => 0, 3 => 1, 5 => 2, 6 => 3, 7 => 4, 8 => 5, 11 => 6, 13 => 7, _ => 9 };

    private static PartySummaryDto Summary(
        string slug, IReadOnlyList<PartyOfficeRow> mine, IReadOnlyList<PartyOfficeRow> all,
        Dictionary<(int Year, int Round, int Office), bool> coverage)
    {
        var latest = mine.OrderByDescending(r => r.Year).ThenByDescending(r => r.Round).First();
        var results = mine
            .GroupBy(r => (r.Year, r.Round, r.OfficeCode))
            .Select(g => Result(g.ToList(), slug, all, coverage))
            .OrderByDescending(r => r.Year).ThenBy(r => r.Round).ThenBy(r => OfficeOrder(r.OfficeCode))
            .ToList();
        return new PartySummaryDto(
            slug, latest.PartyAcronym!.Trim(), mine.Where(r => r.PartyName is not null).OrderByDescending(r => r.Year).Select(r => r.PartyName).FirstOrDefault(),
            mine.Select(r => r.PartyNumber).Distinct().Order().ToList(), results);
    }

    /// <summary>Uma linha por eleição × cargo (números diferentes da mesma sigla na mesma eleição somam).</summary>
    private static PartyResultDto Result(
        IReadOnlyList<PartyOfficeRow> g, string slug, IReadOnlyList<PartyOfficeRow> all,
        Dictionary<(int Year, int Round, int Office), bool> coverage)
    {
        var first = g[0];
        var votes = Sum(g.Select(Votes));
        var valid = first.ValidVotes;
        var result = new PartyResultDto(
            first.Year, first.Round, first.OfficeCode, first.OfficeName, g.OrderByDescending(r => r.Candidacies).First().PartyNumber,
            JoinFederations(g.Select(r => r.Federations)), votes,
            valid is null ? null : g.Sum(r => r.NominalVotes ?? 0),
            valid is null || !IsProportional(first.OfficeCode) ? null : g.Sum(r => r.LegendVotes ?? 0),
            valid, votes is { } v ? Comparability.Pct(v, valid) : null,
            g.Sum(r => r.Candidacies), g.Sum(r => r.Elected), g.Max(r => r.MunicipalitiesWithVotes), first.MunicipalitiesCovered, null);
        return result with { Change = Change(result, slug, all, coverage) };
    }

    /// <summary>Eleição anterior importada do MESMO cargo e turno; só com BU completo nas duas.</summary>
    private static PartyChangeDto? Change(
        PartyResultDto now, string slug, IReadOnlyList<PartyOfficeRow> all, Dictionary<(int Year, int Round, int Office), bool> coverage)
    {
        var previousYear = all
            .Where(r => r.OfficeCode == now.OfficeCode && r.Round == now.Round && r.Year < now.Year)
            .Select(r => (int)r.Year).DefaultIfEmpty(0).Max();
        if (previousYear == 0) return null;
        var before = all.Where(r => r.Year == previousYear && r.Round == now.Round && r.OfficeCode == now.OfficeCode && Slug(r.PartyAcronym) == slug).ToList();
        var complete = coverage.GetValueOrDefault((now.Year, now.Round, now.OfficeCode)) && coverage.GetValueOrDefault((previousYear, now.Round, now.OfficeCode));
        if (before.Count == 0)
            return new PartyChangeDto(previousYear, now.Round, 0, null, null, 0, null, null, null, "absent",
                $"A sigla não teve candidaturas nem votos neste cargo em {previousYear}.");
        var fromVotes = Sum(before.Select(Votes));
        var fromValid = before[0].ValidVotes;
        var fromShare = fromVotes is { } fv ? Comparability.Pct(fv, fromValid) : null;
        var fromNumber = before.OrderByDescending(r => r.Candidacies).First().PartyNumber;
        var fromElected = before.Sum(r => r.Elected);
        if (!complete || now.Votes is null || fromVotes is null)
            return new PartyChangeDto(previousYear, now.Round, fromNumber, fromVotes, fromShare, fromElected, null, null, null, "coverage_incomplete",
                "Boletim de Urna incompleto em uma das eleições: sem variação.");
        var (delta, percent) = Comparability.Delta(fromVotes, now.Votes);
        return new PartyChangeDto(previousYear, now.Round, fromNumber, fromVotes, fromShare, fromElected, delta, percent,
            Comparability.DeltaPoints(fromShare, now.Share), "comparable",
            fromNumber == now.PartyNumber ? "Mesmo cargo e turno, Boletim de Urna completo nas duas eleições."
                : $"Mesmo cargo e turno; a sigla usou o número {fromNumber} em {previousYear} e {now.PartyNumber} em {now.Year}.");
    }

    private static PartyResultDto? Pick(IReadOnlyList<PartyResultDto> results, int? year, int? round, int? office)
    {
        var candidates = results.Where(r =>
            (year is null || r.Year == year) && (round is null || r.Round == round) && (office is null || r.OfficeCode == office)).ToList();
        return candidates
            .OrderByDescending(r => r.Votes is not null)
            .ThenByDescending(r => r.Year).ThenBy(r => r.Round)
            .ThenByDescending(r => r.Votes ?? -1)
            .FirstOrDefault();
    }

    private async Task<PartyDetailDto> DetailAsync(string uf, PartyResultDto pick, IReadOnlyList<PartyOfficeRow> mine, CancellationToken ct)
    {
        var (year, round, office) = (pick.Year, pick.Round, pick.OfficeCode);
        // todos os números da sigla naquela eleição e cargo (normalmente um só)
        var numbers = mine.Where(r => r.Year == year && r.Round == round && r.OfficeCode == office)
            .Select(r => r.PartyNumber).Distinct().Order().ToList();
        var territories = await repo.TerritoriesAsync(uf, year, round, office, numbers, null, ct);
        var candidates = await repo.CandidatesAsync(uf, year, round, office, numbers, null, TopCandidates, ct);
        var cov = (await rankings.CoverageAsync(office, uf, null, ct)).Where(c => c.Year == year && c.Round == round).ToList();
        var expected = cov.Sum(c => c.ZonesExpected);
        var covered = cov.Sum(c => c.ZonesCovered);
        var coverage = cov.Count == 0 ? null : new RankingCoverageDto(covered, expected, expected > 0 && covered >= expected,
            covered >= expected ? "Cobertura completa do Boletim de Urna." : $"Cobertura parcial: {covered} de {expected} zonas com Boletim de Urna.");

        var municipal = IsMunicipalOffice(office);
        var considered = territories
            .Where(t => !municipal || t.Candidacies is > 0)
            .Select(t =>
            {
                var votes = t.NominalVotes + (IsProportional(office) ? t.LegendVotes : 0);
                return new PartyTerritoryDto(t.MunicipalityTseCode, t.MunicipalityName ?? t.MunicipalityTseCode, t.MunicipalitySlug, t.Zone,
                    votes, t.ValidVotes, Comparability.Pct(votes, t.ValidVotes), t.Candidacies, t.Elected);
            })
            .Where(t => t.Share is not null)
            .ToList();
        var strongest = considered.OrderByDescending(t => t.Share).ThenByDescending(t => t.Votes).ThenBy(t => t.Name, StringComparer.Ordinal)
            .Take(TopTerritories).ToList();
        var strongestKeys = strongest.Select(t => t.MunicipalityTseCode).ToHashSet();
        var weakest = considered.Where(t => !strongestKeys.Contains(t.MunicipalityTseCode))
            .OrderBy(t => t.Share).ThenBy(t => t.Votes).ThenBy(t => t.Name, StringComparer.Ordinal)
            .Take(TopTerritories).ToList();
        var items = candidates.Select(c => new PartyCandidateDto(
            c.CandidacyId, c.PoliticianId, c.Slug, Fmt.Name(c.BallotName), c.CandidateNumber, c.UnitName, c.HasLink ? c.Votes : null,
            c.Elected, c.RoundOutcome is null ? null : Fmt.Outcome(c.RoundOutcome))).ToList();
        var note = municipal
            ? "Cada município é uma disputa: participação calculada só onde o partido teve candidatura; os mais votados da lista disputaram em municípios diferentes."
            : "Participação do partido em cada município do estado (o partido estava na urna em todos).";
        return new PartyDetailDto(year, round, office, pick.OfficeName, numbers, strongest, weakest,
            considered.Count(t => t.Votes > 0), considered.Count, items, coverage, note);
    }

    private static long? Sum(IEnumerable<long?> values)
    {
        long total = 0;
        var any = false;
        foreach (var v in values)
        {
            if (v is null) continue;
            total += v.Value;
            any = true;
        }
        return any ? total : null;
    }

    private static string? JoinFederations(IEnumerable<string?> values)
    {
        var list = values.Where(v => !string.IsNullOrWhiteSpace(v))
            .SelectMany(v => v!.Split(", ", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        return list.Count == 0 ? null : string.Join(", ", list);
    }
}
