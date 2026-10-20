namespace RepBrasil.API.Accounts;

/// <summary>Sessão de pagamento aberta no provedor: a pessoa segue para <see cref="RedirectUrl"/>.</summary>
public sealed record BillingCheckout(Uri RedirectUrl);

/// <summary>Cobrança online indisponível (nenhum provedor configurado). Vira 503 <c>billing_unavailable</c>.</summary>
public sealed class BillingUnavailableException() : InvalidOperationException("Pagamento online ainda não disponível.");

/// <summary>
/// Abstração do provedor de pagamento. Um provedor real abre o checkout e confirma a assinatura por webhook
/// (atualizando <c>account.subscription</c>); o REPBrasil nunca recebe nem guarda dado de cartão.
/// </summary>
public interface IBillingProvider
{
    /// <summary>Nome do provedor, ou nulo quando não há.</summary>
    string? Name { get; }

    bool Available { get; }

    Task<BillingCheckout> StartCheckoutAsync(Guid userId, string email, string plan, CancellationToken cancellationToken);
}

/// <summary>
/// Estado atual: nenhum provedor contratado. Nada é cobrado nem simulado; assinaturas existem só como registro
/// manual do Super Admin. A interface mostra "Pagamento online ainda não disponível".
/// </summary>
public sealed class NoBillingProvider : IBillingProvider
{
    public string? Name => null;

    public bool Available => false;

    public Task<BillingCheckout> StartCheckoutAsync(Guid userId, string email, string plan, CancellationToken cancellationToken) =>
        throw new BillingUnavailableException();
}
