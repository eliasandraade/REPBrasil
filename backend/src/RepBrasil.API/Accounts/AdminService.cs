using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Accounts;

/// <summary>Quem executa a ação administrativa (registrado na auditoria).</summary>
public sealed record AdminActor(Guid UserId, string Email, string Route);

public sealed record AdminUserQuery(string? Q, string? Plan, string? Role, string? Status, string? Sort, string? Dir, int Page = 1, int PageSize = 25);

public sealed record AdminUserRow(
    Guid Id,
    string Email,
    string? DisplayName,
    string Status,
    string Plan,
    string PlanSource,
    string Role,
    bool ConfiguredSuperadmin,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    int ActiveSessions);

public sealed record AdminUserPage(IReadOnlyList<AdminUserRow> Items, int Total, int Page, int PageSize, bool Truncated);

public sealed record AdminSubscriptionRow(
    Guid Id,
    Guid UserId,
    string Email,
    string Plan,
    string Status,
    string Provider,
    DateTimeOffset? CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CanceledAt,
    bool CountsNow);

public sealed record AdminEntitlementRow(string Key, string Value, string Source, DateTimeOffset StartsAt, DateTimeOffset? ExpiresAt);

public sealed record AuditEntry(
    Guid Id,
    Guid ActorUserId,
    string ActorEmail,
    string Action,
    Guid? TargetUserId,
    string? TargetLabel,
    JsonElement? Before,
    JsonElement? After,
    JsonElement Context,
    DateTimeOffset CreatedAt);

public sealed record AdminUserDetail(
    Guid Id,
    string Email,
    string? DisplayName,
    string? FullName,
    string? StateCode,
    string? MunicipalityName,
    string? UsageType,
    string Status,
    string? DisabledReason,
    DateTimeOffset? DisabledAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    int ActiveSessions,
    IReadOnlyList<string> Providers,
    bool ConfiguredSuperadmin,
    EffectiveAccess Access,
    IReadOnlyList<AdminEntitlementRow> Entitlements,
    IReadOnlyList<AdminSubscriptionRow> Subscriptions,
    AccountUsage Usage,
    IReadOnlyList<AuditEntry> Audit);

/// <summary>Recusa de regra administrativa (409): último Super Admin, ação sobre si mesmo, e-mail em uso.</summary>
public sealed class AdminConflictException(string code, string message) : InvalidOperationException(message)
{
    public string Code { get; } = code;
}

public sealed class AdminNotFoundException() : InvalidOperationException("Conta não encontrada.");

/// <summary>
/// Operações do Super Admin sobre contas. Toda alteração grava a auditoria (antes/depois, sem segredo) na mesma
/// transação; papel e suspensão passam por uma trava única, para nunca sobrar zero Super Admin.
/// </summary>
public sealed class AdminService(ApplicationDbContext db, AccountAccessService access, ProfileService profiles, IConfiguration configuration)
{
    public const int MaxListed = 5000;
    private const long RoleLock = 727_100_002;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static IReadOnlyList<string> GrantableKeys { get; } =
        [.. PlanCatalog.Capabilities.Select(c => c.Key), "api.daily_quota"];

    // ─── Leitura ────────────────────────────────────────────────────────────────

    public async Task<AdminUserPage> ListUsersAsync(AdminUserQuery query, CancellationToken ct)
    {
        var page = Math.Max(1, query.Page);
        var size = Math.Clamp(query.PageSize, 1, 100);
        var rows = await LoadUsersAsync(query.Q, null, ct);
        var filtered = rows.Users
            .Where(u => query.Status is not ("active" or "suspended") || u.Status == query.Status)
            .Where(u => !PlanCatalog.IsPlan(query.Plan) || u.Plan == query.Plan)
            .Where(u => query.Role is not (EntitlementResolver.UserRole or EntitlementResolver.SuperadminRole) || u.Role == query.Role);
        var descending = !string.Equals(query.Dir, "asc", StringComparison.OrdinalIgnoreCase);
        IEnumerable<AdminUserRow> sorted = (query.Sort ?? "created") switch
        {
            "email" => descending ? filtered.OrderByDescending(u => u.Email, StringComparer.Ordinal) : filtered.OrderBy(u => u.Email, StringComparer.Ordinal),
            "lastSeen" => descending ? filtered.OrderByDescending(u => u.LastSeenAt ?? DateTimeOffset.MinValue) : filtered.OrderBy(u => u.LastSeenAt ?? DateTimeOffset.MinValue),
            "plan" => descending ? filtered.OrderByDescending(u => PlanCatalog.Get(u.Plan).Rank) : filtered.OrderBy(u => PlanCatalog.Get(u.Plan).Rank),
            _ => descending ? filtered.OrderByDescending(u => u.CreatedAt) : filtered.OrderBy(u => u.CreatedAt),
        };
        var all = sorted.ToList();
        return new(all.Skip((page - 1) * size).Take(size).ToList(), all.Count, page, size, rows.Truncated);
    }

