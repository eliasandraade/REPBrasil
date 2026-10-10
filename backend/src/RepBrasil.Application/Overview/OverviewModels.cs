namespace RepBrasil.Application.Overview;

// ── Linhas lidas do banco ───────────────────────────────────────────────────

/// <summary>Pleito × UF com Boletim de Urna importado: tamanho do território e cargos com voto.</summary>
public sealed class CoverageRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public string Uf { get; init; } = string.Empty;
    public string? StateName { get; init; }
    public int Municipalities { get; init; }
    public int Zones { get; init; }
    /// <summary>Urnas (seções, inclusive agregadas) do cargo com mais urnas no pleito — todos votam nas mesmas.</summary>
    public int Sections { get; init; }
    public long Eligible { get; init; }
    /// <summary>Códigos de cargo separados por vírgula ("1,3,5,6,7").</summary>
    public string Offices { get; init; } = string.Empty;
}

/// <summary>Arquivos oficiais baixados por tipo (com a data do mais recente).</summary>
public sealed class SourceKindRow
{
    public string Kind { get; init; } = string.Empty;
    public int Files { get; init; }
    public DateTime? LatestDownload { get; init; }
}

public sealed class OverviewTotalsRow
{
    public int Candidacies { get; init; }
    public int Politicians { get; init; }
    public DateTime? LatestImport { get; init; }
}

public sealed record OverviewData(IReadOnlyList<CoverageRow> Coverage, IReadOnlyList<SourceKindRow> Sources, OverviewTotalsRow Totals);

// ── Resposta ────────────────────────────────────────────────────────────────

public record OfficeRefDto(int Code, string Name);

public record CoverageElectionDto(int Year, int Round, string Uf, string StateName, int Municipalities, int Zones, int Sections,
    long Eligible, IReadOnlyList<OfficeRefDto> Offices);

/// <summary>Uma base oficial usada pela plataforma: quem publica, o que é, quantos arquivos e quando foi baixada.</summary>
public record SourceDto(string Kind, string Publisher, string Label, int Files, DateTime? LatestDownload);

public record OverviewResponse(
    IReadOnlyList<CoverageElectionDto> Elections,
    int Candidacies,
    int Politicians,
    IReadOnlyList<SourceDto> Sources,
    DateTime? UpdatedAt);
