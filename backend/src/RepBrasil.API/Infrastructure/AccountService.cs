using System.Data;
using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using RepBrasil.API.Accounts;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Infrastructure;

public sealed record AccountSession(
    Guid UserId,
    string Email,
    string? DisplayName,
    string? AvatarUrl,
    string CsrfToken,
    DateTimeOffset ExpiresAt);

public sealed record MagicLinkChallenge(string Email, string Token, string ReturnTo, DateTimeOffset ExpiresAt);
public sealed record SavedItemDto(Guid Id, string Collection, string ResourceType, string ResourceKey, string? Label, string? Href, JsonElement Metadata, DateTimeOffset CreatedAt, string? Folder);
public sealed record AlertSubscriptionDto(Guid Id, string ResourceType, string ResourceKey, string EventKind, string Delivery, bool Enabled, DateTimeOffset CreatedAt);
public sealed record NotificationDto(Guid Id, string EventKey, string ResourceType, string ResourceKey, string Title, string? Body, string? Href, JsonElement Payload, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt);
public sealed record ApiKeyDto(Guid Id, string Name, string Prefix, string[] Scopes, int DailyQuota, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset? ExpiresAt, bool Revoked);
public sealed record CreatedApiKey(ApiKeyDto Key, string Secret);
public sealed record EntitlementDto(string Key, string Value, string Source, DateTimeOffset StartsAt, DateTimeOffset? ExpiresAt);

public sealed class AccountService(ApplicationDbContext db)
{
    private const int SessionDays = 30;

    public async Task<MagicLinkChallenge> CreateMagicLinkChallengeAsync(string email, string? returnTo, CancellationToken cancellationToken)
    {
        email = NormalizeEmail(email);
        var safeReturnTo = NormalizeReturnTo(returnTo);
        var token = CreateToken(32);
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(15);

        await ExecuteAsync("""
            INSERT INTO account.login_challenge (id, kind, email, token_hash, return_to, expires_at)
            VALUES (@id, 'magic_link', @email, @token_hash, @return_to, @expires_at)
            """, cancellationToken,
            ("id", Guid.NewGuid()),
            ("email", email),
            ("token_hash", Hash(token)),
            ("return_to", safeReturnTo),
            ("expires_at", expiresAt));

        return new(email, token, safeReturnTo, expiresAt);
    }

    public Task<(AccountSession Session, string SessionToken, string ReturnTo)?> ConsumeMagicLinkAsync(string token, string? userAgent, string? ipAddress, CancellationToken cancellationToken) =>
        RetrySerializableAsync(() => ConsumeMagicLinkOnceAsync(token, userAgent, ipAddress, cancellationToken), cancellationToken);

    private async Task<(AccountSession Session, string SessionToken, string ReturnTo)?> ConsumeMagicLinkOnceAsync(string token, string? userAgent, string? ipAddress, CancellationToken cancellationToken)
    {
        var hash = Hash(token);
        await OpenAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            await using var select = Command("""
                SELECT id, email, return_to
                FROM account.login_challenge
                WHERE kind = 'magic_link' AND token_hash = @token_hash AND consumed_at IS NULL AND expires_at > now()
                FOR UPDATE
                """, ("token_hash", hash));
            await using var reader = await select.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                // O reader precisa ser fechado antes do rollback: com ele aberto o Npgsql lança e o
                // link usado/expirado virava 500 em vez de "link inválido".
                await reader.DisposeAsync();
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }
            var challengeId = reader.GetGuid(0);
            var email = reader.GetString(1);
            var returnTo = reader.GetString(2);
            await reader.DisposeAsync();

            await using var consume = Command("UPDATE account.login_challenge SET consumed_at = now() WHERE id = @id", ("id", challengeId));
            await consume.ExecuteNonQueryAsync(cancellationToken);

