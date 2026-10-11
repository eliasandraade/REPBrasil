using System.Globalization;
using System.Text;
using Npgsql;
using NpgsqlTypes;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// Filtro por nome de político (de urna ou civil) sem acento e por início de palavra, atendido pelo índice de
/// trigramas <c>politicians_search_trgm_idx</c> (migration 012). Usado pela busca global e pela lista de políticos.
/// </summary>
internal static class PoliticianNameMatch
{
    /// <summary>A MESMA expressão do índice — qualquer diferença faz o banco varrer a tabela.</summary>
    public const string Text = """(' ' || public.search_fold(p."BallotName") || ' ' || public.search_fold(p."Name"))""";

    /// <summary>
    /// Filtro com SQL CONSTANTE: o termo mais longo (o mais seletivo) vai pelo índice de trigramas (@lead) e os demais
    /// filtram as linhas encontradas (LIKE ALL @rest; vazio = verdadeiro). Nenhum texto montado em tempo de execução.
    /// </summary>
    public const string Where = $" AND {Text} LIKE @lead AND {Text} LIKE ALL (@rest)";

    /// <summary>Parâmetros de <see cref="Where"/>. Exige pelo menos um termo.</summary>
    public static object[] WhereParameters(IReadOnlyList<string> terms)
    {
        if (terms.Count == 0) throw new ArgumentException("pelo menos um termo", nameof(terms));
        var lead = terms.OrderByDescending(t => t.Length).ThenBy(t => t, StringComparer.Ordinal).First();
        var rest = terms.Where(t => t != lead).Select(Pattern).ToArray();
        return
        [
            new NpgsqlParameter("lead", NpgsqlDbType.Text) { Value = Pattern(lead) },
            new NpgsqlParameter("rest", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = rest },
        ];
    }

    /// <summary>O termo começa uma palavra do texto (que começa com espaço).</summary>
    private static string Pattern(string term) => $"% {term}%";

    /// <summary>
    /// " AND texto LIKE @t0 AND ..." com um parâmetro por termo. Os termos vêm de <c>SearchService.Fold</c> (só
    /// [a-z0-9]), então não carregam curinga de LIKE; o SQL só recebe nomes de parâmetro.
    /// </summary>
    public static string Conditions(IReadOnlyList<string> terms, List<object> parameters)
    {
        var sql = new StringBuilder();
        for (var i = 0; i < terms.Count; i++)
        {
            sql.Append(CultureInfo.InvariantCulture, $" AND {Text} LIKE @t{i}");
            parameters.Add(new NpgsqlParameter($"t{i}", NpgsqlDbType.Text) { Value = $"% {terms[i]}%" });
        }
        return sql.ToString();
    }
}
