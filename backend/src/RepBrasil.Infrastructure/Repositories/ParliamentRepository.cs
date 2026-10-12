using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Parliament;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class ParliamentRepository(ApplicationDbContext db) : IParliamentRepository
{
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

    public Task<IReadOnlyList<ParliamentAmendmentDto>> AmendmentsAsync(int? year, long? memberId, string? uf, int limit, CancellationToken ct)
    {
        object yearParameter = year.HasValue ? year.Value : DBNull.Value;
        object memberParameter = memberId.HasValue ? memberId.Value : DBNull.Value;
        return Query<ParliamentAmendmentDto>("""
            WITH current_amendment AS (
              SELECT DISTINCT ON (a.external_id)
                     a.id, a.external_id, a.author_member_id, a.author_name, a.year, a.amendment_type,
                     a.functional_programming, a.beneficiary_document, a.beneficiary_name, a.locality,
                     a.municipality_ibge_code, a.committed_amount, a.paid_amount,
                     s.provider, s.dataset, s.source_url, s.retrieved_at
                FROM electoral.parliament_amendment a
                JOIN electoral.parliament_source s ON s.id = a.source_id
               WHERE ({0}::int IS NULL OR a.year = {0})
                 AND ({1}::bigint IS NULL OR a.author_member_id = {1})
               ORDER BY a.external_id, s.retrieved_at DESC, s.id DESC, a.id DESC
            )
            SELECT a.id AS "Id", a.external_id AS "ExternalId", a.author_member_id AS "AuthorMemberId",
                   a.author_name AS "AuthorName", a.year AS "Year", a.amendment_type AS "AmendmentType",
                   a.functional_programming AS "FunctionalProgramming", a.beneficiary_document AS "BeneficiaryDocument",
                   a.beneficiary_name AS "BeneficiaryName", a.locality AS "Locality",
                   a.municipality_ibge_code AS "MunicipalityIbgeCode", a.committed_amount AS "CommittedAmount",
                   a.paid_amount AS "PaidAmount", a.provider AS "Provider", a.dataset AS "Dataset",
                   a.source_url AS "SourceUrl", a.retrieved_at AS "RetrievedAt"
              FROM current_amendment a
              LEFT JOIN electoral.municipality m ON m.ibge_code::text = a.municipality_ibge_code
             WHERE ({2} = '' OR m.state_code = {2})
             ORDER BY a.year DESC NULLS LAST, a.committed_amount DESC NULLS LAST, a.external_id
             LIMIT {3}
            """, ct, yearParameter, memberParameter, uf ?? "", limit);
    }

    public Task<IReadOnlyList<AmendmentMunicipalityDto>> AmendmentMapAsync(int? year, string uf, CancellationToken ct)
    {
        object yearParameter = year.HasValue ? year.Value : DBNull.Value;
        return Query<AmendmentMunicipalityDto>("""
            WITH current_amendment AS (
              SELECT DISTINCT ON (a.external_id)
                     a.external_id, a.year, a.municipality_ibge_code, a.committed_amount, a.paid_amount,
                     s.retrieved_at
                FROM electoral.parliament_amendment a
                JOIN electoral.parliament_source s ON s.id = a.source_id
               WHERE a.municipality_ibge_code IS NOT NULL
                 AND ({0}::int IS NULL OR a.year = {0})
               ORDER BY a.external_id, s.retrieved_at DESC, s.id DESC, a.id DESC
            )
            SELECT a.municipality_ibge_code AS "MunicipalityIbgeCode", m.name AS "MunicipalityName",
                   count(*)::int AS "AmendmentCount", sum(a.committed_amount) AS "CommittedAmount",
                   sum(a.paid_amount) AS "PaidAmount", max(a.retrieved_at) AS "RetrievedAt"
              FROM current_amendment a
              JOIN electoral.municipality m ON m.ibge_code::text = a.municipality_ibge_code AND m.state_code = {1}
             GROUP BY a.municipality_ibge_code, m.name
             ORDER BY sum(a.committed_amount) DESC NULLS LAST, m.name
            """, ct, yearParameter, uf);
    }
}
