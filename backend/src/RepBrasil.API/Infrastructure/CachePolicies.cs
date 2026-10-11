namespace RepBrasil.API.Infrastructure;

/// <summary>Políticas de cache de saída (memória do processo; nenhum serviço externo).</summary>
public static class CachePolicies
{
    /// <summary>Leitura pública e cara (mapa, comparação, território, seções): 5 min, por consulta e origem.</summary>
    public const string PublicData = "public-data";
}
