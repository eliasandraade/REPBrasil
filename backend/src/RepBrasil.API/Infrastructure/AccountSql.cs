using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Infrastructure;

/// <summary>
/// ADO.NET mínimo do esquema <c>account</c> (SQL bruto, como o resto da conta): comando já ligado à transação
/// corrente do contexto e leitura de colunas anuláveis. Compartilhado pelos serviços de conta.
/// </summary>
internal static class AccountSql
{
    public static DbCommand Command(this ApplicationDbContext db, string sql, params (string Name, object? Value)[] args)
    {
        var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = sql;
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var (name, value) in args)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }
        return command;
    }

    public static string? NullableString(this DbDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    public static DateTimeOffset? NullableTime(this DbDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetFieldValue<DateTimeOffset>(ordinal);
}
