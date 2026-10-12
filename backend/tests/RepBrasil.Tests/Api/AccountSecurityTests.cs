using RepBrasil.API.Infrastructure;

namespace RepBrasil.Tests.Api;

public sealed class AccountSecurityTests
{
    [Theory]
    [InlineData(null, "/")]
    [InlineData("", "/")]
    [InlineData("/conta", "/conta")]
    [InlineData("/dados?x=ibge.population", "/dados?x=ibge.population")]
    [InlineData("//evil.example/path", "/")]
    [InlineData("https://evil.example/path", "/")]
    [InlineData("javascript:alert(1)", "/")]
    public void NormalizeReturnTo_AllowsOnlyLocalAbsolutePaths(string? value, string expected)
    {
        Assert.Equal(expected, AccountService.NormalizeReturnTo(value));
    }

    [Fact]
    public void NormalizeReturnTo_RejectsOversizedValue()
    {
        Assert.Equal("/", AccountService.NormalizeReturnTo("/" + new string('a', 513)));
    }

    [Theory]
    [InlineData("same-secret", "same-secret", true)]
    [InlineData("same-secret", "other-secret", false)]
    [InlineData("", "", false)]
    [InlineData(null, "secret", false)]
    [InlineData("secret", null, false)]
    public void SecureEquals_RequiresNonEmptyExactMatch(string? left, string? right, bool expected)
    {
        Assert.Equal(expected, AccountService.SecureEquals(left, right));
    }
}
