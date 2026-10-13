using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// Transporte TLS do RPC privado do lake eleitoral. O worker (etl/src/electoral/lake_tls.py) gera a
/// cada início um certificado autoassinado efêmero cujo Subject Key Identifier é
/// HMAC-SHA256(token, rótulo || SubjectPublicKeyInfo). Este cliente conhece o mesmo token
/// (REPBRASIL_LAKE_TOKEN) e só conclui o handshake se o HMAC da chave apresentada conferir: a
/// confiança vem do segredo compartilhado, não de uma CA, e nenhum certificado é aceito às cegas.
/// </summary>
public static class ElectoralLakeTransport
{
    public const string DefaultBaseUrl = "https://electoral-lake.railway.internal:8080";

    private static ReadOnlySpan<byte> BindingLabel => "repbrasil-electoral-lake-tls/v1\0"u8;

    /// <summary>
    /// Endereço do worker, sempre HTTPS: o worker só aceita RPC em TLS. Um <c>http://</c> legado
    /// é promovido para <c>https://</c> no mesmo host e porta, nunca o contrário.
    /// </summary>
    public static (Uri Address, bool UpgradedFromHttp) ResolveBaseAddress(string? configured)
    {
        var raw = string.IsNullOrWhiteSpace(configured) ? DefaultBaseUrl : configured.Trim();
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri))
            throw new InvalidOperationException("ElectoralLake:BaseUrl must be an absolute URL.");
        if (uri.Scheme == Uri.UriSchemeHttps)
            return (uri, false);
        if (uri.Scheme != Uri.UriSchemeHttp)
            throw new InvalidOperationException("ElectoralLake:BaseUrl must use https.");

        var secure = new UriBuilder(uri) { Scheme = Uri.UriSchemeHttps, Port = uri.Port };
        return (secure.Uri, true);
    }

    public static SocketsHttpHandler CreateHandler(string? token)
    {
        var secret = token?.Trim() ?? string.Empty;
        return new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            SslOptions = new SslClientAuthenticationOptions
            {
                EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
                RemoteCertificateValidationCallback = (_, certificate, _, _) => IsBoundToToken(certificate, secret),
            },
        };
    }

    /// <summary>
    /// Aceita o certificado somente se o Subject Key Identifier for o HMAC da chave pública
    /// apresentada, calculado com o token compartilhado (comparação em tempo constante).
    /// </summary>
    public static bool IsBoundToToken(X509Certificate? certificate, string? token)
    {
        if (certificate is not X509Certificate2 presented || string.IsNullOrEmpty(token))
            return false;

        var identifiers = presented.Extensions.OfType<X509SubjectKeyIdentifierExtension>().ToArray();
        if (identifiers.Length != 1)
            return false;

        var expected = TokenBinding(token, presented.PublicKey.ExportSubjectPublicKeyInfo());
        return CryptographicOperations.FixedTimeEquals(identifiers[0].SubjectKeyIdentifierBytes.Span, expected);
    }

    public static byte[] TokenBinding(string token, ReadOnlySpan<byte> subjectPublicKeyInfo)
    {
        var message = new byte[BindingLabel.Length + subjectPublicKeyInfo.Length];
        BindingLabel.CopyTo(message);
        subjectPublicKeyInfo.CopyTo(message.AsSpan(BindingLabel.Length));
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(token), message);
    }
}
