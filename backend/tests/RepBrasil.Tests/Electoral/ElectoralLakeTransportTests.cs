using System.Net;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Só roda com um worker real do lake em TLS (job "Lake RPC TLS" do CI): REPBRASIL_LAKE_TLS_TEST_URL
/// e REPBRASIL_LAKE_TLS_TEST_TOKEN (segredo fictício do CI).
/// </summary>
public sealed class LakeTlsWorkerFactAttribute : FactAttribute
{
    public const string UrlVariable = "REPBRASIL_LAKE_TLS_TEST_URL";
    public const string TokenVariable = "REPBRASIL_LAKE_TLS_TEST_TOKEN";

    public LakeTlsWorkerFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(UrlVariable))
            || string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(TokenVariable)))
            Skip = $"{UrlVariable}/{TokenVariable} não definidas (worker do lake em TLS)";
    }
}

public class ElectoralLakeTransportTests
{
    private const string Token = "ci-only-fictitious-lake-token";

    // Segredo FICTÍCIO do fixture gerado pelo worker Python (etl/tests/electoral/test_lake_tls.py).
    private const string FixtureToken = "ci-only-fictitious-lake-tls-fixture-token";

    private static byte[] IndependentBinding(string token, byte[] subjectPublicKeyInfo)
    {
        var message = Encoding.ASCII.GetBytes("repbrasil-electoral-lake-tls/v1\0").Concat(subjectPublicKeyInfo).ToArray();
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(token), message);
    }

    private static X509Certificate2 Certificate(string? bindingToken, bool tamper = false)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=repbrasil-electoral-lake", key, HashAlgorithmName.SHA256);
        if (bindingToken is not null)
        {
            var binding = IndependentBinding(bindingToken, key.ExportSubjectPublicKeyInfo());
            if (tamper)
                binding[^1] ^= 0x01;
            request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(binding, critical: false));
        }

        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddDays(1));
    }

    private static string FixturePath()
    {
        var relative = Path.Combine("etl", "tests", "electoral", "fixtures", "lake-tls", "token-bound-certificate.pem");
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, relative);
            if (File.Exists(candidate))
                return candidate;
        }

        throw new FileNotFoundException($"fixture compartilhado não encontrado: {relative}");
    }

    [Fact]
    public void Certificate_bound_to_the_shared_token_is_accepted()
    {
        using var certificate = Certificate(Token);
        Assert.True(ElectoralLakeTransport.IsBoundToToken(certificate, Token));
    }

    [Fact]
    public void Certificate_bound_to_another_token_is_refused()
    {
        using var certificate = Certificate("another-token");
        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, Token));
    }

    [Fact]
    public void Certificate_without_binding_is_refused()
    {
        using var certificate = Certificate(bindingToken: null);
        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, Token));
    }

    [Fact]
    public void Standard_sha1_key_identifier_is_not_a_token_binding()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=impostor", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, critical: false));
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddDays(1));

        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, Token));
    }

    [Fact]
    public void Tampered_binding_is_refused()
    {
        using var certificate = Certificate(Token, tamper: true);
        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, Token));
    }

    [Fact]
    public void Missing_certificate_or_missing_token_is_refused()
    {
        using var certificate = Certificate(Token);
        Assert.False(ElectoralLakeTransport.IsBoundToToken(null, Token));
        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, ""));
        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, null));
    }

    [Fact]
    public void Python_worker_fixture_is_accepted_only_with_its_token()
    {
        using var certificate = X509Certificate2.CreateFromPem(File.ReadAllText(FixturePath()));
        Assert.True(ElectoralLakeTransport.IsBoundToToken(certificate, FixtureToken));
        Assert.False(ElectoralLakeTransport.IsBoundToToken(certificate, Token));
    }

    [Theory]
    [InlineData("http://electoral-lake.railway.internal:8080", "https://electoral-lake.railway.internal:8080/", true)]
    [InlineData("https://electoral-lake.railway.internal:8080", "https://electoral-lake.railway.internal:8080/", false)]
    [InlineData("  http://lake.test  ", "https://lake.test:80/", true)]
    [InlineData(null, "https://electoral-lake.railway.internal:8080/", false)]
    public void Lake_base_address_always_uses_tls(string? configured, string expected, bool upgraded)
    {
        var (address, wasUpgraded) = ElectoralLakeTransport.ResolveBaseAddress(configured);
        Assert.Equal(expected, address.AbsoluteUri);
        Assert.Equal(upgraded, wasUpgraded);
    }

    [Theory]
    [InlineData("ftp://electoral-lake.railway.internal")]
    [InlineData("electoral-lake.railway.internal:8080")]
    public void Lake_base_address_refuses_other_schemes(string configured)
    {
        Assert.Throws<InvalidOperationException>(() => ElectoralLakeTransport.ResolveBaseAddress(configured));
    }

    [Fact]
    public void Handler_validates_the_server_through_the_token_binding()
    {
        using var handler = ElectoralLakeTransport.CreateHandler($"  {Token}  ");
        using var bound = Certificate(Token);
        using var foreign = Certificate("another-token");
        var validate = handler.SslOptions.RemoteCertificateValidationCallback;

        Assert.NotNull(validate);
        Assert.Equal(SslProtocols.Tls12 | SslProtocols.Tls13, handler.SslOptions.EnabledSslProtocols);
        Assert.True(validate(this, bound, null, System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors));
        Assert.False(validate(this, foreign, null, System.Net.Security.SslPolicyErrors.None));
    }

    [LakeTlsWorkerFact]
    public async Task Live_worker_handshake_is_pinned_to_the_shared_token()
    {
        var url = new Uri(Environment.GetEnvironmentVariable(LakeTlsWorkerFactAttribute.UrlVariable)!);
        var token = Environment.GetEnvironmentVariable(LakeTlsWorkerFactAttribute.TokenVariable)!;

        using (var trusted = new HttpClient(ElectoralLakeTransport.CreateHandler(token)) { BaseAddress = url })
        {
            var response = await trusted.GetAsync("/health");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("\"storage\":\"parquet\"", await response.Content.ReadAsStringAsync());
        }

        using var impostor = new HttpClient(ElectoralLakeTransport.CreateHandler("wrong-token")) { BaseAddress = url };
        await Assert.ThrowsAsync<HttpRequestException>(() => impostor.GetAsync("/health"));
    }
}
