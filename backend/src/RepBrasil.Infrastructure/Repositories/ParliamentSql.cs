namespace RepBrasil.Infrastructure.Repositories;

/// <summary>SQL compartilhado pelas leituras do domínio parlamentar (emendas, mapa, série e cobertura).</summary>
internal static class ParliamentSql
{
    // Cada (provider, dataset) é uma edição completa do seu recorte. Vale só a mais recente, decidida
    // em parliament_source antes de olhar as emendas: uma edição vigente sem nenhuma emenda é ausência
    // oficial e não deixa a edição anterior "ressuscitar". Edições anteriores ficam preservadas para
    // auditoria. `uf` é o recorte oficial gravado pela ingestão (metadata.uf), nunca inferido de texto.
    public const string CurrentEditions = """
        WITH current_edition AS (
          SELECT DISTINCT ON (s.provider, s.dataset)
                 s.id, s.provider, s.dataset, s.source_url, s.retrieved_at, s.metadata->>'uf' AS uf
            FROM electoral.parliament_source s
           ORDER BY s.provider, s.dataset, s.retrieved_at DESC, s.id DESC
        )

        """;
}