    /// <summary>Todas as contas (até <see cref="MaxListed"/>), com o acesso efetivo resolvido: base dos totais do diagnóstico.</summary>
    public async Task<(IReadOnlyList<AdminUserRow> Users, bool Truncated)> AllUsersAsync(CancellationToken ct)
    {
        var loaded = await LoadUsersAsync(null, null, ct);
        return (loaded.Users, loaded.Truncated);
    }

    public async Task<AdminUserDetail> GetUserAsync(Guid userId, CancellationToken ct)
    {
        var listed = await LoadUsersAsync(null, userId, ct);
        var row = listed.Users.SingleOrDefault() ?? throw new AdminNotFoundException();
        var profile = await profiles.GetAsync(userId, ct);
        var usage = await profiles.UsageAsync(userId, ct);
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            string? reason = null;
            DateTimeOffset? disabledAt = null;
            await using (var command = db.Command("SELECT disabled_reason, disabled_at FROM account.user_account WHERE id = @id", ("id", userId)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                if (await reader.ReadAsync(ct)) (reason, disabledAt) = (reader.NullableString(0), reader.NullableTime(1));
            }
            var providers = new List<string>();
            await using (var command = db.Command("SELECT DISTINCT provider FROM account.identity WHERE user_id = @id ORDER BY provider", ("id", userId)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct)) providers.Add(reader.GetString(0));
            }
            var entitlements = new List<AdminEntitlementRow>();
            await using (var command = db.Command("""
                SELECT entitlement_key, entitlement_value, source, starts_at, expires_at
                  FROM account.entitlement
                 WHERE user_id = @id AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
                 ORDER BY entitlement_key, source
                """, ("id", userId)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                    entitlements.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<DateTimeOffset>(3), reader.NullableTime(4)));
            }
            var subscriptions = await ReadSubscriptionsAsync(new SubscriptionFilter(userId, null, false), ct);
            var audit = await ReadAuditAsync(null, userId, 20, 0, ct);
            var resolved = await access.ResolveAsync(userId, row.Email, ct);
            return new(
                row.Id, row.Email, row.DisplayName, profile.FullName, profile.StateCode, profile.MunicipalityName, profile.UsageType,
                row.Status, reason, disabledAt, row.CreatedAt, row.LastSeenAt, row.ActiveSessions, providers,
                row.ConfiguredSuperadmin, resolved, entitlements, subscriptions, usage, audit);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public async Task<IReadOnlyList<AdminSubscriptionRow>> ListSubscriptionsAsync(string? status, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            var valid = status is "active" or "past_due" or "canceled" or "expired";
            return await ReadSubscriptionsAsync(new SubscriptionFilter(null, valid ? status : null, false), ct);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public async Task<(IReadOnlyList<AuditEntry> Items, int Total)> ListAuditAsync(string? action, Guid? target, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var count = db.Command("""
                SELECT count(*)::int FROM account.admin_audit_log a
                 WHERE (@action = '' OR a.action = @action) AND (@target::uuid IS NULL OR a.target_user_id = @target::uuid)
                """, ("action", action ?? ""), ("target", target));
            var total = (int)(await count.ExecuteScalarAsync(ct))!;
            var items = await ReadAuditAsync(action, target, pageSize, (page - 1) * pageSize, ct);
            return (items, total);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    // ─── Ações ──────────────────────────────────────────────────────────────────

    public Task<AdminUserDetail> SuspendAsync(AdminActor actor, Guid userId, string? reason, CancellationToken ct) =>
        MutateAsync(actor, userId, async target =>
        {
            if (userId == actor.UserId) throw new AdminConflictException("self", "Você não pode suspender a própria conta.");
            var text = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
            if (text is { Length: > 300 }) throw new ArgumentException("Motivo: no máximo 300 caracteres.");
            if (target.Suspended) return null;
            await EnsureAnotherSuperadminAsync(userId, ct);
            await ExecuteAsync("UPDATE account.user_account SET disabled_at = now(), disabled_reason = @reason, updated_at = now() WHERE id = @id",
                ct, ("reason", text), ("id", userId));
            await ExecuteAsync("UPDATE account.session SET revoked_at = now() WHERE user_id = @id AND revoked_at IS NULL", ct, ("id", userId));
            return new AuditChange("user.suspend", new { status = "active" }, new { status = "suspended", reason = text });
        }, ct);

    public Task<AdminUserDetail> ReactivateAsync(AdminActor actor, Guid userId, CancellationToken ct) =>
        MutateAsync(actor, userId, async target =>
        {
            if (!target.Suspended) return null;
            await using (var clash = db.Command("SELECT EXISTS (SELECT 1 FROM account.user_account WHERE email = @email AND disabled_at IS NULL AND id <> @id)",
                ("email", target.Email), ("id", userId)))
            {
                if (await clash.ExecuteScalarAsync(ct) is true)
                    throw new AdminConflictException("email_in_use", "Outra conta ativa usa este e-mail; resolva essa conta antes de reativar.");
            }
            await ExecuteAsync("UPDATE account.user_account SET disabled_at = NULL, disabled_reason = NULL, updated_at = now() WHERE id = @id", ct, ("id", userId));
            return new AuditChange("user.reactivate", new { status = "suspended" }, new { status = "active" });
        }, ct);

    public Task<AdminUserDetail> SetRoleAsync(AdminActor actor, Guid userId, string role, CancellationToken ct) =>
        MutateAsync(actor, userId, async target =>
        {
            if (role is not (EntitlementResolver.UserRole or EntitlementResolver.SuperadminRole)) throw new ArgumentException("Papel inválido.");
            var current = target.Role;
            if (current == role) return null;
            if (role == EntitlementResolver.UserRole)
            {
                if (target.Configured)
                    throw new AdminConflictException("configured", "Este Super Admin vem da configuração do servidor (Auth:SuperadminEmails) e não muda pela interface.");
                if (userId == actor.UserId) throw new AdminConflictException("self", "Você não pode remover o próprio papel de Super Admin.");
                await EnsureAnotherSuperadminAsync(userId, ct);
                await ExpireGrantAsync(userId, EntitlementResolver.RoleKey, ct);
            }
            else
            {
                await UpsertGrantAsync(userId, EntitlementResolver.RoleKey, EntitlementResolver.SuperadminRole, null, ct);
            }
            return new AuditChange("user.role", new { role = current }, new { role });
        }, ct);

    public Task<AdminUserDetail> SetPlanAsync(AdminActor actor, Guid userId, string plan, DateTimeOffset? expiresAt, CancellationToken ct) =>
        MutateAsync(actor, userId, async target =>
        {
            if (!PlanCatalog.IsPlan(plan)) throw new ArgumentException("Plano inválido.");
            if (expiresAt is { } end && end <= DateTimeOffset.UtcNow) throw new ArgumentException("A validade precisa estar no futuro.");
            var before = await ReadGrantAsync(userId, EntitlementResolver.PlanKey, ct);
            if (plan == PlanCatalog.Free) await ExpireGrantAsync(userId, EntitlementResolver.PlanKey, ct);
            else await UpsertGrantAsync(userId, EntitlementResolver.PlanKey, plan, expiresAt, ct);
            return new AuditChange("user.plan",
                new { effectivePlan = target.Plan, manualPlan = before?.Value, manualExpiresAt = before?.ExpiresAt },
                new { manualPlan = plan == PlanCatalog.Free ? null : plan, manualExpiresAt = plan == PlanCatalog.Free ? null : expiresAt });
        }, ct);

    public Task<AdminUserDetail> GrantAsync(AdminActor actor, Guid userId, string key, string value, DateTimeOffset? expiresAt, CancellationToken ct) =>
        MutateAsync(actor, userId, async _ =>
        {
            ValidateGrant(key, value);
            if (expiresAt is { } end && end <= DateTimeOffset.UtcNow) throw new ArgumentException("A validade precisa estar no futuro.");
            var before = await ReadGrantAsync(userId, key, ct);
            await UpsertGrantAsync(userId, key, value.Trim(), expiresAt, ct);
            return new AuditChange("user.entitlement.grant", before, new { key, value = value.Trim(), expiresAt });
        }, ct);

    public Task<AdminUserDetail> RevokeAsync(AdminActor actor, Guid userId, string key, CancellationToken ct) =>
        MutateAsync(actor, userId, async _ =>
        {
            if (key is EntitlementResolver.RoleKey or EntitlementResolver.PlanKey)
                throw new ArgumentException("Papel e plano mudam pelas ações próprias.");
            var before = await ReadGrantAsync(userId, key, ct);
            if (before is null) return null;
            await ExpireGrantAsync(userId, key, ct);
            return new AuditChange("user.entitlement.revoke", before, null);
        }, ct);

    public Task<AdminUserDetail> UpsertSubscriptionAsync(
        AdminActor actor, Guid userId, string plan, string status, DateTimeOffset? currentPeriodEnd, string? notes, CancellationToken ct) =>
        MutateAsync(actor, userId, async _ =>
        {
            if (!PlanCatalog.IsPaidPlan(plan)) throw new ArgumentException("A assinatura precisa de um plano pago.");
            if (status is not ("active" or "past_due" or "canceled" or "expired")) throw new ArgumentException("Status inválido.");
            var text = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
            if (text is { Length: > 500 }) throw new ArgumentException("Observação: no máximo 500 caracteres.");
            var existing = await ReadSubscriptionsAsync(new SubscriptionFilter(userId, null, true), ct);
            var live = existing.FirstOrDefault();
            if (live is null)
            {
                await ExecuteAsync("""
                    INSERT INTO account.subscription (id, user_id, plan, status, provider, current_period_end, notes, canceled_at)
                    VALUES (@sid, @id, @plan, @status, 'manual', @end, @notes, CASE WHEN @status IN ('canceled', 'expired') THEN now() END)
                    """, ct, ("sid", Guid.NewGuid()), ("id", userId), ("plan", plan), ("status", status), ("end", currentPeriodEnd), ("notes", text));
            }
            else
            {
                await ExecuteAsync("""
                    UPDATE account.subscription
                       SET plan = @plan, status = @status, current_period_end = @end, notes = @notes, updated_at = now(),
                           canceled_at = CASE WHEN @status IN ('canceled', 'expired') THEN COALESCE(canceled_at, now()) ELSE NULL END
                     WHERE id = @sid
                    """, ct, ("plan", plan), ("status", status), ("end", currentPeriodEnd), ("notes", text), ("sid", live.Id));
            }
            return new AuditChange("user.subscription",
                live is null ? null : new { live.Plan, live.Status, live.CurrentPeriodEnd, live.Notes },
                new { plan, status, currentPeriodEnd, notes = text });
        }, ct);

    // ─── Internos ───────────────────────────────────────────────────────────────

    private sealed record Target(string Email, bool Suspended, string Role, string Plan, bool Configured);

    private sealed record AuditChange(string Action, object? Before, object? After);

    private sealed record LoadedUsers(IReadOnlyList<AdminUserRow> Users, bool Truncated);

    /// <summary>Filtro de assinaturas: conta, status e "só a manual viva" (a que o Super Admin edita).</summary>
    private sealed record SubscriptionFilter(Guid? UserId, string? Status, bool ManualLiveOnly);

    /// <summary>
    /// Ação sobre uma conta, numa transação: trava de papéis, alvo existente, a mudança e a auditoria juntas.
    /// <paramref name="change"/> devolve nulo quando nada mudou (sem auditoria).
    /// </summary>
    private async Task<AdminUserDetail> MutateAsync(AdminActor actor, Guid userId, Func<Target, Task<AuditChange?>> change, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await ExecuteAsync("SELECT pg_advisory_xact_lock(@key)", ct, ("key", RoleLock));
            var target = await ReadTargetAsync(userId, ct) ?? throw new AdminNotFoundException();
            var audit = await change(target);
            if (audit is not null)
            {
                await ExecuteAsync("""
                    INSERT INTO account.admin_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_label, before, after, context)
                    VALUES (@id, @actor, @actor_email, @action, @target, @label, CAST(@before AS jsonb), CAST(@after AS jsonb), CAST(@context AS jsonb))
                    """, ct,
                    ("id", Guid.NewGuid()), ("actor", actor.UserId), ("actor_email", actor.Email), ("action", audit.Action),
                    ("target", userId), ("label", target.Email),
                    ("before", audit.Before is null ? null : JsonSerializer.Serialize(audit.Before, Json)),
                    ("after", audit.After is null ? null : JsonSerializer.Serialize(audit.After, Json)),
                    ("context", JsonSerializer.Serialize(new { route = actor.Route }, Json)));
            }
            await transaction.CommitAsync(ct);
        }
        finally { await db.Database.CloseConnectionAsync(); }
        return await GetUserAsync(userId, ct);
    }

    private async Task<Target?> ReadTargetAsync(Guid userId, CancellationToken ct)
    {
        string email;
        bool suspended;
        await using (var command = db.Command("SELECT email, disabled_at IS NOT NULL FROM account.user_account WHERE id = @id FOR UPDATE", ("id", userId)))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            if (!await reader.ReadAsync(ct)) return null;
            (email, suspended) = (reader.GetString(0), reader.GetBoolean(1));
        }
        var resolved = await access.ResolveAsync(userId, email, ct);
        return new(email, suspended, resolved.Role, resolved.Plan, access.IsConfiguredSuperadmin(email));
    }

