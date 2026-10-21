using System.Data.Common;
using System.Globalization;
using System.Net.Mail;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Accounts;

public sealed record SupportRequestInput(
    string Category,
    string? Name,
    string Email,
    string? Organization,
    string? RelatedSubject,
    string? SourceReference,
    string Message);

public sealed record SupportRequestRow(
    Guid Id,
    string Category,
    string? Name,
    string Email,
    string? Organization,
    string? RelatedSubject,
    string? SourceReference,
    string Message,
    string Status,
    Guid? UserId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// Pedidos enviados pela página de suporte: gravados de verdade e lidos na caixa do Super Admin. O IP não é
/// guardado, só o hash do prefixo (o mesmo tratamento das sessões), para o limite técnico por origem.
/// </summary>
public sealed class SupportService(ApplicationDbContext db)
{
    public static IReadOnlyList<string> Categories { get; } = ["duvida", "contestacao", "correcao_de_dado", "institucional", "erro_tecnico", "conta"];
    public static IReadOnlyList<string> Statuses { get; } = ["novo", "em_analise", "respondido", "arquivado"];

    public async Task<Guid> CreateAsync(SupportRequestInput input, Guid? userId, string? ipAddress, CancellationToken ct)
    {
        if (!Categories.Contains(input.Category, StringComparer.Ordinal)) throw new ArgumentException("Escolha o tipo de solicitação.");
        var email = (input.Email ?? string.Empty).Trim().ToLowerInvariant();
        if (email.Length is < 3 or > 254 || !MailAddress.TryCreate(email, out _)) throw new ArgumentException("Informe um e-mail válido para a resposta.");
        var message = (input.Message ?? string.Empty).Trim();
        if (message.Length is < 30 or > 5000) throw new ArgumentException("A mensagem precisa ter entre 30 e 5.000 caracteres.");
        var id = Guid.NewGuid();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var command = db.Command("""
                INSERT INTO account.support_request (id, category, name, email, organization, related_subject, source_reference, message, user_id, ip_hash)
                VALUES (@id, @category, @name, @email, @organization, @subject, @source, @message, @user, @ip)
                """,
                ("id", id), ("category", input.Category), ("name", Optional(input.Name, 120, "Nome")), ("email", email),
                ("organization", Optional(input.Organization, 160, "Organização")), ("subject", Optional(input.RelatedSubject, 240, "Assunto relacionado")),
                ("source", Optional(input.SourceReference, 500, "Fonte")), ("message", message), ("user", userId), ("ip", AccountService.HashedIpPrefix(ipAddress)));
            await command.ExecuteNonQueryAsync(ct);
        }
        finally { await db.Database.CloseConnectionAsync(); }
        return id;
    }

    private static SupportRequestRow Read(DbDataReader reader) =>
        new(reader.GetGuid(0), reader.GetString(1), reader.NullableString(2), reader.GetString(3), reader.NullableString(4),
            reader.NullableString(5), reader.NullableString(6), reader.GetString(7), reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetGuid(9), reader.GetFieldValue<DateTimeOffset>(10), reader.GetFieldValue<DateTimeOffset>(11));

    public async Task<IReadOnlyList<SupportRequestRow>> ListAsync(string? status, CancellationToken ct)
    {
        var rows = new List<SupportRequestRow>();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var command = db.Command("""
                SELECT id, category, name, email, organization, related_subject, source_reference, message, status, user_id, created_at, updated_at
                  FROM account.support_request
                 WHERE (@status = '' OR status = @status)
                 ORDER BY created_at DESC
                 LIMIT 200
                """, ("status", Statuses.Contains(status ?? "", StringComparer.Ordinal) ? status : ""));
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(Read(reader));
        }
        finally { await db.Database.CloseConnectionAsync(); }
        return rows;
    }

    /// <summary>Um pedido pelo id, fora da janela da caixa (que mostra só os 200 mais recentes).</summary>
    private async Task<SupportRequestRow?> GetAsync(Guid id, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var command = db.Command("""
                SELECT id, category, name, email, organization, related_subject, source_reference, message, status, user_id, created_at, updated_at
                  FROM account.support_request
                 WHERE id = @id
                """, ("id", id));
            await using var reader = await command.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct) ? Read(reader) : null;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    /// <summary>Muda o status de um pedido e registra a auditoria na mesma transação. Nulo se o pedido não existe.</summary>
    public async Task<SupportRequestRow?> SetStatusAsync(AdminActor actor, Guid id, string status, CancellationToken ct)
    {
        if (!Statuses.Contains(status, StringComparer.Ordinal)) throw new ArgumentException("Status inválido.");
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            string? before;
            string email;
            await using (var read = db.Command("SELECT status, email FROM account.support_request WHERE id = @id FOR UPDATE", ("id", id)))
            await using (var reader = await read.ExecuteReaderAsync(ct))
            {
                if (!await reader.ReadAsync(ct)) return null;
                (before, email) = (reader.GetString(0), reader.GetString(1));
            }
            if (before != status)
            {
                await using (var update = db.Command("UPDATE account.support_request SET status = @status, updated_at = now() WHERE id = @id", ("status", status), ("id", id)))
                    await update.ExecuteNonQueryAsync(ct);
                await using var audit = db.Command("""
                    INSERT INTO account.admin_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_label, before, after, context)
                    VALUES (@aid, @actor, @actor_email, 'support.status', NULL, @label, CAST(@before AS jsonb), CAST(@after AS jsonb), CAST(@context AS jsonb))
                    """,
                    ("aid", Guid.NewGuid()), ("actor", actor.UserId), ("actor_email", actor.Email), ("label", $"suporte {id.ToString()[..8]} · {email}"),
                    ("before", JsonSerializer.Serialize(new { status = before })), ("after", JsonSerializer.Serialize(new { status })),
                    ("context", JsonSerializer.Serialize(new { route = actor.Route, requestId = id })));
                await audit.ExecuteNonQueryAsync(ct);
            }
            await transaction.CommitAsync(ct);
        }
        finally { await db.Database.CloseConnectionAsync(); }
        return await GetAsync(id, ct);
    }

    private static string? Optional(string? value, int max, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var text = value.Trim();
        if (text.Length > max) throw new ArgumentException(string.Create(CultureInfo.InvariantCulture, $"{field}: no máximo {max} caracteres."));
        return text;
    }
}
