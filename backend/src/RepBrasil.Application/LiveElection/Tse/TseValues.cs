using System.Globalization;
using System.Text.Json;

namespace RepBrasil.Application.LiveElection.Tse;

/// <summary>Arquivo do TSE fora do contrato publicado (campo obrigatório ausente, valor impossível, JSON inválido).</summary>
public sealed class TseContractException(string message) : Exception(message);

/// <summary>
/// Leitura tolerante dos valores dos arquivos de divulgação do TSE. Nos arquivos reais de 2026 todo número vem como
/// texto ("158745502"), percentuais oficiais usam vírgula ("47,027772356"; "100" sem casas), datas e horas vêm
/// separadas ("25/10/2026" + "19:02:13") e campos ainda sem valor vêm vazios (""). Vazio ou ausente vira <c>null</c>,
/// nunca zero; valor que não é número é violação de contrato.
/// </summary>
public static class TseValues
{
    /// <summary>Horário de Brasília. Sem horário de verão desde 2019 (Decreto 9.772/2019): o deslocamento é fixo.</summary>
    public static readonly TimeSpan BrasiliaOffset = TimeSpan.FromHours(-3);

    public static JsonElement? Property(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value
            : null;

    public static string? Text(JsonElement element, string name)
    {
        var value = Property(element, name);
        if (value is null) return null;
        var text = value.Value.ValueKind switch
        {
            JsonValueKind.String => value.Value.GetString(),
            JsonValueKind.Number => value.Value.GetRawText(),
            JsonValueKind.True => "s",
            JsonValueKind.False => "n",
            _ => throw new TseContractException($"campo '{name}' com tipo inesperado ({value.Value.ValueKind})"),
        };
        text = text?.Trim();
        return string.IsNullOrEmpty(text) ? null : text;
    }

    public static long? Long(JsonElement element, string name)
    {
        var text = Text(element, name);
        if (text is null) return null;
        if (long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value)) return value;
        throw new TseContractException($"campo '{name}' não é inteiro: '{Clip(text)}'");
    }

    /// <summary>Inteiro não negativo (contagens de votos, seções, eleitores).</summary>
    public static long? Count(JsonElement element, string name)
    {
        var value = Long(element, name);
        if (value < 0) throw new TseContractException($"campo '{name}' negativo: {value}");
        return value;
    }

    public static int? Int(JsonElement element, string name)
    {
        var value = Long(element, name);
        if (value is null) return null;
        if (value is < int.MinValue or > int.MaxValue) throw new TseContractException($"campo '{name}' fora do intervalo: {value}");
        return (int)value.Value;
    }

    public static decimal? Dec(JsonElement element, string name)
    {
        var value = Property(element, name);
        if (value is null) return null;
        if (value.Value.ValueKind == JsonValueKind.Number) return value.Value.GetDecimal();
        return ParseDecimal(Text(element, name), name);
    }

    /// <summary>"47,027772356", "100", "0,00", "1.234,5" ou "47.0277" → decimal exato (sem arredondar).</summary>
    public static decimal? ParseDecimal(string? text, string name)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var normalized = text.Trim();
        if (normalized.Contains(',', StringComparison.Ordinal))
            normalized = normalized.Replace(".", string.Empty, StringComparison.Ordinal).Replace(',', '.');
        if (decimal.TryParse(normalized, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value))
            return value;
        throw new TseContractException($"campo '{name}' não é decimal: '{Clip(text)}'");
    }

    /// <summary>Percentual 0–100 (com folga de arredondamento do próprio TSE).</summary>
    public static decimal? Percent(JsonElement element, string name)
    {
        var value = Dec(element, name);
        if (value is < 0m or > 100.000000001m) throw new TseContractException($"percentual '{name}' fora de 0–100: {value}");
        return value;
    }

    /// <summary>Data "dd/MM/yyyy" + hora "HH:mm:ss" de Brasília. Ausência de qualquer parte → null.</summary>
    public static DateTimeOffset? Timestamp(JsonElement element, string dateField, string timeField)
    {
        var date = Text(element, dateField);
        var time = Text(element, timeField);
        if (date is null || time is null) return null;
        if (!DateTime.TryParseExact($"{date} {time}", "dd/MM/yyyy HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
            throw new TseContractException($"data/hora inválida em '{dateField}'/'{timeField}': '{Clip(date)} {Clip(time)}'");
        return new DateTimeOffset(local, BrasiliaOffset);
    }

    public static DateOnly? Date(JsonElement element, string name)
    {
        var text = Text(element, name);
        if (text is null) return null;
        return DateOnly.TryParseExact(text, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new TseContractException($"data inválida em '{name}': '{Clip(text)}'");
    }

    /// <summary>Indicador "s"/"n" → bool; ausente → null; outro valor → violação.</summary>
    public static bool? Flag(JsonElement element, string name)
    {
        var text = Text(element, name);
        return text?.ToLowerInvariant() switch
        {
            null => null,
            "s" => true,
            "n" => false,
            _ => throw new TseContractException($"indicador '{name}' inválido: '{Clip(text)}'"),
        };
    }

    /// <summary>Campo de códigos fechados (ex.: and ∈ {n,p,f}).</summary>
    public static string? Code(JsonElement element, string name, params string[] allowed)
    {
        var text = Text(element, name)?.ToLowerInvariant();
        if (text is null) return null;
        return allowed.Contains(text)
            ? text
            : throw new TseContractException($"campo '{name}' com valor fora do contrato: '{Clip(text)}'");
    }

    public static IReadOnlyList<string> TextList(JsonElement element, string name)
    {
        var value = Property(element, name);
        if (value is null) return [];
        if (value.Value.ValueKind != JsonValueKind.Array) throw new TseContractException($"campo '{name}' deveria ser lista");
        var items = new List<string>();
        foreach (var item in value.Value.EnumerateArray())
        {
            var text = item.ValueKind switch
            {
                JsonValueKind.String => item.GetString(),
                JsonValueKind.Number => item.GetRawText(),
                _ => null,
            };
            if (!string.IsNullOrWhiteSpace(text)) items.Add(text.Trim());
        }
        return items;
    }

    public static IEnumerable<JsonElement> Items(JsonElement element, string name)
    {
        var value = Property(element, name);
        if (value is null) return [];
        if (value.Value.ValueKind != JsonValueKind.Array) throw new TseContractException($"campo '{name}' deveria ser lista");
        return value.Value.EnumerateArray();
    }

    private static string Clip(string text) => text.Length <= 40 ? text : text[..40] + "…";
}
