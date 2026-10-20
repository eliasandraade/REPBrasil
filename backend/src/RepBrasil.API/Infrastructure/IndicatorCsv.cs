using System.Globalization;
using System.Text;
using RepBrasil.Application.DataIntelligence;

namespace RepBrasil.API.Infrastructure;

/// <summary>
/// CSV de indicadores no mesmo formato das exportações do produto: UTF-8 com BOM, separador ";", ponto decimal e
/// fim de linha CRLF. Cada linha leva a própria proveniência (fonte, conjunto e data de coleta). Texto que uma
/// planilha leria como fórmula ganha um apóstrofo; número nunca é alterado.
/// </summary>
public static class IndicatorCsv
{
    public const string ContentType = "text/csv; charset=utf-8";

    private static readonly string[] Header =
        ["uf", "municipio_ibge", "municipio", "indicador", "indicador_nome", "unidade", "periodo", "valor", "fonte", "conjunto", "coletado_em"];

    public static byte[] Write(IEnumerable<IndicatorExportRow> rows)
    {
        var csv = new StringBuilder();
        Line(csv, Header);
        foreach (var r in rows)
        {
            Line(csv,
            [
                Text(r.Uf),
                Text(r.MunicipalityIbgeCode),
                Text(r.MunicipalityName),
                Text(r.IndicatorCode),
                Text(r.IndicatorName),
                Text(r.Unit),
                r.Period.ToString(CultureInfo.InvariantCulture),
                Number(r.Value),
                Text(r.Provider),
                Text(r.Dataset),
                r.RetrievedAt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            ]);
        }
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(csv.ToString())];
    }

    /// <summary>Nome do arquivo só com letras, dígitos, ponto e hífen.</summary>
    public static string FileName(string subject, string? uf, int? period)
    {
        var parts = new[] { "repbrasil", subject, uf, period?.ToString(CultureInfo.InvariantCulture) }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => new string(p!.Trim().ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) || c == '.' ? c : '-').ToArray()));
        return string.Join('-', parts) + ".csv";
    }

    /// <summary>Ponto decimal (invariante) e sem zeros de escala à direita: 12.3400 vira 12.34.</summary>
    public static string Number(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);

    public static string Text(string? value)
    {
        var raw = value ?? "";
        if (raw.Length > 0 && "=+-@\t\r".Contains(raw[0])) raw = "'" + raw;
        return raw.IndexOfAny([';', '"', '\n', '\r']) >= 0 ? "\"" + raw.Replace("\"", "\"\"") + "\"" : raw;
    }

    private static void Line(StringBuilder csv, IEnumerable<string> cells) => csv.Append(string.Join(';', cells)).Append("\r\n");
}
