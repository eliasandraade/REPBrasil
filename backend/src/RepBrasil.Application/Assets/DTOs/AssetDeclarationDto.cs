using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Assets.DTOs;

public record AssetItemDto(
    int Order,
    string? TypeCode,
    string? TypeDescription,
    string? Description,
    decimal Value);

public record AssetDeclarationDto(
    int Year,
    decimal TotalValue,
    IReadOnlyList<AssetItemDto> Items)
{
    public static AssetDeclarationDto FromEntity(AssetDeclaration decl) =>
        new(
            decl.ElectionYear,
            decl.TotalValue,
            decl.Items
                .OrderBy(i => i.Order)
                .Select(i => new AssetItemDto(
                    i.Order,
                    i.TypeCode,
                    i.TypeDescription,
                    i.Description,
                    i.Value))
                .ToList());
}
