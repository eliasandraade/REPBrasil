namespace RepBrasil.Application.DataIntelligence;

public sealed record IndicatorDto(
    string Code,
    string Name,
    string Unit,
    string Provider,
    string Description,
    bool Derived);

public sealed record IndicatorValueDto(
    string IndicatorCode,
    string MunicipalityIbgeCode,
    string MunicipalityName,
    int Period,
    decimal Value,
    string Provider,
    string Dataset,
    DateTimeOffset RetrievedAt);

public sealed record CorrelationPointDto(
    string MunicipalityIbgeCode,
    string MunicipalityName,
    double X,
    double Y);

public sealed record CorrelationResponse(
    string XIndicator,
    string YMetric,
    int Period,
    int N,
    double? Pearson,
    double? Spearman,
    IReadOnlyList<CorrelationPointDto> Points,
    string Methodology,
    string Caveat);

public sealed record ClusterItemDto(
    string MunicipalityIbgeCode,
    string MunicipalityName,
    double Value,
    int Cluster);

public sealed record ClusterResponse(
    string Indicator,
    int Period,
    int K,
    IReadOnlyList<double> Centroids,
    IReadOnlyList<ClusterItemDto> Items,
    string Methodology);

/// <summary>
/// O que está carregado, por UF e por domínio. Linha ausente = nada carregado; a interface nunca deduz
/// cobertura de outra fonte.
/// </summary>
public sealed record DataCoverageResponse(IReadOnlyList<StateCoverageDto> States);

public sealed record StateCoverageDto(
    string Uf,
    string Name,
    int? IbgeCode,
    int Municipalities,
    IReadOnlyList<IndicatorCoverageDto> Socioeconomic,
    IReadOnlyList<ElectionCoverageDto> Elections,
    IReadOnlyList<AmendmentCoverageDto> Amendments);

/// <summary>Indicador com valor carregado num período: quantos municípios da UF têm observação.</summary>
public sealed record IndicatorCoverageDto(string Indicator, int Period, int Municipalities);

/// <summary>Pleito com resultado (Boletim de Urna) carregado: quantos municípios da UF.</summary>
public sealed record ElectionCoverageDto(int Year, int Round, int Municipalities);

/// <summary>
/// Ano com emendas na edição vigente da UF. <c>Amendments</c> conta todas as emendas destinadas à UF, com ou sem
/// município identificado; <c>Municipalities</c> conta só os municípios identificados por código IBGE oficial.
/// </summary>
public sealed record AmendmentCoverageDto(int Year, int Municipalities, int Amendments);

public sealed record CoverageStateRow(string Uf, string Name, int? IbgeCode, int Municipalities);
public sealed record CoverageIndicatorRow(string Uf, string Indicator, int Period, int Municipalities);
public sealed record CoverageElectionRow(string Uf, int Year, int Round, int Municipalities);
public sealed record CoverageAmendmentRow(string Uf, int Year, int Municipalities, int Amendments);

public sealed record CoverageRows(
    IReadOnlyList<CoverageStateRow> States,
    IReadOnlyList<CoverageIndicatorRow> Indicators,
    IReadOnlyList<CoverageElectionRow> Elections,
    IReadOnlyList<CoverageAmendmentRow> Amendments);

public sealed record MatrixIndicatorDto(string Code, string Name, string Unit, int N);

/// <summary>Par de indicadores: só municípios com os dois valores observados entram no N.</summary>
public sealed record MatrixCellDto(string X, string Y, int N, double? Pearson, double? Spearman);

public sealed record CorrelationMatrixResponse(
    string Uf,
    int Period,
    IReadOnlyList<MatrixIndicatorDto> Indicators,
    IReadOnlyList<MatrixCellDto> Cells,
    string Methodology,
    string Caveat);

/// <summary>Uma linha de exportação: o valor e de onde ele veio.</summary>
public sealed record IndicatorExportRow(
    string Uf,
    string MunicipalityIbgeCode,
    string MunicipalityName,
    string IndicatorCode,
    string IndicatorName,
    string Unit,
    int Period,
    decimal Value,
    string Provider,
    string Dataset,
    DateTimeOffset RetrievedAt);

public interface IDataIntelligenceRepository
{
    Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct);
    Task<IReadOnlyList<IndicatorValueDto>> ValuesAsync(string indicator, int? period, string? uf, CancellationToken ct);
    /// <summary>Valores vigentes de todos os indicadores numa UF (e período, se informado).</summary>
    Task<IReadOnlyList<IndicatorValueDto>> StateValuesAsync(string uf, int? period, CancellationToken ct);
    Task<CoverageRows> CoverageAsync(CancellationToken ct);
    Task<IReadOnlyList<CorrelationPointDto>> IndicatorPairsAsync(string xIndicator, string yIndicator, int period, string? uf, CancellationToken ct);
    Task<IReadOnlyList<CorrelationPointDto>> CandidacySharePairsAsync(
        string xIndicator,
        Guid candidacyId,
        int period,
        string uf,
        int year,
        int round,
        int office,
        CancellationToken ct);
}

