using System.Text.RegularExpressions;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Resolução territorial genérica: eleição → UF → município → zona → seção, sempre pelo catálogo
/// (banco). Nenhum município é especial. Cadastro ausente ≠ território inexistente
/// (status "cadaster_missing", não 404).
/// </summary>
public partial class ElectoralCatalogService(IElectoralReadRepository repo)
{
    public const string Available = "available";
    public const string CadasterMissing = "cadaster_missing";

    internal static ElectionRefDto ElectionView(ElectionRow e) => new(e.Year, e.Round, e.ElectionDate, e.Description);

    internal static StateDto StateView(StateRow s) => new(
        s.Uf, s.Uf.ToLowerInvariant(), s.Name, s.IbgeCode, true, s.Municipalities,
        s.CadasterMunicipalities > 0, s.CadasterMunicipalities, s.ResultsMunicipalities > 0, s.ResultsMunicipalities);

    internal static MunicipalityDto MunicipalityView(MunicipalityRow m) => new(
        m.TseCode, m.IbgeCode, m.Name, m.Slug, m.Uf, true, m.Zones > 0, m.ResultsZones > 0, m.Zones);

    internal static ZoneDto ZoneView(ZoneRow z) => new(
        z.Number, z.Sections, z.PrincipalSections, z.AggregatedSections, z.PollingPlaces,
        z.PollingPlacesWithCoordinates, new EligibleDto(z.EligibleFederal, z.EligibleState), z.ResultsAvailable);

    internal static SectionDto SectionView(SectionRow s, IReadOnlyList<int> aggregated) => new(
        s.Number, s.PrincipalNumber, s.IsAggregated, s.PlaceCode, s.IsAggregated ? [] : aggregated,
        // aptos da URNA (principal, após agregações); null em agregadas — nunca zero presumido
        s.IsAggregated ? null : new EligibleDto(s.EligibleFederal, s.EligibleState));

    internal static CoordinatesDto? Coordinates(PlaceRow p) =>
        // só coordenadas publicadas pela fonte oficial; nenhuma é estimada
        p.Latitude is { } lat && p.Longitude is { } lon ? new CoordinatesDto(lat, lon, p.CoordinatesSource) : null;

    internal static CadasterProvenanceDto? ProvenanceView(CadasterProvenanceRow? p) => p is null
        ? null
        : new CadasterProvenanceDto(
            "Tribunal Superior Eleitoral · Dados Abertos", p.Dataset, p.ResourceId, p.ResourceName, p.Url,
            p.ZipSha256, p.ChecksumStatus, p.CsvName, p.CsvSha256, p.SourceGeneratedAt, p.ImportedAt, p.ImportBatchId);

    /// <summary>Soma que preserva o desconhecido: qualquer null ⇒ null.</summary>
    public static int? SumOrNull(IEnumerable<int?> values)
    {
        var total = 0;
        foreach (var v in values)
        {
            if (v is null) return null;
            total += v.Value;
        }

        return total;
    }

    public async Task<ElectionsResponse> ElectionsAsync(CancellationToken ct)
    {
        var rows = await repo.ElectionsAsync(ct);
        // padrão: a eleição mais recente com resultados; senão a mais recente com cadastro
        var preferred = rows.FirstOrDefault(e => e.ResultsMunicipalities > 0)
            ?? rows.FirstOrDefault(e => e.CadasterMunicipalities > 0)
            ?? rows.FirstOrDefault();
        return new ElectionsResponse(rows.Select(e => new ElectionDto(
            e.Year, e.Round, e.ElectionDate, e.Description, e.CadasterMunicipalities > 0, e.ResultsMunicipalities > 0,
            ReferenceEquals(e, preferred))).ToList());
    }

    public async Task<ElectionRow> ElectionAsync(int year, int round, CancellationToken ct) =>
        await repo.ElectionAsync(year, round, ct)
        ?? throw new ElectoralNotFoundException($"Eleição {year}/{round} não disponível.");

