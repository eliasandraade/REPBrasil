namespace RepBrasil.API.Infrastructure;

/// <summary>
/// Ids de schema do Swagger únicos e legíveis: tipos do REPBrasil levam o módulo ("Assets.DTOs.AssetItemDto",
/// "Electoral.AssetItemDto"); genéricos viram "PagedResultOfPoliticianSummaryDto".
/// </summary>
public static class SwaggerSchemaIds
{
    public static string For(Type type)
    {
        var name = type.IsGenericType
            ? $"{type.Name[..type.Name.IndexOf('`')]}Of{string.Join("And", type.GetGenericArguments().Select(Short))}"
            : type.Name;
        var ns = type.Namespace ?? "";
        const string app = "RepBrasil.Application.";
        if (ns.StartsWith(app, StringComparison.Ordinal)) return $"{ns[app.Length..]}.{Nested(type, name)}";
        if (ns.StartsWith("RepBrasil.", StringComparison.Ordinal)) return $"{ns["RepBrasil.".Length..]}.{Nested(type, name)}";
        return Nested(type, name);
    }

    private static string Short(Type type) => For(type).Replace(".", "", StringComparison.Ordinal);

    private static string Nested(Type type, string name) => type.DeclaringType is { } outer ? $"{outer.Name}.{name}" : name;
}
