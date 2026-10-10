using System.Text.Json;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Montagem do resultado de uma urna × cargo. Funções puras (portadas do contrato auditado do Urnaí).
///
/// - Métricas estruturais (aptos, comparecimento, abstenções) vêm da urna; null na fonte ⇒ null.
/// - O BU publica só votáveis com votos. Branco, nulo e válidos ausentes só viram 0 quando a
///   contabilidade da urna fecha (soma dos votos = comparecimento): o zero é confirmado pela própria
///   fonte. Caso contrário (ex.: Senador com 2 votos por eleitor), null.
/// - Válidos = nominais + legenda (Lei 9.504/97, art. 5º).
/// - Percentual só para nominal/legenda, sobre os válidos da urna no cargo.
/// </summary>
public static class ResultsAssembler
{
    public static readonly IReadOnlyDictionary<string, string> VoteTypeParam = new Dictionary<string, string>
    {
        ["nominal"] = "candidate",
        ["legenda"] = "party_legend",
        ["branco"] = "blank",
        ["nulo"] = "null",
    };

    private static readonly Dictionary<string, string> VoteTypeLabel = new()
    {
        ["candidate"] = "nominal",
        ["party_legend"] = "legenda",
        ["blank"] = "branco",
        ["null"] = "nulo",
    };

    private static readonly string[] KindOrder = ["candidate", "party_legend", "blank", "null", "technical_null", "other"];
    private static readonly HashSet<string> KnownKinds = ["candidate", "party_legend", "blank", "null"];

    public const string FederationReason = "O Boletim de Urna (Dados Abertos TSE) não publica federação.";

    public static bool AccountingClosed(UrnOfficeRow urn) => urn.Turnout is not null && urn.VotesTotal == urn.Turnout;

    public static MetricsDto Metrics(UrnOfficeRow urn, IReadOnlyList<VoteRow> votes)
    {
        var closed = AccountingClosed(urn);
        int? Sum(params string[] kinds)
        {
            var rows = votes.Where(v => kinds.Contains(v.VoteKind)).ToList();
            if (rows.Count == 0) return closed ? 0 : null;
            return rows.Sum(v => v.Votes);
        }

        var unknownKinds = votes.Any(v => !KnownKinds.Contains(v.VoteKind));
        return new MetricsDto(
            urn.Eligible, urn.Turnout, urn.Abstentions,
            unknownKinds ? null : Sum("candidate", "party_legend"),
            Sum("blank"),
            Sum("null"));
    }

    public static IReadOnlyList<VoteRow> Sort(IEnumerable<VoteRow> votes) =>
        votes.OrderByDescending(v => v.Votes)
             .ThenBy(v => Array.IndexOf(KindOrder, v.VoteKind))
             .ThenBy(v => v.Number)
             .ToList();

    public static IReadOnlyList<VoteRow> Filter(IEnumerable<VoteRow> votes, ResultFiltersDto f) =>
        votes.Where(v =>
            (f.VoteType is null || v.VoteKind == VoteTypeParam[f.VoteType])
            && (f.Candidate is null || (v.VoteKind == "candidate" && v.Number == f.Candidate))
            && (f.Party is null || v.PartyNumber == f.Party))
        .ToList();

    public static AvailableFiltersDto AvailableFilters(IReadOnlyList<VoteRow> votes)
    {
        var candidates = votes.Where(v => v.VoteKind == "candidate")
            .Select(v => new CandidateFilterDto(v.Number, v.Name, v.PartyAcronym))
            .OrderBy(c => c.Number)
            .ToList();
        var parties = votes.Where(v => v.PartyNumber is not null)
            .GroupBy(v => v.PartyNumber!.Value)
            .Select(g => new PartyDto(g.Key, g.Last().PartyAcronym, g.Last().PartyName))
            .OrderBy(p => p.Number)
            .ToList();
        var voteTypes = votes.Select(v => VoteTypeLabel.GetValueOrDefault(v.VoteKind))
            .Where(l => l is not null)
            .Select(l => l!)
            .Distinct()
            .ToList();
        return new AvailableFiltersDto(candidates, parties, voteTypes, new FederationAvailabilityDto(false, FederationReason));
    }

    public static double? Percentage(int votes, int? valid) =>
        valid is > 0 ? Math.Round(votes * 10000.0 / valid.Value, MidpointRounding.AwayFromZero) / 100 : null;

    public static IReadOnlyList<VoteItemDto> VoteItems(IEnumerable<VoteRow> votes, int? valid) =>
        Sort(votes).Select(v =>
        {
            var share = v.VoteKind is "candidate" or "party_legend";
            var candidacy = v.CandidacyId is { } cid && v.TseCandidateId is { } sq
                ? new CandidacyLinkDto(cid, sq, v.PersonId, v.PoliticianId)
                : null;
            return new VoteItemDto(
                VoteTypeLabel.GetValueOrDefault(v.VoteKind) ?? v.VoteKind,
                new VoteTypeSourceDto(v.TypeCode, v.TypeDescription),
                new VotableDto(v.Number, v.Name),
                v.PartyNumber is null ? null : new PartyDto(v.PartyNumber.Value, v.PartyAcronym, v.PartyName),
                v.Votes,
                share ? Percentage(v.Votes, valid) : null,
                candidacy,
                candidacy?.PoliticianId is not null);
        }).ToList();

    public static ResultProvenanceDto Provenance(BatchRow batch, int section)
    {
        var warnings = new List<JsonElement>();
        using (var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(batch.WarningsJson) ? "[]" : batch.WarningsJson))
        {
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var w in doc.RootElement.EnumerateArray())
                {
                    if (w.ValueKind == JsonValueKind.Object
                        && w.TryGetProperty("section", out var s)
                        && s.ValueKind == JsonValueKind.Number
                        && s.GetInt32() == section)
                    {
                        warnings.Add(w.Clone());
                    }
                }
            }
        }

        return new ResultProvenanceDto(
            "Tribunal Superior Eleitoral · Dados Abertos", batch.Dataset, batch.ResourceId, batch.ResourceName, batch.Url,
            batch.ZipSha256, batch.CsvSha256, new OfficialChecksumDto(batch.OfficialChecksumAlgorithm, true),
            batch.SourceGeneratedAt, batch.FinishedAt, batch.BatchId,
            new ValidationDto("passed", batch.Ea20Validation ?? "not_available"), warnings);
    }
}