    public async Task<(ElectionRow Election, StateRow State)> StateAsync(int year, int round, string uf, CancellationToken ct)
    {
        if (!UfPattern().IsMatch(uf)) throw new ElectoralNotFoundException($"UF {uf} não existe.");
        var election = await ElectionAsync(year, round, ct);
        var state = await repo.StateAsync(election.Id, uf.ToUpperInvariant(), ct)
            ?? throw new ElectoralNotFoundException($"UF {uf} não existe.");
        return (election, state);
    }

    public async Task<(ElectionRow Election, StateRow State, MunicipalityRow Municipality)> MunicipalityAsync(
        int year, int round, string uf, string municipality, CancellationToken ct)
    {
        var (election, state) = await StateAsync(year, round, uf, ct);
        var key = municipality.ToLowerInvariant();
        IReadOnlyList<MunicipalityRow> rows = KeyPattern().IsMatch(key)
            ? await repo.MunicipalityAsync(election.Id, state.Uf, key, ct)
            : [];
        if (rows.Count > 1) throw new ElectoralIntegrityException($"Chave de município ambígua: {municipality} em {state.Uf}.");
        var row = rows.Count == 1 ? rows[0] : throw new ElectoralNotFoundException($"Município {municipality} não existe em {state.Uf}.");
        return (election, state, row);
    }

    public async Task<StatesResponse> StatesAsync(int year, int round, CancellationToken ct)
    {
        var election = await ElectionAsync(year, round, ct);
        var states = await repo.StatesAsync(election.Id, ct);
        return new StatesResponse(ElectionView(election), states.Select(StateView).ToList());
    }

    public async Task<MunicipalitiesResponse> MunicipalitiesAsync(int year, int round, string uf, string? q, CancellationToken ct)
    {
        var (election, state) = await StateAsync(year, round, uf, ct);
        var query = q?.Trim();
        var rows = string.IsNullOrEmpty(query)
            ? await repo.MunicipalitiesAsync(election.Id, state.Uf, null, null, ct)
            : await repo.MunicipalitiesAsync(election.Id, state.Uf, Slug.From(query), DigitsPattern().IsMatch(query) ? query : "", ct);
        return new MunicipalitiesResponse(
            ElectionView(election), StateView(state), state.CadasterMunicipalities > 0 ? Available : CadasterMissing,
            rows.Select(MunicipalityView).ToList());
    }

    public async Task<MunicipalityDetailResponse> MunicipalityDetailAsync(
        int year, int round, string uf, string municipality, CancellationToken ct)
    {
        var (election, state, m) = await MunicipalityAsync(year, round, uf, municipality, ct);
        if (m.Zones == 0)
        {
            return new MunicipalityDetailResponse(
                ElectionView(election), StateView(state), MunicipalityView(m), CadasterMissing, [], null, null);
        }

        var zones = await repo.ZonesAsync(election.Id, m.Id, ct);
        var provenance = await repo.CadasterProvenanceAsync(election.Id, m.Id, ct);
        var summary = new MunicipalitySummaryDto(
            zones.Count, zones.Sum(z => z.Sections), zones.Sum(z => z.PrincipalSections), zones.Sum(z => z.AggregatedSections),
            zones.Sum(z => z.PollingPlaces), zones.Sum(z => z.PollingPlacesWithCoordinates),
            new EligibleDto(SumOrNull(zones.Select(z => z.EligibleFederal)), SumOrNull(zones.Select(z => z.EligibleState))));
        return new MunicipalityDetailResponse(
            ElectionView(election), StateView(state), MunicipalityView(m), Available, zones.Select(ZoneView).ToList(),
            summary, ProvenanceView(provenance));
    }

    public async Task<ZoneContext> ZoneAsync(int year, int round, string uf, string municipality, int zone, CancellationToken ct)
    {
        var (election, state, m) = await MunicipalityAsync(year, round, uf, municipality, ct);
        if (m.Zones == 0) return new ZoneContext(election, state, m, null, CadasterMissing);
        var zones = await repo.ZonesAsync(election.Id, m.Id, ct);
        var z = zones.FirstOrDefault(x => x.Number == zone)
            ?? throw new ElectoralNotFoundException($"Zona {zone} não existe em {m.Name}.");
        return new ZoneContext(election, state, m, z, Available);
    }