            var userId = await EnsureUserAsync(email, "magic_link", email, email, null, null, cancellationToken);
            var created = await CreateSessionAsync(userId, userAgent, ipAddress, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (created.Session, created.Token, returnTo);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    public async Task<string> CreateGoogleStateAsync(string? returnTo, CancellationToken cancellationToken)
    {
        var state = CreateToken(32);
        await ExecuteAsync("""
            INSERT INTO account.login_challenge (id, kind, token_hash, return_to, expires_at)
            VALUES (@id, 'google_state', @token_hash, @return_to, @expires_at)
            """, cancellationToken,
            ("id", Guid.NewGuid()),
            ("token_hash", Hash(state)),
            ("return_to", NormalizeReturnTo(returnTo)),
            ("expires_at", DateTimeOffset.UtcNow.AddMinutes(10)));
        return state;
    }

    public Task<string?> ConsumeGoogleStateAsync(string state, CancellationToken cancellationToken) =>
        RetrySerializableAsync(() => ConsumeGoogleStateOnceAsync(state, cancellationToken), cancellationToken);

    private async Task<string?> ConsumeGoogleStateOnceAsync(string state, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            await using var command = Command("""
                UPDATE account.login_challenge
                SET consumed_at = now()
                WHERE kind = 'google_state' AND token_hash = @hash AND consumed_at IS NULL AND expires_at > now()
                RETURNING return_to
                """, ("hash", Hash(state)));
            var result = await command.ExecuteScalarAsync(cancellationToken) as string;
            if (result is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }
            await transaction.CommitAsync(cancellationToken);
            return result;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    public Task<(AccountSession Session, string Token)> SignInGoogleAsync(
        string subject,
        string email,
        string? displayName,
        string? avatarUrl,
        bool emailVerified,
        string? userAgent,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        email = NormalizeEmail(email);
        return RetrySerializableAsync(
            () => SignInGoogleOnceAsync(subject, email, displayName, avatarUrl, emailVerified, userAgent, ipAddress, cancellationToken),
            cancellationToken);
    }

    private async Task<(AccountSession Session, string Token)> SignInGoogleOnceAsync(
        string subject,
        string email,
        string? displayName,
        string? avatarUrl,
        bool emailVerified,
        string? userAgent,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var userId = await EnsureUserAsync(email, "google", subject, email, displayName, avatarUrl, cancellationToken, emailVerified);
            var session = await CreateSessionAsync(userId, userAgent, ipAddress, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return session;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    public async Task<AccountSession?> GetSessionAsync(string? token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT u.id, u.email, u.display_name, CASE WHEN u.avatar_hidden THEN NULL ELSE u.avatar_url END, s.csrf_token, s.expires_at
                FROM account.session s
                JOIN account.user_account u ON u.id = s.user_id
                WHERE s.token_hash = @hash AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL
                LIMIT 1
                """, ("hash", Hash(token)));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return null;
            var session = new AccountSession(
                reader.GetGuid(0), reader.GetString(1), reader.NullableString(2), reader.NullableString(3), reader.GetString(4), reader.GetFieldValue<DateTimeOffset>(5));
            await reader.DisposeAsync();
            await using var touch = Command("UPDATE account.session SET last_seen_at = now() WHERE token_hash = @hash", ("hash", Hash(token)));
            await touch.ExecuteNonQueryAsync(cancellationToken);
            return session;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    public Task RevokeSessionAsync(string token, CancellationToken cancellationToken) =>
        ExecuteAsync("UPDATE account.session SET revoked_at = now() WHERE token_hash = @hash AND revoked_at IS NULL", cancellationToken, ("hash", Hash(token)));

    public async Task<IReadOnlyList<SavedItemDto>> GetSavedItemsAsync(Guid userId, string collection, CancellationToken cancellationToken)
    {
        ValidateCollection(collection);
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT id, collection, resource_type, resource_key, label, href, metadata::text, created_at, folder
                FROM account.saved_item
                WHERE user_id = @user_id AND collection = @collection
                ORDER BY created_at DESC, id
                """, ("user_id", userId), ("collection", collection));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var result = new List<SavedItemDto>();
            while (await reader.ReadAsync(cancellationToken))
                result.Add(ReadSavedItem(reader));
            return result;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    /// <summary>
    /// Salva (ou atualiza) um item. Item novo além de <paramref name="limit"/> é recusado com
    /// <see cref="PlanLimitReachedException"/>; a contagem é feita com a conta travada, então dois pedidos
    /// simultâneos não passam juntos do limite. Itens que já existem nunca são apagados.
    /// </summary>
    public async Task<SavedItemDto> SaveItemAsync(Guid userId, string collection, string resourceType, string resourceKey, string? label, string? href, JsonElement? metadata, int limit, CancellationToken cancellationToken)
    {
        ValidateCollection(collection);
        ValidateResource(resourceType, resourceKey);
        var metadataJson = metadata?.GetRawText() ?? "{}";
        await OpenAsync(cancellationToken);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await LockUserAsync(userId, cancellationToken);
            await using (var count = Command("""
                SELECT count(*) FILTER (WHERE resource_type = @resource_type AND resource_key = @resource_key) > 0, count(*)
                FROM account.saved_item WHERE user_id = @user_id AND collection = @collection
                """, ("user_id", userId), ("collection", collection), ("resource_type", resourceType), ("resource_key", resourceKey)))
            await using (var existing = await count.ExecuteReaderAsync(cancellationToken))
            {
                await existing.ReadAsync(cancellationToken);
                if (!existing.GetBoolean(0) && existing.GetInt64(1) >= limit)
                    throw new PlanLimitReachedException(collection == "favorite" ? PlanCatalog.FavoritesLimit : PlanCatalog.WatchlistLimit, limit);
            }

            SavedItemDto saved;
            await using (var command = Command("""
                INSERT INTO account.saved_item (id, user_id, collection, resource_type, resource_key, label, href, metadata)
                VALUES (@id, @user_id, @collection, @resource_type, @resource_key, @label, @href, CAST(@metadata AS jsonb))
                ON CONFLICT (user_id, collection, resource_type, resource_key)
                DO UPDATE SET label = EXCLUDED.label, href = EXCLUDED.href, metadata = EXCLUDED.metadata, updated_at = now()
                RETURNING id, collection, resource_type, resource_key, label, href, metadata::text, created_at, folder
                """,
                ("id", Guid.NewGuid()), ("user_id", userId), ("collection", collection), ("resource_type", resourceType),
                ("resource_key", resourceKey), ("label", label), ("href", href), ("metadata", metadataJson)))
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                await reader.ReadAsync(cancellationToken);
                saved = ReadSavedItem(reader);
            }
            await transaction.CommitAsync(cancellationToken);
            return saved;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    /// <summary>Move um item salvo para uma pasta (nulo tira da pasta). Nulo se o item não existe.</summary>
    public async Task<SavedItemDto?> SetSavedItemFolderAsync(Guid userId, string collection, string resourceType, string resourceKey, string? folder, CancellationToken cancellationToken)
    {
        ValidateCollection(collection);
        ValidateResource(resourceType, resourceKey);
        var name = string.IsNullOrWhiteSpace(folder) ? null : folder.Trim();
        if (name is not null && (name.Length > 60 || name.Any(char.IsControl))) throw new ArgumentException("Nome da pasta: até 60 caracteres, sem caracteres de controle.");
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                UPDATE account.saved_item SET folder = @folder, updated_at = now()
                WHERE user_id = @user_id AND collection = @collection AND resource_type = @resource_type AND resource_key = @resource_key
                RETURNING id, collection, resource_type, resource_key, label, href, metadata::text, created_at, folder
                """, ("folder", name), ("user_id", userId), ("collection", collection), ("resource_type", resourceType), ("resource_key", resourceKey));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadSavedItem(reader) : null;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public Task RemoveSavedItemAsync(Guid userId, string collection, string resourceType, string resourceKey, CancellationToken cancellationToken)
    {
        ValidateCollection(collection);
        ValidateResource(resourceType, resourceKey);
        return ExecuteAsync("DELETE FROM account.saved_item WHERE user_id = @user_id AND collection = @collection AND resource_type = @resource_type AND resource_key = @resource_key", cancellationToken,
            ("user_id", userId), ("collection", collection), ("resource_type", resourceType), ("resource_key", resourceKey));
    }

    public async Task<IReadOnlyList<AlertSubscriptionDto>> GetAlertsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT id, resource_type, resource_key, event_kind, delivery, enabled, created_at
                FROM account.alert_subscription WHERE user_id = @user_id ORDER BY created_at DESC
                """, ("user_id", userId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var items = new List<AlertSubscriptionDto>();
            while (await reader.ReadAsync(cancellationToken))
                items.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetBoolean(5), reader.GetFieldValue<DateTimeOffset>(6)));
            return items;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    /// <summary>
    /// Cria ou atualiza uma assinatura de alerta do catálogo (<see cref="AlertCatalog"/>). Assinatura nova além de
    /// <paramref name="limit"/> é recusada com <see cref="PlanLimitReachedException"/>; pausar ou retomar uma que já
    /// existe é sempre permitido.
    /// </summary>
    public async Task<AlertSubscriptionDto> UpsertAlertAsync(Guid userId, string resourceType, string resourceKey, string eventKind, string delivery, bool enabled, int limit, CancellationToken cancellationToken)
    {
        AlertCatalog.Validate(resourceType, resourceKey, eventKind, delivery);
        await OpenAsync(cancellationToken);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await LockUserAsync(userId, cancellationToken);
            await using (var count = Command("""
                SELECT count(*) FILTER (WHERE resource_type = @resource_type AND resource_key = @resource_key AND event_kind = @event_kind AND delivery = @delivery) > 0, count(*)
                FROM account.alert_subscription WHERE user_id = @user_id
                """, ("user_id", userId), ("resource_type", resourceType), ("resource_key", resourceKey), ("event_kind", eventKind), ("delivery", delivery)))
            await using (var existing = await count.ExecuteReaderAsync(cancellationToken))
            {
                await existing.ReadAsync(cancellationToken);
                if (!existing.GetBoolean(0) && existing.GetInt64(1) >= limit) throw new PlanLimitReachedException(PlanCatalog.AlertsLimit, limit);
            }

            AlertSubscriptionDto alert;
            await using (var command = Command("""
                INSERT INTO account.alert_subscription (id, user_id, resource_type, resource_key, event_kind, delivery, enabled)
                VALUES (@id, @user_id, @resource_type, @resource_key, @event_kind, @delivery, @enabled)
                ON CONFLICT (user_id, resource_type, resource_key, event_kind, delivery)
                DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
                RETURNING id, resource_type, resource_key, event_kind, delivery, enabled, created_at
                """, ("id", Guid.NewGuid()), ("user_id", userId), ("resource_type", resourceType), ("resource_key", resourceKey),
                ("event_kind", eventKind), ("delivery", delivery), ("enabled", enabled)))
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                await reader.ReadAsync(cancellationToken);
                alert = new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetBoolean(5), reader.GetFieldValue<DateTimeOffset>(6));
            }
            await transaction.CommitAsync(cancellationToken);
            return alert;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public Task DeleteAlertAsync(Guid userId, Guid alertId, CancellationToken cancellationToken) =>
        ExecuteAsync("DELETE FROM account.alert_subscription WHERE user_id = @user_id AND id = @id", cancellationToken, ("user_id", userId), ("id", alertId));

    public async Task<IReadOnlyList<NotificationDto>> GetNotificationsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT id, event_key, resource_type, resource_key, title, body, href, payload::text, created_at, read_at
                FROM account.notification WHERE user_id = @user_id ORDER BY created_at DESC LIMIT 100
                """, ("user_id", userId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var items = new List<NotificationDto>();
            while (await reader.ReadAsync(cancellationToken))
                items.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.NullableString(5), reader.NullableString(6), Json(reader.GetString(7)), reader.GetFieldValue<DateTimeOffset>(8), reader.NullableTime(9)));
            return items;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public Task MarkNotificationReadAsync(Guid userId, Guid id, CancellationToken cancellationToken) =>
        ExecuteAsync("UPDATE account.notification SET read_at = COALESCE(read_at, now()) WHERE user_id = @user_id AND id = @id", cancellationToken, ("user_id", userId), ("id", id));

    public Task<int> MarkAllNotificationsReadAsync(Guid userId, CancellationToken cancellationToken) =>
        ExecuteAsync("UPDATE account.notification SET read_at = now() WHERE user_id = @user_id AND read_at IS NULL", cancellationToken, ("user_id", userId));

    public async Task<int> PublishAlertAsync(string eventKey, string resourceType, string resourceKey, string eventKind, string title, string? body, string? href, JsonElement? payload, CancellationToken cancellationToken)
    {
        ValidateResource(resourceType, resourceKey);
        if (string.IsNullOrWhiteSpace(eventKey) || eventKey.Length > 160) throw new ArgumentException("Chave do evento inválida.");
        if (string.IsNullOrWhiteSpace(title) || title.Length > 200) throw new ArgumentException("Título inválido.");
        var payloadJson = payload?.GetRawText() ?? "{}";
        return await ExecuteAsync("""
            INSERT INTO account.notification (id, user_id, event_key, resource_type, resource_key, title, body, href, payload)
            SELECT gen_random_uuid(), s.user_id, @event_key, @resource_type, @resource_key, @title, @body, @href, CAST(@payload AS jsonb)
            FROM account.alert_subscription s
            WHERE s.resource_type = @resource_type AND s.resource_key = @resource_key AND s.event_kind = @event_kind AND s.enabled = true
            ON CONFLICT (user_id, event_key) DO NOTHING
            """, cancellationToken, ("event_key", eventKey), ("resource_type", resourceType), ("resource_key", resourceKey),
            ("event_kind", eventKind), ("title", title), ("body", body), ("href", href), ("payload", payloadJson));
    }

    public async Task<IReadOnlyList<EntitlementDto>> GetEntitlementsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT entitlement_key, entitlement_value, source, starts_at, expires_at
                FROM account.entitlement
                WHERE user_id = @user_id AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
                ORDER BY entitlement_key, starts_at DESC
                """, ("user_id", userId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var items = new List<EntitlementDto>();
            while (await reader.ReadAsync(cancellationToken))
                items.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<DateTimeOffset>(3), reader.NullableTime(4)));
            return items;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    /// <summary>Fatos de acesso da conta: assinaturas e entitlements em vigor (ver <see cref="EntitlementResolver"/>).</summary>
    public async Task<(IReadOnlyList<SubscriptionFact> Subscriptions, IReadOnlyList<EntitlementFact> Entitlements)> LoadAccessFactsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        try
        {
            var subscriptions = new List<SubscriptionFact>();
            await using (var command = Command("""
                SELECT id, plan, status, provider, current_period_end, cancel_at_period_end, created_at
                FROM account.subscription WHERE user_id = @user_id
                ORDER BY created_at DESC LIMIT 20
                """, ("user_id", userId)))
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    subscriptions.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.NullableTime(4), reader.GetBoolean(5), reader.GetFieldValue<DateTimeOffset>(6)));
            }