    /// <summary>Recusa (409) quando, sem o alvo, não sobraria nenhum Super Admin capaz de entrar.</summary>
    private async Task EnsureAnotherSuperadminAsync(Guid excluded, CancellationToken ct)
    {
        var configured = ConfiguredEmails();
        await using var command = db.Command("""
            SELECT
              (SELECT count(*) FROM unnest(@configured::text[]) AS c(email)
                WHERE NOT EXISTS (
                  SELECT 1 FROM account.user_account u
                   WHERE u.email = c.email AND (u.disabled_at IS NOT NULL OR u.id = @excluded)))
              +
              (SELECT count(DISTINCT u.id) FROM account.user_account u
                 JOIN account.entitlement e ON e.user_id = u.id
                WHERE e.entitlement_key = 'account.role' AND e.entitlement_value = 'superadmin'
                  AND e.starts_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now())
                  AND u.disabled_at IS NULL AND u.id <> @excluded AND NOT (u.email = ANY(@configured::text[])))
            """, ("configured", configured), ("excluded", excluded));
        var remaining = Convert.ToInt64(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
        if (remaining == 0)
            throw new AdminConflictException("last_superadmin", "Esta é a última conta de Super Admin ativa; conceda o papel a outra conta antes.");
    }

    private string[] ConfiguredEmails() =>
        [.. (configuration["Auth:SuperadminEmails"] ?? string.Empty)
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(e => e.ToLowerInvariant())];

    private static void ValidateGrant(string key, string value)
    {
        if (!GrantableKeys.Contains(key, StringComparer.Ordinal)) throw new ArgumentException("Concessão fora do catálogo.");
        var text = (value ?? string.Empty).Trim();
        var valid = PlanCatalog.IsFeature(key)
            ? text is "true" or "false"
            : int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number) && number is >= 0 and <= 10_000_000;
        if (!valid) throw new ArgumentException(PlanCatalog.IsFeature(key) ? "Valor deve ser true ou false." : "Valor deve ser um inteiro não negativo.");
    }