    /// <summary>Principal → agregadas (ordenadas), a partir do cadastro.</summary>
    public static Dictionary<int, List<int>> Aggregation(IEnumerable<SectionRow> sections) =>
        sections.Where(s => s.IsAggregated)
            .GroupBy(s => s.PrincipalNumber)
            .ToDictionary(g => g.Key, g => g.Select(s => s.Number).OrderBy(n => n).ToList());

    /// <summary>Locais com suas seções: cada principal seguida das suas agregadas.</summary>
    public static IReadOnlyList<PlaceDto> PlacesWithSections(IReadOnlyList<PlaceRow> places, IReadOnlyList<SectionRow> sections)
    {
        var agg = Aggregation(sections);
        var byPlace = sections.GroupBy(s => s.PlaceCode).ToDictionary(g => g.Key, g => g.ToList());
        return places.Select(place =>
        {
            var own = byPlace.GetValueOrDefault(place.Code) ?? [];
            var ordered = new List<SectionRow>();
            foreach (var s in own.Where(x => !x.IsAggregated))
            {
                ordered.Add(s);
                ordered.AddRange(own.Where(x => x.IsAggregated && x.PrincipalNumber == s.Number));
            }

            // agregada cuja principal está em outro local
            ordered.AddRange(own.Where(s => !ordered.Contains(s)));
            return new PlaceDto(
                place.Code, place.Name, place.Address, place.Neighborhood, place.PostalCode, place.PlaceType,
                Coordinates(place),
                ordered.Select(s => SectionView(s, agg.GetValueOrDefault(s.Number) ?? [])).ToList());
        }).ToList();
    }

    public async Task<ZoneDetailResponse> ZoneDetailAsync(
        int year, int round, string uf, string municipality, int zone, CancellationToken ct)
    {
        var ctx = await ZoneAsync(year, round, uf, municipality, zone, ct);
        if (ctx.Zone is null)
        {
            return new ZoneDetailResponse(
                ElectionView(ctx.Election), StateView(ctx.State), MunicipalityView(ctx.Municipality), ctx.Status, null, [], null);
        }

        var sections = await repo.SectionsAsync(ctx.Election.Id, ctx.Municipality.Id, zone, ct);
        var places = await repo.PlacesAsync(ctx.Election.Id, ctx.Municipality.Id, zone, ct);
        var provenance = await repo.CadasterProvenanceAsync(ctx.Election.Id, ctx.Municipality.Id, ct);
        return new ZoneDetailResponse(
            ElectionView(ctx.Election), StateView(ctx.State), MunicipalityView(ctx.Municipality), ctx.Status,
            ZoneView(ctx.Zone), PlacesWithSections(places, sections), ProvenanceView(provenance));
    }

    /// <summary>Seção pedida → registro do cadastro, urna principal e agregadas.</summary>
    public async Task<SectionContext> SectionAsync(
        int year, int round, string uf, string municipality, int zone, int section, CancellationToken ct)
    {
        var ctx = await ZoneAsync(year, round, uf, municipality, zone, ct);
        if (ctx.Zone is null) return new SectionContext(ctx, null, null, []);
        var sections = await repo.SectionsAsync(ctx.Election.Id, ctx.Municipality.Id, zone, ct);
        var record = sections.FirstOrDefault(s => s.Number == section)
            ?? throw new ElectoralNotFoundException($"Seção {section} não existe na zona {zone}.");
        var principal = record.IsAggregated ? record.PrincipalNumber : record.Number;
        var aggregated = sections.Where(s => s.IsAggregated && s.PrincipalNumber == principal)
            .Select(s => s.Number).OrderBy(n => n).ToList();
        return new SectionContext(ctx, record, principal, aggregated);
    }

    [GeneratedRegex("^[a-zA-Z]{2}$")]
    private static partial Regex UfPattern();

    [GeneratedRegex("^[a-z0-9-]{1,80}$")]
    private static partial Regex KeyPattern();

    [GeneratedRegex(@"^\d+$")]
    private static partial Regex DigitsPattern();
}

public record ZoneContext(ElectionRow Election, StateRow State, MunicipalityRow Municipality, ZoneRow? Zone, string Status);

public record SectionContext(ZoneContext Zone, SectionRow? Record, int? Principal, IReadOnlyList<int> Aggregated);
