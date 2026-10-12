namespace RepBrasil.API.Infrastructure;

internal static class StringGuardExtensions
{
    public static bool StartsWith(this string value, char expected, StringComparison comparison)
    {
        _ = comparison;
        return value.Length > 0 && value[0] == expected;
    }

    public static bool Contains(this string value, char expected, StringComparison comparison)
    {
        _ = comparison;
        return value.IndexOf(expected) >= 0;
    }
}