public sealed class DataIntelligenceService(IDataIntelligenceRepository repository)
{
    public const string CausalityCaveat =
        "Correlação não implica causalidade. O resultado descreve associação nos dados observados e não demonstra efeito causal.";

    public Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct) => repository.CatalogAsync(ct);

    public async Task<DataCoverageResponse> CoverageAsync(CancellationToken ct) => BuildCoverage(await repository.CoverageAsync(ct));

    public static DataCoverageResponse BuildCoverage(CoverageRows rows)
    {
        var indicators = rows.Indicators.ToLookup(r => r.Uf);
        var elections = rows.Elections.ToLookup(r => r.Uf);
        var amendments = rows.Amendments.ToLookup(r => r.Uf);
        return new DataCoverageResponse(rows.States
            .OrderBy(s => s.Uf, StringComparer.Ordinal)
            .Select(s => new StateCoverageDto(
                s.Uf,
                s.Name,
                s.IbgeCode,
                s.Municipalities,
                indicators[s.Uf].OrderBy(r => r.Indicator, StringComparer.Ordinal).ThenByDescending(r => r.Period)
                    .Select(r => new IndicatorCoverageDto(r.Indicator, r.Period, r.Municipalities)).ToList(),
                elections[s.Uf].OrderByDescending(r => r.Year).ThenByDescending(r => r.Round)
                    .Select(r => new ElectionCoverageDto(r.Year, r.Round, r.Municipalities)).ToList(),
                amendments[s.Uf].OrderByDescending(r => r.Year)
                    .Select(r => new AmendmentCoverageDto(r.Year, r.Municipalities, r.Amendments)).ToList()))
            .ToList());
    }

    public async Task<CorrelationMatrixResponse> CorrelationMatrixAsync(string? uf, int period, CancellationToken ct)
    {
        var state = NormalizeUf(uf) ?? throw new ArgumentException("uf is required", nameof(uf));
        if (period is < 1900 or > 2200) throw new ArgumentOutOfRangeException(nameof(period));
        var catalog = await repository.CatalogAsync(ct);
        var values = await repository.StateValuesAsync(state, period, ct);
        return BuildMatrix(state, period, catalog, values);
    }

    /// <summary>Matriz por pares: cada par usa só os municípios com os dois valores (ausência nunca é preenchida).</summary>
    public static CorrelationMatrixResponse BuildMatrix(
        string uf, int period, IReadOnlyList<IndicatorDto> catalog, IReadOnlyList<IndicatorValueDto> values)
    {
        var byIndicator = values
            .Where(v => v.Period == period)
            .GroupBy(v => v.IndicatorCode, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(v => v.MunicipalityIbgeCode, StringComparer.Ordinal).ToDictionary(m => m.Key, m => (double)m.First().Value, StringComparer.Ordinal),
                StringComparer.Ordinal);
        var indicators = catalog.Where(c => byIndicator.ContainsKey(c.Code))
            .Select(c => new MatrixIndicatorDto(c.Code, c.Name, c.Unit, byIndicator[c.Code].Count))
            .ToList();
        var cells = new List<MatrixCellDto>();
        for (var i = 0; i < indicators.Count; i++)
            for (var j = i + 1; j < indicators.Count; j++)
            {
                var a = byIndicator[indicators[i].Code];
                var b = byIndicator[indicators[j].Code];
                var shared = a.Keys.Where(b.ContainsKey).OrderBy(k => k, StringComparer.Ordinal).ToArray();
                var x = shared.Select(k => a[k]).ToArray();
                var y = shared.Select(k => b[k]).ToArray();
                cells.Add(new MatrixCellDto(indicators[i].Code, indicators[j].Code, shared.Length, Pearson(x, y), Spearman(x, y)));
            }
        return new CorrelationMatrixResponse(
            uf,
            period,
            indicators,
            cells,
            "Cada par usa só os municípios com os dois valores observados no período (o N do par). Pearson mede associação linear; Spearman, associação monotônica por postos. Associação perfeita (±1) costuma indicar que um indicador é calculado a partir do outro.",
            CausalityCaveat);
    }

    /// <summary>Valores de um indicador na UF, com a proveniência de cada linha.</summary>
    public async Task<IReadOnlyList<IndicatorExportRow>> ExportAsync(string indicator, int? period, string? uf, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(indicator)) throw new ArgumentException("indicator is required", nameof(indicator));
        var state = NormalizeUf(uf) ?? throw new ArgumentException("uf is required", nameof(uf));
        ValidatePeriod(period);
        var catalog = await repository.CatalogAsync(ct);
        var meta = catalog.FirstOrDefault(c => c.Code == indicator.Trim()) ?? throw new ArgumentException("indicator does not exist", nameof(indicator));
        var rows = await repository.ValuesAsync(meta.Code, period, state, ct);
        return ExportRows(state, rows, catalog);
    }

    /// <summary>Todos os indicadores carregados da UF (e período, se informado), com a proveniência de cada linha.</summary>
    public async Task<IReadOnlyList<IndicatorExportRow>> BulkExportAsync(string? uf, int? period, CancellationToken ct)
    {
        var state = NormalizeUf(uf) ?? throw new ArgumentException("uf is required", nameof(uf));
        ValidatePeriod(period);
        var catalog = await repository.CatalogAsync(ct);
        var rows = await repository.StateValuesAsync(state, period, ct);
        return ExportRows(state, rows, catalog);
    }

    private static List<IndicatorExportRow> ExportRows(string uf, IReadOnlyList<IndicatorValueDto> rows, IReadOnlyList<IndicatorDto> catalog)
    {
        var meta = catalog.ToDictionary(c => c.Code, StringComparer.Ordinal);
        return rows
            .OrderBy(r => r.IndicatorCode, StringComparer.Ordinal)
            .ThenByDescending(r => r.Period)
            .ThenBy(r => r.MunicipalityIbgeCode, StringComparer.Ordinal)
            .Select(r =>
            {
                var indicator = meta.GetValueOrDefault(r.IndicatorCode);
                return new IndicatorExportRow(
                    uf, r.MunicipalityIbgeCode, r.MunicipalityName, r.IndicatorCode, indicator?.Name ?? r.IndicatorCode,
                    indicator?.Unit ?? "", r.Period, r.Value, r.Provider, r.Dataset, r.RetrievedAt);
            })
            .ToList();
    }

    private static void ValidatePeriod(int? period)
    {
        if (period is < 1900 or > 2200) throw new ArgumentOutOfRangeException(nameof(period));
    }

    public Task<IReadOnlyList<IndicatorValueDto>> ValuesAsync(string indicator, int? period, string? uf, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(indicator)) throw new ArgumentException("indicator is required", nameof(indicator));
        return repository.ValuesAsync(indicator.Trim(), period, NormalizeUf(uf), ct);
    }

    public async Task<CorrelationResponse> CorrelationAsync(
        string xIndicator,
        string? yIndicator,
        int period,
        string? uf,
        Guid? candidacyId,
        int? year,
        int? round,
        int? office,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(xIndicator)) throw new ArgumentException("xIndicator is required", nameof(xIndicator));
        if (period < 1900 || period > 2200) throw new ArgumentOutOfRangeException(nameof(period));

        IReadOnlyList<CorrelationPointDto> points;
        string yMetric;
        if (candidacyId is not null)
        {
            if (year is null || round is null || office is null || string.IsNullOrWhiteSpace(uf))
                throw new ArgumentException("candidacy correlation requires uf, year, round and office");
            if (year != period)
                throw new ArgumentException("candidacy correlation requires the socioeconomic period to match the election year");
            points = await repository.CandidacySharePairsAsync(
                xIndicator.Trim(), candidacyId.Value, period, NormalizeUf(uf)!, year.Value, round.Value, office.Value, ct);
            yMetric = "candidacy_share";
        }
        else
        {
            if (string.IsNullOrWhiteSpace(yIndicator)) throw new ArgumentException("yIndicator is required when candidacyId is absent", nameof(yIndicator));
            points = await repository.IndicatorPairsAsync(xIndicator.Trim(), yIndicator.Trim(), period, NormalizeUf(uf), ct);
            yMetric = yIndicator.Trim();
        }

        var x = points.Select(p => p.X).ToArray();
        var y = points.Select(p => p.Y).ToArray();
        return new CorrelationResponse(
            xIndicator.Trim(),
            yMetric,
            period,
            points.Count,
            Pearson(x, y),
            Spearman(x, y),
            points,
            "Pearson mede associação linear; Spearman mede associação monotônica por postos. Somente municípios com os dois valores observados entram no N.",
            CausalityCaveat);
    }

    public async Task<ClusterResponse> ClustersAsync(string indicator, int period, string? uf, int k, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(indicator)) throw new ArgumentException("indicator is required", nameof(indicator));
        if (k is < 2 or > 6) throw new ArgumentOutOfRangeException(nameof(k), "k must be between 2 and 6");
        var rows = await repository.ValuesAsync(indicator.Trim(), period, NormalizeUf(uf), ct);
        if (rows.Count == 0)
            return new ClusterResponse(indicator.Trim(), period, k, [], [], "K-means unidimensional determinístico; sem observações para o recorte.");

        var values = rows.Select(r => (double)r.Value).ToArray();
        var centroids = InitializeCentroids(values, k);
        var assignments = new int[values.Length];
        Array.Fill(assignments, -1);

        for (var iteration = 0; iteration < 100; iteration++)
        {
            var changed = false;
            for (var i = 0; i < values.Length; i++)
            {
                var cluster = Nearest(values[i], centroids);
                if (assignments[i] == cluster) continue;
                assignments[i] = cluster;
                changed = true;
            }

            var next = (double[])centroids.Clone();
            for (var cluster = 0; cluster < k; cluster++)
            {
                var bucket = Enumerable.Range(0, values.Length).Where(i => assignments[i] == cluster).Select(i => values[i]).ToArray();
                if (bucket.Length > 0) next[cluster] = bucket.Average();
            }
            centroids = next;
            if (!changed) break;
        }

        var order = centroids.Select((value, index) => (value, index)).OrderBy(x => x.value).ToArray();
        var remap = order.Select((entry, rank) => (entry.index, rank)).ToDictionary(x => x.index, x => x.rank);
        var sortedCentroids = order.Select(x => x.value).ToArray();
        var items = rows.Select((row, i) => new ClusterItemDto(
            row.MunicipalityIbgeCode,
            row.MunicipalityName,
            values[i],
            remap[assignments[i]])).OrderBy(x => x.Cluster).ThenBy(x => x.MunicipalityName).ToArray();

        return new ClusterResponse(
            indicator.Trim(),
            period,
            k,
            sortedCentroids,
            items,
            "K-means unidimensional determinístico: centróides iniciais por quantis ordenados, desempate pelo menor índice e no máximo 100 iterações.");
    }

    public static double? Pearson(IReadOnlyList<double> x, IReadOnlyList<double> y)
    {
        if (x.Count != y.Count || x.Count < 2) return null;
        var mx = x.Average();
        var my = y.Average();
        var numerator = 0d;
        var dx2 = 0d;
        var dy2 = 0d;
        for (var i = 0; i < x.Count; i++)
        {
            var dx = x[i] - mx;
            var dy = y[i] - my;
            numerator += dx * dy;
            dx2 += dx * dx;
            dy2 += dy * dy;
        }
        var denominator = Math.Sqrt(dx2 * dy2);
        return denominator == 0 ? null : numerator / denominator;
    }

    public static double? Spearman(IReadOnlyList<double> x, IReadOnlyList<double> y)
    {
        if (x.Count != y.Count || x.Count < 2) return null;
        return Pearson(Ranks(x), Ranks(y));
    }

    private static double[] Ranks(IReadOnlyList<double> values)
    {
        var ordered = values.Select((value, index) => (value, index)).OrderBy(x => x.value).ThenBy(x => x.index).ToArray();
        var ranks = new double[values.Count];
        var start = 0;
        while (start < ordered.Length)
        {
            var end = start + 1;
            while (end < ordered.Length && ordered[end].value.Equals(ordered[start].value)) end++;
            var rank = ((start + 1) + end) / 2d;
            for (var i = start; i < end; i++) ranks[ordered[i].index] = rank;
            start = end;
        }
        return ranks;
    }

    private static double[] InitializeCentroids(IReadOnlyList<double> values, int k)
    {
        var sorted = values.OrderBy(v => v).ToArray();
        return Enumerable.Range(0, k)
            .Select(i => sorted[(int)Math.Round(i * (sorted.Length - 1d) / (k - 1), MidpointRounding.AwayFromZero)])
            .ToArray();
    }

    private static int Nearest(double value, IReadOnlyList<double> centroids)
    {
        var best = 0;
        var distance = Math.Abs(value - centroids[0]);
        for (var i = 1; i < centroids.Count; i++)
        {
            var candidate = Math.Abs(value - centroids[i]);
            if (candidate >= distance) continue;
            best = i;
            distance = candidate;
        }
        return best;
    }

    private static string? NormalizeUf(string? uf)
    {
        if (string.IsNullOrWhiteSpace(uf)) return null;
        var normalized = uf.Trim().ToUpperInvariant();
        if (normalized.Length != 2 || normalized.Any(c => c is < 'A' or > 'Z'))
            throw new ArgumentException("uf must have two letters", nameof(uf));
        return normalized;
    }
}
