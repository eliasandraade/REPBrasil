using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace RepBrasil.Application.Electoral;

/// <summary>Recurso eleitoral inexistente (404).</summary>
public class ElectoralNotFoundException(string message) : Exception(message);

/// <summary>Parâmetro inválido (400).</summary>
public class ElectoralBadRequestException(string message) : Exception(message);

/// <summary>Divergência entre fontes/cadastro que impede responder com segurança (500, nunca dado inventado).</summary>
public class ElectoralIntegrityException(string message) : Exception(message);

public static partial class Slug
{
    /// <summary>Mesmo algoritmo do ETL (cadaster/territories.py): slug é navegação, nunca identidade.</summary>
    public static string From(string text)
    {
        var decomposed = text.Normalize(NormalizationForm.FormKD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        }

        var lower = sb.ToString().ToLowerInvariant();
        return NonAlphanumeric().Replace(lower, "-").Trim('-');
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumeric();
}
