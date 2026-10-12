using System.Data;
using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Infrastructure;

public static class CommercialApiQuotaGate
{
    private const int DefaultDailyQuota = 1000;

    public static async Task<bool> ValidateAndConsumeAsync(
        ApplicationDbContext db,
        string secret,
        string requiredScope,
        CancellationToken cancellationToken)
    {
        if (!secret.StartsWith("rep_live_", StringComparison.Ordinal) || secret.Length < 30) return false;

        await db.Database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            await using var keyCommand = Command(db, """
                SELECT id, user_id, scopes
                FROM account.api_key
                WHERE key_hash = @hash
                  AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > now())
                FOR UPDATE
                """, ("hash", Hash(secret)));
            await using var reader = await keyCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            var apiKeyId = reader.GetGuid(0);
            var userId = reader.GetGuid(1);
            var scopes = reader.GetFieldValue<string[]>(2);
            await reader.DisposeAsync();

            if (!scopes.Contains(requiredScope, StringComparer.Ordinal))
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await using (var accountLock = Command(db,
                "SELECT id FROM account.user_account WHERE id = @user_id AND disabled_at IS NULL FOR UPDATE",
                ("user_id", userId)))
            {
                if (await accountLock.ExecuteScalarAsync(cancellationToken) is null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return false;
                }
            }

            var quota = DefaultDailyQuota;
            await using (var entitlement = Command(db, """
                SELECT entitlement_value
                FROM account.entitlement
                WHERE user_id = @user_id
                  AND entitlement_key = 'api.daily_quota'
                  AND starts_at <= now()
                  AND (expires_at IS NULL OR expires_at > now())
                ORDER BY starts_at DESC, id DESC
                LIMIT 1
                """, ("user_id", userId)))
            {
                var raw = await entitlement.ExecuteScalarAsync(cancellationToken) as string;
                if (int.TryParse(raw, out var configuredQuota) && configuredQuota > 0) quota = configuredQuota;
            }

            long usedToday;
            await using (var usageTotal = Command(db, """
                SELECT COALESCE(SUM(u.request_count), 0)::bigint
                FROM account.api_usage_daily u
                JOIN account.api_key k ON k.id = u.api_key_id
                WHERE k.user_id = @user_id
                  AND u.usage_date = current_date
                """, ("user_id", userId)))
            {
                usedToday = Convert.ToInt64(await usageTotal.ExecuteScalarAsync(cancellationToken));
            }

            if (usedToday >= quota)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await using (var increment = Command(db, """
                INSERT INTO account.api_usage_daily (api_key_id, usage_date, request_count)
                VALUES (@id, current_date, 1)
                ON CONFLICT (api_key_id, usage_date)
                DO UPDATE SET request_count = account.api_usage_daily.request_count + 1, updated_at = now()
                """, ("id", apiKeyId)))
            {
                await increment.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var touch = Command(db,
                "UPDATE account.api_key SET last_used_at = now() WHERE id = @id",
                ("id", apiKeyId)))
            {
                await touch.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private static DbCommand Command(ApplicationDbContext db, string sql, params (string Name, object? Value)[] args)
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

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
