using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Accounts;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/admin")]
public sealed class AdminController(AccountAccessService access) : ControllerBase
{
    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var session = await access.SessionAsync(HttpContext, cancellationToken);
        if (session is null) return Unauthorized();
        // Sem esquema de autenticação registrado, Forbid() lançaria (500); a recusa é um 403 explícito.
        if (!(await access.AccessAsync(HttpContext, cancellationToken)).IsSuperadmin)
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "forbidden" });

        return Ok(new
        {
            id = session.UserId,
            email = session.Email,
            role = "superadmin"
        });
    }
}
