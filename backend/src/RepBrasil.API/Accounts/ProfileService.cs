using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Territories;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Accounts;

/// <summary>Perfil da conta. O e-mail é a identidade do login e não se edita aqui.</summary>
public sealed record ProfileDto(
    string Email,
    string? DisplayName,
    string? FullName,
    string? ProviderAvatarUrl,
    bool AvatarHidden,
    string? StateCode,
    string? MunicipalityIbgeCode,
    string? MunicipalityName,
    string? UsageType,
    DateTimeOffset? CustomizedAt);

/// <summary>Perfil enviado pela conta. Campos vazios limpam o valor.</summary>
public sealed record ProfileUpdate(
    string? DisplayName,
    string? FullName,
    string? StateCode,
    string? MunicipalityIbgeCode,
    string? UsageType,
    bool AvatarHidden);

/// <summary>Uso da conta frente aos limites do plano.</summary>
public sealed record AccountUsage(int Favorites, int Watchlist, int Alerts, int UnreadNotifications);

/// <summary>
/// Leitura e gravação do perfil. Coleta só o necessário ao produto (nome, UF/município para personalização
/// territorial, tipo de uso); nunca CPF, partido, candidato, ideologia, religião ou intenção de voto.
/// </summary>
public sealed class ProfileService(ApplicationDbContext db, TerritoryCatalogService territories)
{
    public static IReadOnlyList<string> UsageTypes { get; } =
        ["eleitor", "estudante_pesquisador", "jornalista", "assessor_politico", "servidor_publico", "outro"];

    public async Task<ProfileDto> GetAsync(Guid userId, CancellationToken cancellationToken)
    {
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Command("""
                SELECT u.email, u.display_name, u.full_name, u.avatar_url, u.avatar_hidden, u.state_code,
                       u.municipality_ibge_code, m.name, u.usage_type, u.profile_customized_at
                  FROM account.user_account u
                  LEFT JOIN electoral.municipality m
                    ON m.state_code = u.state_code AND m.ibge_code = CAST(u.municipality_ibge_code AS integer)
                 WHERE u.id = @id
                """, ("id", userId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) throw new InvalidOperationException("Conta não encontrada.");
            return new(
                reader.GetString(0), reader.NullableString(1), reader.NullableString(2), reader.NullableString(3), reader.GetBoolean(4),
                reader.NullableString(5), reader.NullableString(6), reader.NullableString(7), reader.NullableString(8), reader.NullableTime(9));
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    /// <summary>Valida e grava o perfil inteiro (<see cref="ArgumentException"/> com mensagem para a pessoa).</summary>
    public async Task<ProfileDto> UpdateAsync(Guid userId, ProfileUpdate update, CancellationToken cancellationToken)
    {
        var displayName = Text(update.DisplayName, 80, "Nome de exibição");
        var fullName = Text(update.FullName, 120, "Nome");
        var stateCode = BrazilianStates.Normalize(update.StateCode);
        if (stateCode is not null && !BrazilianStates.IsValid(stateCode)) throw new ArgumentException("UF inválida.");
        var municipality = string.IsNullOrWhiteSpace(update.MunicipalityIbgeCode) ? null : update.MunicipalityIbgeCode.Trim();
        if (municipality is not null)
        {
            if (stateCode is null) throw new ArgumentException("Escolha a UF antes do município.");
            if (await territories.MunicipalityAsync(stateCode, municipality, cancellationToken) is null)
                throw new ArgumentException("Município não encontrado nessa UF.");
        }
        var usageType = string.IsNullOrWhiteSpace(update.UsageType) ? null : update.UsageType.Trim();
        if (usageType is not null && !UsageTypes.Contains(usageType, StringComparer.Ordinal)) throw new ArgumentException("Tipo de uso inválido.");

        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Command("""
                UPDATE account.user_account
                   SET display_name = @display_name, full_name = @full_name, state_code = @state_code,
                       municipality_ibge_code = @municipality, usage_type = @usage_type, avatar_hidden = @avatar_hidden,
                       profile_customized_at = now(), updated_at = now()
                 WHERE id = @id AND disabled_at IS NULL
                """,
                ("display_name", displayName), ("full_name", fullName), ("state_code", stateCode), ("municipality", municipality),
                ("usage_type", usageType), ("avatar_hidden", update.AvatarHidden), ("id", userId));
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) throw new InvalidOperationException("Conta não encontrada.");
        }
        finally { await db.Database.CloseConnectionAsync(); }
        return await GetAsync(userId, cancellationToken);
    }

    public async Task<AccountUsage> UsageAsync(Guid userId, CancellationToken cancellationToken)
    {
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Command("""
                SELECT (SELECT count(*) FROM account.saved_item WHERE user_id = @id AND collection = 'favorite')::int,
                       (SELECT count(*) FROM account.saved_item WHERE user_id = @id AND collection = 'watchlist')::int,
                       (SELECT count(*) FROM account.alert_subscription WHERE user_id = @id)::int,
                       (SELECT count(*) FROM account.notification WHERE user_id = @id AND read_at IS NULL)::int
                """, ("id", userId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            return new(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3));
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    private static string? Text(string? value, int max, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var text = value.Trim();
        if (text.Length > max) throw new ArgumentException($"{field}: no máximo {max} caracteres.");
        if (text.Any(char.IsControl)) throw new ArgumentException($"{field}: caracteres inválidos.");
        return text;
    }
}
