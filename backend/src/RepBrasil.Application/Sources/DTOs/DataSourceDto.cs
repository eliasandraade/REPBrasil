using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Sources.DTOs;

public record DataSourceDto(
    string Name,
    string Organization,
    string SourceType,
    string OriginalUrl,
    DateTime CollectedAt,
    string? Hash,
    long? FileSizeBytes,
    string? License
)
{
    public static DataSourceDto FromEntity(Source s) =>
        new(s.Name, s.Organization, s.SourceType, s.OriginalUrl,
            s.CollectedAt, s.Hash, s.FileSizeBytes, s.License);
}
