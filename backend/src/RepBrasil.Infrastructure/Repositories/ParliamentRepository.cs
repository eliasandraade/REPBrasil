using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Parliament;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class ParliamentRepository(ApplicationDbContext db) : IParliamentRepository
{
    // Cada (provider, dataset) é uma edição completa do seu recorte. Vale só a mais recente, decidida
    // em parliament_source antes de olhar as emendas: uma edição vigente sem nenhuma emenda é ausência
    // oficial e não deixa a edição anterior "ressuscitar". Edições anteriores ficam preservadas para
    // auditoria. `uf` é o recorte oficial gravado pela ingestão (metadata.uf), nunca inferido de texto.
    private const string CurrentEditions = """
        WITH current_edition AS (
          SELECT DISTINCT ON (s.provider, s.dataset)
                 s.id, s.provider, s.dataset, s.source_url, s.retrieved_at, s.metadata->>'uf' AS uf
            FROM electoral.parliament_source s
           ORDER BY s.provider, s.dataset, s.retrieved_at DESC, s.id DESC
        )

        """;

    private async Task<IReadOnlyList<T>> Query<T>(string sql, CancellationToken ct, params object[] parameters) =>
        await db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync(ct);

    public Task<IReadOnlyList<ParliamentMemberDto>> MembersAsync(string? uf, string? institution, CancellationToken ct) =>
        Query<ParliamentMemberDto>("""
            SELECT m.id AS "Id", m.institution AS "Institution", m.external_id AS "ExternalId",
                   m.name AS "Name", m.parliamentary_name AS "ParliamentaryName", m.state_code AS "StateCode",
                   m.party_acronym AS "PartyAcronym", m.photo_url AS "PhotoUrl", m.identity_method AS "IdentityMethod",
                   s.provider AS "Provider", s.dataset AS "Dataset", s.source_url AS "SourceUrl", s.retrieved_at AS "RetrievedAt"
              FROM electoral.parliament_member m
              JOIN electoral.parliament_source s ON s.id = m.source_id
             WHERE ({0} = '' OR m.state_code = {0})
               AND ({1} = '' OR m.institution = {1})
             ORDER BY coalesce(m.parliamentary_name, m.name), m.institution, m.external_id
            """, ct, uf ?? "", institution ?? "");

    public Task<IReadOnlyList<ParliamentActivityDto>> ActivitiesAsync(long? memberId, string? institution, string? uf, int limit, CancellationToken ct)
    {
        object member = memberId.HasValue ? memberId.Value : DBNull.Value;
        return Query<ParliamentActivityDto>("""
            SELECT a.id AS "Id", a.member_id AS "MemberId", a.institution AS "Institution",
                   a.activity_type AS "ActivityType", a.external_id AS "ExternalId", a.occurred_at AS "OccurredAt",
                   a.title AS "Title", a.description AS "Description", a.source_url AS "SourceUrl",
                   s.provider AS "Provider", s.dataset AS "Dataset", s.source_url AS "DatasetSourceUrl",
                   s.retrieved_at AS "RetrievedAt"
              FROM electoral.parliament_activity a
              JOIN electoral.parliament_member m ON m.id = a.member_id
              JOIN electoral.parliament_source s ON s.id = a.source_id
             WHERE ({0}::bigint IS NULL OR a.member_id = {0})
               AND ({1} = '' OR a.institution = {1})
               AND ({2} = '' OR m.state_code = {2})
             ORDER BY a.occurred_at DESC NULLS LAST, a.id DESC
             LIMIT {3}
            """, ct, member, institution ?? "", uf ?? "", limit);
    }

    /// <summary>Mesmo recorte de <see cref="ActivitiesAsync"/>, sem o limite da listagem.</summary>
    public async Task<int> ActivityTotalAsync(long? memberId, string? institution, string? uf, CancellationToken ct)
    {
        object member = memberId.HasValue ? memberId.Value : DBNull.Value;
        return await db.Database.SqlQueryRaw<int>("""
            SELECT count(*)::int AS "Value"
              FROM electoral.parliament_activity a
              JOIN electoral.parliament_member m ON m.id = a.member_id
             WHERE ({0}::bigint IS NULL OR a.member_id = {0})
               AND ({1} = '' OR a.institution = {1})
               AND ({2} = '' OR m.state_code = {2})
            """, member, institution ?? "", uf ?? "").SingleAsync(ct);
    }

    public Task<IReadOnlyList<ParliamentAmendmentDto>> AmendmentsAsync(int? year, long? memberId, string? uf, int limit, CancellationToken ct)
    {
        object yearParameter = year.HasValue ? year.Value : DBNull.Value;
        object memberParameter = memberId.HasValue ? memberId.Value : DBNull.Value;
        // Todas as emendas da edição vigente do recorte, inclusive as que a fonte publica só com a UF
        // (município ausente continua ausente: nada é inferido).
        return Query<ParliamentAmendmentDto>(CurrentEditions + """
            SELECT a.id AS "Id", a.external_id AS "ExternalId", a.author_member_id AS "AuthorMemberId",
                   a.author_name AS "AuthorName", a.year AS "Year", a.amendment_type AS "AmendmentType",
                   a.functional_programming AS "FunctionalProgramming", a.beneficiary_document AS "BeneficiaryDocument",
                   a.beneficiary_name AS "BeneficiaryName", a.locality AS "Locality",
                   a.municipality_ibge_code AS "MunicipalityIbgeCode", a.committed_amount AS "CommittedAmount",
                   a.paid_amount AS "PaidAmount", e.provider AS "Provider", e.dataset AS "Dataset",
                   e.source_url AS "SourceUrl", e.retrieved_at AS "RetrievedAt"
              FROM electoral.parliament_amendment a
              JOIN current_edition e ON e.id = a.source_id
             WHERE ({0}::int IS NULL OR a.year = {0})
               AND ({1}::bigint IS NULL OR a.author_member_id = {1})
               AND ({2} = '' OR e.uf = {2})
             ORDER BY a.year DESC NULLS LAST, a.committed_amount DESC NULLS LAST, a.external_id, a.id
             LIMIT {3}
            """, ct, yearParameter, memberParameter, uf ?? "", limit);
    }

    /// <summary>Anos com emenda na edição vigente do recorte, sem o limite da listagem.</summary>
    public Task<IReadOnlyList<int>> AmendmentYearsAsync(string? uf, CancellationToken ct) =>
        Query<int>(CurrentEditions + """
            SELECT DISTINCT a.year AS "Value"
              FROM electoral.parliament_amendment a
              JOIN current_edition e ON e.id = a.source_id
             WHERE a.year IS NOT NULL
               AND ({0} = '' OR e.uf = {0})
             ORDER BY a.year DESC
            """, ct, uf ?? "");

    public Task<IReadOnlyList<AmendmentMunicipalityDto>> AmendmentMapAsync(int? year, string uf, CancellationToken ct)
    {
        object yearParameter = year.HasValue ? year.Value : DBNull.Value;
        // Só emendas com código IBGE oficial de município entram no mapa.
        return Query<AmendmentMunicipalityDto>(CurrentEditions + """
            SELECT a.municipality_ibge_code AS "MunicipalityIbgeCode", m.name AS "MunicipalityName",
                   count(*)::int AS "AmendmentCount",
                   sum(a.committed_amount) AS "CommittedAmount",
                   count(*) FILTER (WHERE a.committed_amount IS NULL)::int AS "CommittedAmountMissing",
                   sum(a.paid_amount) AS "PaidAmount",
                   count(*) FILTER (WHERE a.paid_amount IS NULL)::int AS "PaidAmountMissing",
                   max(e.retrieved_at) AS "RetrievedAt"
              FROM electoral.parliament_amendment a
              JOIN current_edition e ON e.id = a.source_id AND e.uf = {1}
              JOIN electoral.municipality m ON m.ibge_code::text = a.municipality_ibge_code AND m.state_code = {1}
             WHERE a.municipality_ibge_code IS NOT NULL
               AND ({0}::int IS NULL OR a.year = {0})
             GROUP BY a.municipality_ibge_code, m.name
             ORDER BY sum(a.committed_amount) DESC NULLS LAST, m.name
            """, ct, yearParameter, uf);
    }
}
