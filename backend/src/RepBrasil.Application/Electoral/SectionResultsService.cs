using System.Text.RegularExpressions;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Resultado oficial de uma seção, para qualquer município do catálogo. Território e agregação vêm do
/// cadastro canônico; seção agregada responde com o resultado da urna principal (nunca votos próprios,
/// nunca duplicados). Votáveis nominais trazem a candidatura oficial quando o vínculo existe — a
/// ausência de vínculo nunca altera os votos.
/// </summary>
public partial class SectionResultsService(IElectoralReadRepository repo, ElectoralCatalogService catalog)
{
    public const string NotIngested = "not_ingested";

    public static ResultFiltersDto ParseFilters(string? office, string? candidate, string? party, string? voteType)
    {
        static int? Int(string name, string? v)
        {
            if (string.IsNullOrEmpty(v)) return null;
            if (!PositiveInt().IsMatch(v) || !int.TryParse(v, out var n))
                throw new ElectoralBadRequestException($"{name} deve ser um inteiro positivo.");
            return n;
        }

        var type = string.IsNullOrEmpty(voteType) ? null : voteType;
        if (type is not null && !ResultsAssembler.VoteTypeParam.ContainsKey(type))
        {
            throw new ElectoralBadRequestException(
                $"voteType deve ser um de: {string.Join(", ", ResultsAssembler.VoteTypeParam.Keys)}.");
        }

        return new ResultFiltersDto(Int("office", office), Int("candidate", candidate), Int("party", party), type);
    }

    public async Task<SectionResultsResponse> ExecuteAsync(
        int year, int round, string uf, string municipality, int zone, int section, ResultFiltersDto filters,
        CancellationToken ct)
    {
        var t = await catalog.SectionAsync(year, round, uf, municipality, zone, section, ct);
        var m = t.Zone.Municipality;
        var election = ElectoralCatalogService.ElectionView(t.Zone.Election);
        var territory = new TerritoryRefDto(t.Zone.State.Uf, new MunicipalityRefDto(m.TseCode, m.IbgeCode, m.Name, m.Slug), zone);

        // território válido sem cadastro eleitoral: explícito, nunca inferido
        if (t.Record is null || t.Principal is null)
            return new SectionResultsResponse(election, territory, section, ElectoralCatalogService.CadasterMissing);

        var principal = t.Principal.Value;
        var batch = await repo.LatestBatchAsync(year, round, t.Zone.State.Uf, m.TseCode, zone, ct);
        if (batch is null)
        {
            return new SectionResultsResponse(election, territory, section, NotIngested,
                principal, t.Record.IsAggregated, t.Aggregated);
        }

        // A fonte precisa concordar com o cadastro sobre a agregação.
        if (t.Record.IsAggregated)
        {
            var fromSource = await repo.PrincipalsForAsync(batch.BatchId, m.TseCode, zone, section, ct);
            if (fromSource.Count != 1 || fromSource[0] != principal)
            {
                throw new ElectoralIntegrityException(
                    $"Divergência de agregação na seção {section}: fonte [{string.Join(",", fromSource)}], cadastro {principal}.");
            }
        }

        var urns = await repo.UrnOfficesAsync(batch.BatchId, m.TseCode, zone, principal, ct);
        if (urns.Count == 0)
        {
            return new SectionResultsResponse(election, territory, section, NotIngested,
                principal, t.Record.IsAggregated, t.Aggregated);
        }

        var offices = urns.Select(u => new OfficeDto(u.OfficeCode, u.OfficeName, u.ElectionCode)).ToList();
        var selected = filters.Office is null ? urns[0] : urns.FirstOrDefault(u => u.OfficeCode == filters.Office)
            ?? throw new ElectoralBadRequestException($"O cargo {filters.Office} não tem resultado nesta seção.");

        var votes = await repo.VotesAsync(selected.ResultId, t.Zone.State.Uf, ct);
        var available = ResultsAssembler.AvailableFilters(votes);
        if (filters.Candidate is { } c && available.Candidates.All(x => x.Number != c))
            throw new ElectoralBadRequestException($"O candidato {c} não tem votos para este cargo nesta seção.");
        if (filters.Party is { } p && available.Parties.All(x => x.Number != p))
            throw new ElectoralBadRequestException($"O partido {p} não tem votos para este cargo nesta seção.");

        var metrics = ResultsAssembler.Metrics(selected, votes);
        return new SectionResultsResponse(
            election, territory, section, ElectoralCatalogService.Available,
            principal, t.Record.IsAggregated, t.Aggregated,
            offices,
            new SelectedOfficeDto(selected.OfficeCode, selected.OfficeName, selected.ElectionCode, selected.ElectionDescription),
            metrics,
            new PercentageBasisDto("valid_votes", "votos nominais + votos de legenda da urna para o cargo selecionado",
                ["nominal", "legenda"]),
            ResultsAssembler.VoteItems(ResultsAssembler.Filter(votes, filters), metrics.Valid),
            new FiltersDto(filters, available),
            new UrnDto(selected.UrnNumber, selected.UrnTypeDescription, selected.BuEmittedAt, selected.BuReceivedAt,
                selected.PollingPlaceCode),
            ResultsAssembler.Provenance(batch, principal));
    }

    [GeneratedRegex(@"^\d+$")]
    private static partial Regex PositiveInt();
}
