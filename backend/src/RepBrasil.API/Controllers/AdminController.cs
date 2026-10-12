using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/admin")]
public sealed class AdminController(AccountService accounts, ApplicationDbContext db) : ControllerBase
{
    private const string SessionCookie = "repbrasil_session";

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        if (session is null) return Unauthorized();
        if (!await IsSuperadminAsync(session.UserId, cancellationToken)) return Forbid();

        return Ok(new
        {
            id = session.UserId,
            email = session.Email,
            role = "superadmin"
        });
    }

    private async Task<AccountSession?> CurrentSession(CancellationToken cancellationToken)
    {
        var token = Request.Cookies.TryGetValue(SessionCookie, out var value) ? value : null;
        return await accounts.GetSessionAsync(token, cancellationToken);
    }

    private async Task<bool> IsSuperadminAsync(Guid userId, CancellationToken cancellationToken)
    {
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = """
                SELECT EXISTS (
                    SELECT 1
                    FROM account.entitlement
                    WHERE user_id = @user_id
                      AND entitlement_key = 'account.role'
                      AND entitlement_value = 'superadmin'
                      AND starts_at <= now()
                      AND (expires_at IS NULL OR expires_at > now())
                )
                """;

            var parameter = command.CreateParameter();
            parameter.ParameterName = "user_id";
            parameter.Value = userId;
            command.Parameters.Add(parameter);

            var result = await command.ExecuteScalarAsync(cancellationToken);
            return result is bool allowed && allowed;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}
