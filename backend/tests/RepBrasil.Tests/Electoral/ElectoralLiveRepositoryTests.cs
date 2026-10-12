using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

public sealed class ElectoralLiveRepositoryTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [ElectoralSchemaFact]
    public async Task State_poll_query_does_not_mix_national_poll_with_same_registration()
    {
        await using var db = ElectoralXraySchemaTests.Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO electoral.state(code, name) VALUES ('ZZ', 'Estado Teste')
                ON CONFLICT (code) DO NOTHING;

                INSERT INTO electoral.election
                    (id, year, round, election_date, pleito_code, tse_cycle)
                VALUES
                    ('99000000-0000-0000-0000-000000000001', 2099, 1, '2099-10-01', 990001, 'teste-2099');

                INSERT INTO electoral.poll_institute(id, name, slug) VALUES
                    ('99000000-0000-0000-0000-000000000010', 'Instituto Nacional', 'instituto-nacional-teste'),
                    ('99000000-0000-0000-0000-000000000011', 'Instituto Estadual', 'instituto-estadual-teste');

                INSERT INTO electoral.poll_source
                    (id, provider, dataset, source_url, retrieved_at, content_sha256, parser_version)
                VALUES
                    ('99000000-0000-0000-0000-000000000020', 'TSE', 'fixture-national', 'https://example.invalid/national', now(), repeat('a', 64), 'test'),
                    ('99000000-0000-0000-0000-000000000021', 'TSE', 'fixture-state', 'https://example.invalid/state', now() - interval '1 day', repeat('b', 64), 'test');

                INSERT INTO electoral.poll
                    (id, election_id, office_code, state_code, registration_number, institute_id,
                     field_start, field_end, source_id)
                VALUES
                    ('99000000-0000-0000-0000-000000000030', '99000000-0000-0000-0000-000000000001', 3, NULL, 'TEST-2099', '99000000-0000-0000-0000-000000000010', '2099-09-01', '2099-09-03', '99000000-0000-0000-0000-000000000020'),
                    ('99000000-0000-0000-0000-000000000031', '99000000-0000-0000-0000-000000000001', 3, 'ZZ', 'TEST-2099', '99000000-0000-0000-0000-000000000011', '2099-09-01', '2099-09-03', '99000000-0000-0000-0000-000000000021');
                """, Ct);

            var rows = await new ElectoralLiveRepository(db)
                .PollsAsync(2099, 1, 3, "ZZ", null, Ct);

            var row = Assert.Single(rows);
            Assert.Equal("Instituto Estadual", row.Institute);
            Assert.Equal("TEST-2099", row.RegistrationNumber);
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
