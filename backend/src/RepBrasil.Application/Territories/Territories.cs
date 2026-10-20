namespace RepBrasil.Application.Territories;

/// <summary>As 27 unidades da federação (siglas oficiais).</summary>
public static class BrazilianStates
{
    public static IReadOnlyList<string> Codes { get; } =
    [
        "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
        "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
    ];

    public static bool IsValid(string? code) => code is { Length: 2 } && Codes.Contains(code, StringComparer.Ordinal);

    /// <summary>Sigla em maiúsculas sem espaços, ou nulo se vazia. Não valida.</summary>
    public static string? Normalize(string? code) =>
        string.IsNullOrWhiteSpace(code) ? null : code.Trim().ToUpperInvariant();
}

/// <summary>UF do catálogo territorial, com o total de municípios cadastrados.</summary>
public sealed record TerritoryStateDto(string Code, string Name, int? IbgeCode, int Municipalities);

/// <summary>Município do catálogo territorial (códigos IBGE de 7 dígitos e TSE de 5).</summary>
public sealed record TerritoryMunicipalityDto(string IbgeCode, string Name, string Slug, string TseCode, string StateCode);

public interface ITerritoryCatalogRepository
{
    Task<IReadOnlyList<TerritoryStateDto>> StatesAsync(CancellationToken ct);
    Task<IReadOnlyList<TerritoryMunicipalityDto>> MunicipalitiesAsync(string uf, CancellationToken ct);
    Task<TerritoryMunicipalityDto?> MunicipalityAsync(string uf, string ibgeCode, CancellationToken ct);
}

/// <summary>
/// Catálogo territorial independente de eleição: UFs e municípios com código IBGE. Serve a escolha de
/// território (perfil, navegação) — não diz que há dado carregado para o território.
/// </summary>
public sealed class TerritoryCatalogService(ITerritoryCatalogRepository repo)
{
    public Task<IReadOnlyList<TerritoryStateDto>> StatesAsync(CancellationToken ct) => repo.StatesAsync(ct);

    public Task<IReadOnlyList<TerritoryMunicipalityDto>> MunicipalitiesAsync(string? uf, CancellationToken ct)
    {
        var code = BrazilianStates.Normalize(uf);
        if (!BrazilianStates.IsValid(code)) throw new ArgumentException("UF inválida.");
        return repo.MunicipalitiesAsync(code!, ct);
    }

    /// <summary>Município da UF pelo código IBGE (7 dígitos), ou nulo se não existir nessa UF.</summary>
    public Task<TerritoryMunicipalityDto?> MunicipalityAsync(string uf, string ibgeCode, CancellationToken ct) =>
        BrazilianStates.IsValid(uf) && IsIbgeCode(ibgeCode)
            ? repo.MunicipalityAsync(uf, ibgeCode, ct)
            : Task.FromResult<TerritoryMunicipalityDto?>(null);

    public static bool IsIbgeCode(string? value) => value is { Length: 7 } && value.All(char.IsAsciiDigit);
}