            var entitlements = new List<EntitlementFact>();
            await using (var command = Command("""
                SELECT entitlement_key, entitlement_value, source, starts_at, expires_at
                FROM account.entitlement
                WHERE user_id = @user_id AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
                """, ("user_id", userId)))
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    entitlements.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<DateTimeOffset>(3), reader.NullableTime(4)));
            }
            return (subscriptions, entitlements);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public async Task<IReadOnlyList<ApiKeyDto>> GetApiKeysAsync(Guid userId, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT id, name, key_prefix, scopes, daily_quota, created_at, last_used_at, expires_at, revoked_at IS NOT NULL
                FROM account.api_key WHERE user_id = @user_id ORDER BY created_at DESC
                """, ("user_id", userId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var items = new List<ApiKeyDto>();
            while (await reader.ReadAsync(cancellationToken))
                items.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<string[]>(3), reader.GetInt32(4), reader.GetFieldValue<DateTimeOffset>(5),
                    reader.NullableTime(6), reader.NullableTime(7), reader.GetBoolean(8)));
            return items;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public async Task<CreatedApiKey> CreateApiKeyAsync(Guid userId, string name, string[]? scopes, CancellationToken cancellationToken)
    {
        name = name.Trim();
        if (name.Length is < 2 or > 80) throw new ArgumentException("Nome da chave deve ter entre 2 e 80 caracteres.");
        var safeScopes = (scopes is { Length: > 0 } ? scopes : ["read:public"]).Distinct(StringComparer.Ordinal).ToArray();
        if (safeScopes.Any(s => s is not ("read:public" or "read:account"))) throw new ArgumentException("Escopo de API inválido.");
        var secret = "rep_live_" + CreateToken(32);
        var prefix = secret[..Math.Min(17, secret.Length)];
        var quota = await ResolveApiQuotaAsync(userId, cancellationToken);
        var id = Guid.NewGuid();
        var createdAt = DateTimeOffset.UtcNow;
        await ExecuteAsync("""
            INSERT INTO account.api_key (id, user_id, name, key_prefix, key_hash, scopes, daily_quota, created_at)
            VALUES (@id, @user_id, @name, @prefix, @hash, @scopes, @quota, @created_at)
            """, cancellationToken, ("id", id), ("user_id", userId), ("name", name), ("prefix", prefix), ("hash", Hash(secret)), ("scopes", safeScopes), ("quota", quota), ("created_at", createdAt));
        return new(new(id, name, prefix, safeScopes, quota, createdAt, null, null, false), secret);
    }

    public Task RevokeApiKeyAsync(Guid userId, Guid id, CancellationToken cancellationToken) =>
        ExecuteAsync("UPDATE account.api_key SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = @user_id AND id = @id", cancellationToken, ("user_id", userId), ("id", id));

    public static bool SecureEquals(string? a, string? b)
    {
        if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
        var ab = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ab.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ab, bb);
    }

    private async Task<Guid> EnsureUserAsync(string email, string provider, string subject, string providerEmail, string? displayName, string? avatarUrl, CancellationToken cancellationToken, bool verified = true)
    {
        await using var identity = Command("SELECT user_id FROM account.identity WHERE provider = @provider AND provider_subject = @subject LIMIT 1", ("provider", provider), ("subject", subject));
        var existingIdentity = await identity.ExecuteScalarAsync(cancellationToken);
        if (existingIdentity is Guid identityUser)
        {
            await using var touch = Command("UPDATE account.identity SET last_used_at = now(), provider_email = @email WHERE provider = @provider AND provider_subject = @subject", ("email", providerEmail), ("provider", provider), ("subject", subject));
            await touch.ExecuteNonQueryAsync(cancellationToken);
            return identityUser;
        }

        await using var byEmail = Command("SELECT id FROM account.user_account WHERE email = @email AND disabled_at IS NULL LIMIT 1", ("email", email));
        var existingUser = await byEmail.ExecuteScalarAsync(cancellationToken);
        var userId = existingUser is Guid user ? user : Guid.NewGuid();
        if (existingUser is null)
        {
            await using var insertUser = Command("""
                INSERT INTO account.user_account (id, email, display_name, avatar_url, email_verified_at)
                VALUES (@id, @email, @display_name, @avatar_url, CASE WHEN @verified THEN now() ELSE NULL END)
                """, ("id", userId), ("email", email), ("display_name", displayName), ("avatar_url", avatarUrl), ("verified", verified));
            await insertUser.ExecuteNonQueryAsync(cancellationToken);
        }
        else if (provider == "google")
        {
            await using var update = Command("""
                UPDATE account.user_account SET display_name = CASE WHEN profile_customized_at IS NULL THEN COALESCE(@display_name, display_name) ELSE display_name END,
                    avatar_url = COALESCE(@avatar_url, avatar_url),
                    email_verified_at = CASE WHEN @verified THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END, updated_at = now()
                WHERE id = @id
                """, ("display_name", displayName), ("avatar_url", avatarUrl), ("verified", verified), ("id", userId));
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var insertIdentity = Command("""
            INSERT INTO account.identity (id, user_id, provider, provider_subject, provider_email)
            VALUES (@id, @user_id, @provider, @subject, @email)
            ON CONFLICT (provider, provider_subject) DO UPDATE SET last_used_at = now(), provider_email = EXCLUDED.provider_email
            """, ("id", Guid.NewGuid()), ("user_id", userId), ("provider", provider), ("subject", subject), ("email", providerEmail));
        await insertIdentity.ExecuteNonQueryAsync(cancellationToken);
        return userId;
    }

    private async Task<(AccountSession Session, string Token)> CreateSessionAsync(Guid userId, string? userAgent, string? ipAddress, CancellationToken cancellationToken)
    {
        var token = CreateToken(40);
        var csrf = CreateToken(24);
        var expires = DateTimeOffset.UtcNow.AddDays(SessionDays);
        await using var command = Command("""
            INSERT INTO account.session (id, user_id, token_hash, csrf_token, expires_at, user_agent_hash, ip_prefix_hash)
            VALUES (@id, @user_id, @token_hash, @csrf, @expires_at, @ua, @ip)
            """, ("id", Guid.NewGuid()), ("user_id", userId), ("token_hash", Hash(token)), ("csrf", csrf), ("expires_at", expires),
            ("ua", HashOptional(userAgent)), ("ip", HashOptional(IpPrefix(ipAddress))));
        await command.ExecuteNonQueryAsync(cancellationToken);
        await using var user = Command("SELECT email, display_name, CASE WHEN avatar_hidden THEN NULL ELSE avatar_url END FROM account.user_account WHERE id = @id", ("id", userId));
        await using var reader = await user.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return (new(userId, reader.GetString(0), reader.NullableString(1), reader.NullableString(2), csrf, expires), token);
    }

    private async Task<int> ResolveApiQuotaAsync(Guid userId, CancellationToken cancellationToken)
    {
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command("""
                SELECT entitlement_value FROM account.entitlement
                WHERE user_id = @user_id AND entitlement_key = 'api.daily_quota' AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
                ORDER BY starts_at DESC LIMIT 1
                """, ("user_id", userId));
            var raw = await command.ExecuteScalarAsync(cancellationToken) as string;
            return int.TryParse(raw, out var quota) && quota > 0 ? quota : 1000;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    private async Task<int> ExecuteAsync(string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] args)
    {
        await OpenAsync(cancellationToken);
        try
        {
            await using var command = Command(sql, args);
            return await command.ExecuteNonQueryAsync(cancellationToken);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    private DbCommand Command(string sql, params (string Name, object? Value)[] args) => db.Command(sql, args);

    /// <summary>
    /// Login em transação Serializable: dois logins simultâneos podem colidir (SQLSTATE 40001) sem erro de ninguém.
    /// A tentativa que colide é desfeita por inteiro (o desafio continua sem uso), então repetir é seguro.
    /// </summary>
    private static async Task<T> RetrySerializableAsync<T>(Func<Task<T>> attempt, CancellationToken cancellationToken)
    {
        const int attempts = 4;
        for (var round = 1; ; round++)
        {
            try
            {
                return await attempt();
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.SerializationFailure && round < attempts)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(Random.Shared.Next(10, 40) * round), cancellationToken);
            }
        }
    }

    /// <summary>Trava a linha da conta até o fim da transação: serializa contagem + inserção contra o limite do plano.</summary>
    private async Task LockUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var command = Command("SELECT 1 FROM account.user_account WHERE id = @id FOR UPDATE", ("id", userId));
        await command.ExecuteScalarAsync(cancellationToken);
    }

    private static SavedItemDto ReadSavedItem(DbDataReader reader) =>
        new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.NullableString(4), reader.NullableString(5),
            Json(reader.GetString(6)), reader.GetFieldValue<DateTimeOffset>(7), reader.NullableString(8));

    private Task OpenAsync(CancellationToken cancellationToken) => db.Database.OpenConnectionAsync(cancellationToken);

    private static string NormalizeEmail(string value)
    {
        var email = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (email.Length is < 3 or > 254 || !email.Contains('@')) throw new ArgumentException("E-mail inválido.");
        return email;
    }

    /// <summary>
    /// Só caminho local: começa com uma única "/", sem "\" (que navegadores tratam como "/") e sem
    /// caracteres de controle. Qualquer outra coisa volta para "/" (sem open redirect).
    /// </summary>
    public static string NormalizeReturnTo(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 512) return "/";
        if (!value.StartsWith('/') || value.StartsWith("//", StringComparison.Ordinal)) return "/";
        return value.Contains('\\') || value.Any(char.IsControl) ? "/" : value;
    }

    private static void ValidateCollection(string collection)
    {
        if (collection is not ("favorite" or "watchlist")) throw new ArgumentException("Coleção inválida.");
    }

    private static void ValidateResource(string resourceType, string resourceKey)
    {
        string[] allowed = ["politician", "party", "municipality", "state", "election", "candidacy", "poll", "ranking", "indicator"];
        if (!allowed.Contains(resourceType, StringComparer.Ordinal)) throw new ArgumentException("Tipo de recurso inválido.");
        if (string.IsNullOrWhiteSpace(resourceKey) || resourceKey.Length > 240) throw new ArgumentException("Chave de recurso inválida.");
    }

    private static string CreateToken(int bytes) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string? HashOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : Hash(value);
    private static string? IpPrefix(string? ip)
    {
        if (string.IsNullOrWhiteSpace(ip)) return null;
        var parts = ip.Split('.');
        return parts.Length == 4 ? string.Join('.', parts.Take(3)) : ip.Split(':').Take(4).Aggregate(new StringBuilder(), (b, part) => b.Length == 0 ? b.Append(part) : b.Append(':').Append(part)).ToString();
    }
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();
}
