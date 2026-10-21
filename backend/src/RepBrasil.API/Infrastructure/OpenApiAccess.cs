using System.Reflection;
using System.Text.Json;
using Microsoft.OpenApi;
using RepBrasil.API.Accounts;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace RepBrasil.API.Infrastructure;

/// <summary>Regra de acesso de uma rota, como o servidor aplica.</summary>
public sealed record AccessDescription(string Kind, string Label, bool Csrf, string? Capability = null, string? RequiredPlan = null, string? Header = null);

/// <summary>
/// Anota cada operação do OpenAPI com <c>x-repbrasil-access</c>, lido dos mesmos atributos que aplicam a regra
/// (<see cref="SuperAdminAttribute"/>, <see cref="RequiresCapabilityAttribute"/>, <see cref="RequiresSessionAttribute"/>):
/// o catálogo da API no Super Admin não tem uma segunda fonte de verdade sobre autenticação.
/// </summary>
public sealed class AccessOperationFilter : IOperationFilter
{
    public const string Extension = "x-repbrasil-access";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var access = Describe(context.MethodInfo, context.ApiDescription.HttpMethod);
        operation.Extensions ??= new Dictionary<string, IOpenApiExtension>();
        operation.Extensions[Extension] = new JsonNodeExtension(JsonSerializer.SerializeToNode(access, Json)!);
    }

    public static AccessDescription Describe(MethodInfo method, string? httpMethod)
    {
        var type = method.DeclaringType;
        var mutation = httpMethod is not (null or "GET" or "HEAD" or "OPTIONS");
        if (Has<SuperAdminAttribute>(method, type)) return new("superadmin", "Super Admin", mutation);
        if (method.GetCustomAttribute<RequiresCapabilityAttribute>() is { } capability)
        {
            var plan = PlanCatalog.MinimumPlanWith(capability.Capability);
            return new("capability", $"Sessão com o recurso {PlanCatalog.Capability(capability.Capability).Label}", mutation, capability.Capability, plan?.Code);
        }
        if (Has<RequiresSessionAttribute>(method, type)) return new("session", "Sessão da conta", mutation);
        if (method.GetCustomAttribute<HeaderCredentialAttribute>() is { } header) return new("header", header.Description, false, Header: header.Header);
        return new("public", "Público", false);
    }

    private static bool Has<T>(MethodInfo method, Type? type) where T : Attribute =>
        method.GetCustomAttribute<T>() is not null || type?.GetCustomAttribute<T>() is not null;
}
