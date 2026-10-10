using System.Reflection;

namespace RepBrasil.Infrastructure.Persistence.Electoral;

/// <summary>
/// Scripts SQL versionados do schema <c>electoral</c>, embutidos no assembly
/// (<c>Persistence/Electoral/Sql/*.sql</c>). São a fonte única do schema: a migration EF
/// os aplica e os testes do ETL Python os leem do disco.
/// Um script aplicado é imutável — mudanças entram num novo arquivo e numa nova migration.
/// </summary>
public static class ElectoralSqlScripts
{
    public static string Read(string fileName)
    {
        var assembly = typeof(ElectoralSqlScripts).Assembly;
        using var stream = assembly.GetManifestResourceStream($"electoral-sql/{fileName}")
            ?? throw new InvalidOperationException($"Script eleitoral embutido não encontrado: {fileName}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    /// <summary>Executa o script com <c>search_path = electoral, public</c> dentro da transação da migration.</summary>
    public static string InElectoralSchema(string fileName) =>
        $"SET LOCAL search_path TO {ElectoralModel.Schema}, public;\n{Read(fileName)}";
}
