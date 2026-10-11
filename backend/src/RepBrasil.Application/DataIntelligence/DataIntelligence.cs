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

public interface IDataIntelligenceRepository
{
    Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct);
    Task<IReadOnlyList<IndicatorValueDto>> ValuesAsync(string indicator, int? period, string? uf, CancellationToken ct);
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
    public Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct) => repository.CatalogAsync(ct);

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
            "Correlação não implica causalidade. O resultado descreve associação nos dados observados e não demonstra efeito causal.");
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
