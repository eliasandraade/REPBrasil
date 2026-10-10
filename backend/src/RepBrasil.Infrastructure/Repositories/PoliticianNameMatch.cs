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
