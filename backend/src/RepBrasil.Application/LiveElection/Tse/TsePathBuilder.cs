using System.Globalization;

namespace RepBrasil.Application.LiveElection.Tse;

/// <summary>
/// Ambiente de divulgação: url base + ambiente + ciclo. Oficial: https://resultados.tse.jus.br + "oficial";
/// simulado: https://resultados-sim.tse.jus.br/simulado + "simulado2026". O replay usa um host inválido de propósito
/// (<see cref="ReplayHost"/>), para que nenhuma URL de replay chegue ao TSE.
/// </summary>
public sealed record TseEnvironment(string BaseUrl, string Environment, string Cycle)
{
    public const string OfficialBase = "https://resultados.tse.jus.br";
    public const string SimulationBase = "https://resultados-sim.tse.jus.br/simulado";
    public const string ReplayHost = "replay.repbrasil.invalid";

    public static TseEnvironment Official(string cycle) => new(OfficialBase, "oficial", cycle);

    public static TseEnvironment Simulation(string environment, string cycle) => new(SimulationBase, environment, cycle);

    public static TseEnvironment Replay(string cycle, string environment = "replay") => new($"https://{ReplayHost}", environment, cycle);
}

/// <summary>
/// Único lugar que monta URLs do TSE. Diretórios vêm dos templates do EA11 (<c>arq</c>: tp → dir com
/// &lt;base&gt;, &lt;ambiente&gt;, &lt;ciclo&gt;, &lt;cd_eleicao&gt;, &lt;uf&gt;…); nomes de arquivo seguem as especificações
/// EA12/EA14/EA15/EA20 com o preenchimento exigido (eleição com 6 dígitos, cargo com 4, município com 5, zona com 4).
/// Nada é descoberto por tentativa: uma URL só existe se vier daqui, e daqui só saem formatos documentados.
/// </summary>
public sealed class TsePathBuilder
{
    /// <summary>Templates publicados no EA11 oficial de 2026 (usados se o arquivo não trouxer algum tipo).</summary>
    public static readonly IReadOnlyDictionary<string, string> DocumentedTemplates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["ft"] = "<base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>",
        ["cm"] = "<base>/<ambiente>/<ciclo>/<cd_eleicao>/config",
        ["e"] = "<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>",
        ["ab"] = "<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>",
        ["u"] = "<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>",
    };

    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "resultados.tse.jus.br",
        "resultados-sim.tse.jus.br",
        TseEnvironment.ReplayHost,
    };

    private readonly TseEnvironment environment;
    private readonly string baseUrl;
    private readonly Dictionary<string, string> templates;

    public TsePathBuilder(TseEnvironment environment, IReadOnlyDictionary<string, string>? discoveredTemplates = null)
    {
        if (!Uri.TryCreate(environment.BaseUrl, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps || !AllowedHosts.Contains(parsed.Host))
            throw new ArgumentException($"Base de resultados não permitida: {environment.BaseUrl}");
        if (!Segment(environment.Environment) || !Segment(environment.Cycle))
            throw new ArgumentException("Ambiente e ciclo do TSE devem ser segmentos simples (letras, números e hífen).");
        this.environment = environment;
        baseUrl = environment.BaseUrl.TrimEnd('/');
        templates = new Dictionary<string, string>(DocumentedTemplates, StringComparer.OrdinalIgnoreCase);
        if (discoveredTemplates is null) return;
        foreach (var (type, dir) in discoveredTemplates)
        {
            if (!DocumentedTemplates.ContainsKey(type)) continue;
            if (!dir.StartsWith("<base>/", StringComparison.Ordinal) || dir.Contains("..", StringComparison.Ordinal))
                throw new ArgumentException($"Template do EA11 fora do padrão para '{type}': {dir}");
            templates[type] = dir;
        }
    }

    public TseEnvironment Environment => environment;

    public bool IsReplay => environment.BaseUrl.Contains(TseEnvironment.ReplayHost, StringComparison.OrdinalIgnoreCase);

    /// <summary>EA11: &lt;base&gt;/&lt;ambiente&gt;/comum/config/ele-c.json (não depende de eleição).</summary>
    public Uri ElectionConfig() => new($"{baseUrl}/{environment.Environment}/comum/config/ele-c.json");

    /// <summary>EA12: …/&lt;cd_eleicao&gt;/config/mun-e&lt;eleição 6 dígitos&gt;-cm.json.</summary>
    public Uri MunicipalityConfig(int election) => Build("cm", election, uf: null, $"mun-e{Election(election)}-cm.json");

    /// <summary>EA14 (uf null → br-e…-ab.json) e EA15 (&lt;uf&gt;-e…-ab.json).</summary>
    public Uri Accompaniment(int election, string? uf = null)
    {
        var scope = uf is null ? "br" : Uf(uf);
        return Build("ab", election, scope, $"{scope}-e{Election(election)}-ab.json");
    }

    /// <summary>EA20 nacional, de UF, de município ou de zona.</summary>
    public Uri Result(int election, int office, string? uf = null, string? municipality = null, string? zone = null)
    {
        if (municipality is not null && uf is null) throw new ArgumentException("Município exige UF.");
        if (zone is not null && municipality is null) throw new ArgumentException("Zona exige município.");
        var scope = uf is null ? "br" : Uf(uf);
        var prefix = scope;
        if (municipality is not null) prefix += Digits(municipality, 5, "município");
        if (zone is not null) prefix += "-z" + Digits(zone, 4, "zona");
        return Build("u", election, scope, $"{prefix}-c{Office(office)}-e{Election(election)}-u.json");
    }

    /// <summary>Foto oficial: …/&lt;cd_eleicao&gt;/fotos/&lt;uf&gt;/&lt;sqcand&gt;.jpeg (Presidente: uf = br).</summary>
    public Uri Photo(int election, string uf, string sqcand)
    {
        var scope = string.Equals(uf, "br", StringComparison.OrdinalIgnoreCase) ? "br" : Uf(uf);
        if (sqcand.Length is 0 or > 20 || !sqcand.All(char.IsAsciiDigit)) throw new ArgumentException("sqcand inválido.");
        return Build("ft", election, scope, $"{sqcand}.jpeg");
    }

    private Uri Build(string type, int election, string? uf, string fileName)
    {
        var dir = templates[type]
            .Replace("<base>", baseUrl, StringComparison.Ordinal)
            .Replace("<ambiente>", environment.Environment, StringComparison.Ordinal)
            .Replace("<ciclo>", environment.Cycle, StringComparison.Ordinal)
            .Replace("<cd_eleicao>", election.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
        if (uf is not null) dir = dir.Replace("<uf>", uf, StringComparison.Ordinal);
        if (dir.Contains('<') || dir.Contains('>')) throw new ArgumentException($"Template '{type}' com marcador não resolvido: {dir}");
        return new Uri($"{dir}/{fileName}");
    }

    public static string Election(int election) =>
        election is > 0 and <= 999_999
            ? election.ToString("D6", CultureInfo.InvariantCulture)
            : throw new ArgumentOutOfRangeException(nameof(election), "Código de eleição deve ter até 6 dígitos.");

    public static string Office(int office) =>
        office is > 0 and <= 9_999
            ? office.ToString("D4", CultureInfo.InvariantCulture)
            : throw new ArgumentOutOfRangeException(nameof(office), "Código de cargo deve ter até 4 dígitos.");

    /// <summary>UF em minúsculas (inclui "zz", exterior). "br" não é UF.</summary>
    public static string Uf(string uf)
    {
        var normalized = uf.Trim().ToLowerInvariant();
        if (normalized.Length != 2 || !normalized.All(char.IsAsciiLetterLower) || normalized == "br")
            throw new ArgumentException($"UF inválida: '{uf}'.");
        return normalized;
    }

    /// <summary>Código com exatamente <paramref name="width"/> dígitos. Nunca completa zeros por conta própria:
    /// o código precisa vir do EA12 já com 5 (município) ou 4 (zona) dígitos.</summary>
    public static string Digits(string value, int width, string label)
    {
        var normalized = value.Trim();
        return normalized.Length == width && normalized.All(char.IsAsciiDigit)
            ? normalized
            : throw new ArgumentException($"Código de {label} deve ter {width} dígitos: '{value}'.");
    }

    private static bool Segment(string value) =>
        value.Length is > 0 and <= 40 && value.All(c => char.IsAsciiLetterOrDigit(c) || c == '-');
}
