using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Comparação descritiva de candidaturas sobre fatos do TSE. Não produz avaliação, previsão,
/// causalidade ou Score. Todas as diferenças são reproduzíveis a partir dos BUs vigentes.
/// </summary>
public class ElectoralComparisonService(
    IElectoralReadRepository electoral,
    IElectoralComparisonRepository comparison)
{
    public const int MaxCandidates = 5;

    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["votes"] = "fato: votos nominais da candidatura no Boletim de Urna vigente do território",
        ["shareOfValidVotes"] = "métrica derivada: votos da candidatura ÷ votos válidos (nominais + legenda) do mesmo cargo e território",
        ["higherLowerTie"] = "comparação descritiva de votos brutos entre duas candidaturas no mesmo território; não implica causa, preferência futura ou avaliação",
        ["sectionIdentity"] = "seção histórica = UF + município TSE + zona + número da seção; o número físico da urna eletrônica não é usado como identidade temporal",
        ["sectionComparable"] = "comparável em nível de seção apenas quando principal + seções agregadas representam o mesmo conjunto nas eleições comparadas",
        ["coverageMissing"] = "ausência de BU/cobertura/seção em uma das candidaturas não é convertida em zero e fica fora do comparativo",
    };

    public static ComparisonLevel ParseLevel(string? level) => (level ?? "municipality").Trim().ToLowerInvariant() switch
    {
        "municipality" or "municipio" or "município" => ComparisonLevel.Municipality,
        "zone" or "zona" => ComparisonLevel.Zone,
        "section" or "secao" or "seção" or "urna" => ComparisonLevel.Section,
        _ => throw new ElectoralBadRequestException("level deve ser municipality, zone ou section."),
    };

    public async Task<ElectoralComparisonResponse> ExecuteAsync(
        IReadOnlyList<Guid> candidacyIds,
        string uf,
        string? municipalityTseCode,
        int? zone,
        ComparisonLevel level,
        CancellationToken ct)
    {
        var ids = candidacyIds.Distinct().ToArray();
        if (ids.Length == 0 || ids.Length > MaxCandidates)
            throw new ElectoralBadRequestException($"Selecione de 1 a {MaxCandidates} candidaturas.");
        if (ids.Length != candidacyIds.Count)
            throw new ElectoralBadRequestException("A mesma candidatura não pode ser selecionada mais de uma vez.");

        uf = uf.Trim().ToUpperInvariant();
        if (uf.Length != 2) throw new ElectoralBadRequestException("UF inválida.");
        municipalityTseCode = string.IsNullOrWhiteSpace(municipalityTseCode) ? null : municipalityTseCode.Trim();
        if (level is ComparisonLevel.Zone or ComparisonLevel.Section && municipalityTseCode is null)
            throw new ElectoralBadRequestException("Comparação por zona/seção exige município.");
        if (level == ComparisonLevel.Section && zone is null)
            throw new ElectoralBadRequestException("Comparação por seção exige zona.");

        var candidates = new List<CandidacyRow>(ids.Length);
        foreach (var id in ids)
        {
            var candidate = await electoral.CandidacyAsync(id, ct)
                ?? throw new ElectoralNotFoundException($"Candidatura {id} não encontrada.");
            if (!candidate.HasVotes)
                throw new ElectoralBadRequestException(
                    $"A candidatura {candidate.BallotName} ({candidate.Year}) ainda não possui vínculo auditado com votos do BU.");
            candidates.Add(candidate);
        }

        var officeCodes = candidates.Select(c => c.OfficeCode).Distinct().ToArray();
        if (officeCodes.Length != 1)
            throw new ElectoralBadRequestException(
                "Comparação direta de votação exige o mesmo cargo. Cargos diferentes permanecem disponíveis na linha do tempo do perfil, sem delta direto.");

        var rows = await comparison.SectionsAsync(ids, uf, municipalityTseCode, zone, ct);
        var territories = level switch
        {
            ComparisonLevel.Municipality => AggregateMunicipalities(rows, ids),
            ComparisonLevel.Zone => AggregateZones(rows, ids),
            ComparisonLevel.Section => AggregateSections(rows, ids),
            _ => throw new ElectoralBadRequestException("Nível de comparação inválido."),
        };

        var candidateViews = candidates
            .OrderBy(c => c.Year).ThenBy(c => c.Round).ThenBy(c => c.CandidateNumber)
            .Select(c => new ComparisonCandidateDto(
                c.Id, c.PersonId, c.PoliticianId, c.Year, c.Round, c.OfficeCode, c.OfficeName,
                c.CandidateNumber, c.BallotName,
                c.PartyNumber is null && c.PartyAcronym is null ? null : new PartyDto(c.PartyNumber, c.PartyAcronym, c.PartyName)))
            .ToList();

        return new ElectoralComparisonResponse(
            level, uf, municipalityTseCode, zone, candidateViews, territories,
            Pairwise(territories, ids), Definitions);
    }

    private static ComparisonValueDto Value(Guid id, IEnumerable<CandidacySectionComparisonRow> rows)
    {
        var list = rows.ToList();
        var votes = list.Sum(r => r.Votes);
        long? valid = list.All(r => r.ValidVotes is not null) ? list.Sum(r => r.ValidVotes!.Value) : null;
        var share = valid is > 0
            ? Math.Round(votes * 10000.0 / valid.Value, MidpointRounding.AwayFromZero) / 100
            : null;
        return new ComparisonValueDto(id, votes, valid, share);
    }

    private static IReadOnlyList<ComparisonValueDto> Values(
        IEnumerable<CandidacySectionComparisonRow> rows,
        IReadOnlyList<Guid> ids)
    {
        var byId = rows.GroupBy(r => r.CandidacyId).ToDictionary(g => g.Key, g => (IEnumerable<CandidacySectionComparisonRow>)g);
        return ids.Where(byId.ContainsKey).Select(id => Value(id, byId[id])).ToList();
    }

    private static IReadOnlyList<ComparisonTerritoryDto> AggregateMunicipalities(
        IReadOnlyList<CandidacySectionComparisonRow> rows,
        IReadOnlyList<Guid> ids) =>
        rows.GroupBy(r => new { r.Uf, r.MunicipalityTseCode, r.MunicipalityName })
            .Select(g => new ComparisonTerritoryDto(
                g.Key.Uf, g.Key.MunicipalityTseCode, g.Key.MunicipalityName, null, null, null,
                g.Select(r => r.CandidacyId).Distinct().Count() == ids.Count ? "comparable" : "coverage_or_section_missing",
                Values(g, ids)))
            .OrderBy(t => t.MunicipalityName).ThenBy(t => t.MunicipalityTseCode)
            .ToList();

    private static IReadOnlyList<ComparisonTerritoryDto> AggregateZones(
        IReadOnlyList<CandidacySectionComparisonRow> rows,
        IReadOnlyList<Guid> ids) =>
        rows.GroupBy(r => new { r.Uf, r.MunicipalityTseCode, r.MunicipalityName, r.Zone })
            .Select(g => new ComparisonTerritoryDto(
                g.Key.Uf, g.Key.MunicipalityTseCode, g.Key.MunicipalityName, g.Key.Zone, null, null,
                g.Select(r => r.CandidacyId).Distinct().Count() == ids.Count ? "comparable" : "coverage_or_section_missing",
                Values(g, ids)))
            .OrderBy(t => t.MunicipalityName).ThenBy(t => t.Zone)
            .ToList();

    private static IReadOnlyList<ComparisonTerritoryDto> AggregateSections(
        IReadOnlyList<CandidacySectionComparisonRow> rows,
        IReadOnlyList<Guid> ids) =>
        rows.GroupBy(r => new { r.Uf, r.MunicipalityTseCode, r.MunicipalityName, r.Zone, r.Section })
            .Select(g =>
            {
                var candidateCount = g.Select(r => r.CandidacyId).Distinct().Count();
                var memberSets = g.Select(r => string.Join(',', r.SectionMembers)).Distinct(StringComparer.Ordinal).ToArray();
                var status = candidateCount != ids.Count
                    ? "coverage_or_section_missing"
                    : memberSets.Length == 1 ? "comparable" : "section_composition_changed";
                var members = memberSets.Length == 1 ? g.First().SectionMembers : null;
                return new ComparisonTerritoryDto(
                    g.Key.Uf, g.Key.MunicipalityTseCode, g.Key.MunicipalityName, g.Key.Zone, g.Key.Section, members,
                    status, Values(g, ids));
            })
            .OrderBy(t => t.MunicipalityName).ThenBy(t => t.Zone).ThenBy(t => t.Section)
            .ToList();

    private static IReadOnlyList<PairwiseComparisonDto> Pairwise(
        IReadOnlyList<ComparisonTerritoryDto> territories,
        IReadOnlyList<Guid> ids)
    {
        var result = new List<PairwiseComparisonDto>();
        for (var i = 0; i < ids.Count; i++)
        for (var j = i + 1; j < ids.Count; j++)
        {
            var first = ids[i];
            var second = ids[j];
            var comparable = 0;
            var firstHigher = 0;
            var secondHigher = 0;
            var ties = 0;
            var notComparable = 0;

            foreach (var territory in territories)
            {
                if (territory.Comparability != "comparable")
                {
                    notComparable++;
                    continue;
                }
                var a = territory.Values.FirstOrDefault(v => v.CandidacyId == first);
                var b = territory.Values.FirstOrDefault(v => v.CandidacyId == second);
                if (a is null || b is null)
                {
                    notComparable++;
                    continue;
                }
                comparable++;
                if (a.Votes > b.Votes) firstHigher++;
                else if (b.Votes > a.Votes) secondHigher++;
                else ties++;
            }
            result.Add(new PairwiseComparisonDto(first, second, comparable, firstHigher, secondHigher, ties, notComparable));
        }
        return result;
    }
}