    private Task UpsertGrantAsync(Guid userId, string key, string value, DateTimeOffset? expiresAt, CancellationToken ct) =>
        ExecuteAsync("""
            INSERT INTO account.entitlement (id, user_id, entitlement_key, entitlement_value, source, starts_at, expires_at)
            VALUES (@gid, @id, @key, @value, 'admin', now(), @expires)
            ON CONFLICT (user_id, entitlement_key, source)
            DO UPDATE SET entitlement_value = EXCLUDED.entitlement_value, starts_at = now(), expires_at = EXCLUDED.expires_at, updated_at = now()
            """, ct, ("gid", Guid.NewGuid()), ("id", userId), ("key", key), ("value", value), ("expires", expiresAt));

    private Task ExpireGrantAsync(Guid userId, string key, CancellationToken ct) =>
        ExecuteAsync("""
            UPDATE account.entitlement SET expires_at = now(), updated_at = now()
             WHERE user_id = @id AND entitlement_key = @key AND (expires_at IS NULL OR expires_at > now())
            """, ct, ("id", userId), ("key", key));

    private async Task<AdminEntitlementRow?> ReadGrantAsync(Guid userId, string key, CancellationToken ct)
    {
        await using var command = db.Command("""
            SELECT entitlement_key, entitlement_value, source, starts_at, expires_at FROM account.entitlement
             WHERE user_id = @id AND entitlement_key = @key AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
             ORDER BY starts_at DESC LIMIT 1
            """, ("id", userId), ("key", key));
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<DateTimeOffset>(3), reader.NullableTime(4))
            : null;
    }

    private async Task<LoadedUsers> LoadUsersAsync(string? q, Guid? only, CancellationToken ct)
    {
        var text = (q ?? string.Empty).Trim();
        var like = "%" + text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal) + "%";
        var basics = new List<(Guid Id, string Email, string? Name, bool Suspended, DateTimeOffset Created, DateTimeOffset? LastSeen, int Sessions)>();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using (var command = db.Command("""
                SELECT u.id, u.email, u.display_name, u.disabled_at IS NOT NULL, u.created_at,
                       (SELECT max(s.last_seen_at) FROM account.session s WHERE s.user_id = u.id),
                       (SELECT count(*) FROM account.session s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())::int
                  FROM account.user_account u
                 WHERE (@only::uuid IS NULL OR u.id = @only::uuid)
                   AND (@q = '' OR u.email ILIKE @like OR u.display_name ILIKE @like OR u.full_name ILIKE @like)
                 ORDER BY u.created_at DESC
                 LIMIT @limit
                """, ("only", only), ("q", text), ("like", like), ("limit", MaxListed + 1)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                    basics.Add((reader.GetGuid(0), reader.GetString(1), reader.NullableString(2), reader.GetBoolean(3), reader.GetFieldValue<DateTimeOffset>(4), reader.NullableTime(5), reader.GetInt32(6)));
            }
            var truncated = basics.Count > MaxListed;
            if (truncated) basics.RemoveAt(basics.Count - 1);
            var ids = basics.Select(b => b.Id).ToArray();

            var subscriptions = new Dictionary<Guid, List<SubscriptionFact>>();
            await using (var command = db.Command("""
                SELECT user_id, id, plan, status, provider, current_period_end, cancel_at_period_end, created_at
                  FROM account.subscription WHERE user_id = ANY(@ids)
                """, ("ids", ids)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    var fact = new SubscriptionFact(reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.NullableTime(5), reader.GetBoolean(6), reader.GetFieldValue<DateTimeOffset>(7));
                    Bucket(subscriptions, reader.GetGuid(0)).Add(fact);
                }
            }
            var grants = new Dictionary<Guid, List<EntitlementFact>>();
            await using (var command = db.Command("""
                SELECT user_id, entitlement_key, entitlement_value, source, starts_at, expires_at
                  FROM account.entitlement
                 WHERE user_id = ANY(@ids) AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
                """, ("ids", ids)))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    var fact = new EntitlementFact(reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetFieldValue<DateTimeOffset>(4), reader.NullableTime(5));
                    Bucket(grants, reader.GetGuid(0)).Add(fact);
                }
            }

            var now = DateTimeOffset.UtcNow;
            var users = basics.Select(b =>
            {
                var configured = access.IsConfiguredSuperadmin(b.Email);
                var resolved = EntitlementResolver.Resolve(configured, subscriptions.GetValueOrDefault(b.Id) ?? [], grants.GetValueOrDefault(b.Id) ?? [], now);
                return new AdminUserRow(b.Id, b.Email, b.Name, b.Suspended ? "suspended" : "active", resolved.Plan, resolved.PlanSource, resolved.Role,
                    configured, b.Created, b.LastSeen, b.Sessions);
            }).ToList();
            return new(users, truncated);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    private async Task<List<AdminSubscriptionRow>> ReadSubscriptionsAsync(SubscriptionFilter filter, CancellationToken ct)
    {
        var rows = new List<AdminSubscriptionRow>();
        await using var command = db.Command("""
            SELECT s.id, s.user_id, u.email, s.plan, s.status, s.provider, s.current_period_end, s.cancel_at_period_end, s.notes,
                   s.created_at, s.updated_at, s.canceled_at
              FROM account.subscription s
              JOIN account.user_account u ON u.id = s.user_id
             WHERE (@user::uuid IS NULL OR s.user_id = @user::uuid)
               AND (@status = '' OR s.status = @status)
               AND (NOT @manual_live OR (s.provider = 'manual' AND s.status IN ('active', 'past_due')))
             ORDER BY s.updated_at DESC
             LIMIT 500
            """, ("user", filter.UserId), ("status", filter.Status ?? ""), ("manual_live", filter.ManualLiveOnly));
        await using var reader = await command.ExecuteReaderAsync(ct);
        var now = DateTimeOffset.UtcNow;
        while (await reader.ReadAsync(ct))
        {
            var fact = new SubscriptionFact(reader.GetGuid(0), reader.GetString(3), reader.GetString(4), reader.GetString(5), reader.NullableTime(6), reader.GetBoolean(7), reader.GetFieldValue<DateTimeOffset>(9));
            rows.Add(new(fact.Id, reader.GetGuid(1), reader.GetString(2), fact.Plan, fact.Status, fact.Provider, fact.CurrentPeriodEnd, fact.CancelAtPeriodEnd,
                reader.NullableString(8), fact.CreatedAt, reader.GetFieldValue<DateTimeOffset>(10), reader.NullableTime(11), EntitlementResolver.Counts(fact, now)));
        }
        return rows;
    }

    private async Task<List<AuditEntry>> ReadAuditAsync(string? action, Guid? target, int limit, int offset, CancellationToken ct)
    {
        var rows = new List<AuditEntry>();
        await using var command = db.Command("""
            SELECT a.id, a.actor_user_id, a.actor_email, a.action, a.target_user_id, a.target_label, a.before::text, a.after::text, a.context::text, a.created_at
              FROM account.admin_audit_log a
             WHERE (@action = '' OR a.action = @action) AND (@target::uuid IS NULL OR a.target_user_id = @target::uuid)
             ORDER BY a.created_at DESC, a.id
             LIMIT @limit OFFSET @offset
            """, ("action", action ?? ""), ("target", target), ("limit", limit), ("offset", offset));
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetGuid(4),
                reader.NullableString(5), ParseJson(reader, 6), ParseJson(reader, 7), ParseJson(reader, 8) ?? EmptyObject, reader.GetFieldValue<DateTimeOffset>(9)));
        }
        return rows;
    }

    private static readonly JsonElement EmptyObject = JsonDocument.Parse("{}").RootElement.Clone();

    private static List<T> Bucket<T>(Dictionary<Guid, List<T>> buckets, Guid key)
    {
        if (!buckets.TryGetValue(key, out var bucket))
        {
            bucket = [];
            buckets[key] = bucket;
        }
        return bucket;
    }

    private static JsonElement? ParseJson(DbDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : JsonDocument.Parse(reader.GetString(ordinal)).RootElement.Clone();

    private async Task ExecuteAsync(string sql, CancellationToken ct, params (string Name, object? Value)[] args)
    {
        await using var command = db.Command(sql, args);
        await command.ExecuteNonQueryAsync(ct);
    }
}
