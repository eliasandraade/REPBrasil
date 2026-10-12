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

                INSERT INTO electoral.poll_institute(id, name, slug) VALUES
                    ('99000000-0000-0000-0000-000000000010', 'Instituto Nacional', 'instituto-nacional-teste'),
                    ('99000000-0000-0000-0000-000000000011', 'Instituto Estadual', 'instituto-estadual-teste');

                INSERT INTO electoral.poll_source
                    (id, provider, dataset, source_url, retrieved_at, content_sha256, parser_version)
                VALUES
                    ('99000000-0000-0000-0000-000000000020', 'TSE', 'fixture-national', 'https://example.invalid/national', now(), repeat('a', 64), 'test'),
                    ('99000000-0000-0000-0000-000000000021', 'TSE', 'fixture-state', 'https://example.invalid/state', now() - interval '1 day', repeat('b', 64), 'test');

                INSERT INTO electoral.poll
                    (id, year, office_code, state_code, registration_number, institute_id,
                     field_start, field_end, source_id)
                VALUES
                    ('99000000-0000-0000-0000-000000000030', 2099, 3, NULL, 'TEST-2099', '99000000-0000-0000-0000-000000000010', '2099-09-01', '2099-09-03', '99000000-0000-0000-0000-000000000020'),
                    ('99000000-0000-0000-0000-000000000031', 2099, 3, 'ZZ', 'TEST-2099', '99000000-0000-0000-0000-000000000011', '2099-09-01', '2099-09-03', '99000000-0000-0000-0000-000000000021');
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

    [ElectoralSchemaFact]
    public async Task Poll_query_filters_explicit_scenario_round_but_keeps_metadata_only_registration()
    {
        await using var db = ElectoralXraySchemaTests.Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO electoral.poll_institute(id, name, slug) VALUES
                    ('99100000-0000-0000-0000-000000000010', 'Instituto Cenários', 'instituto-cenarios-teste');

                INSERT INTO electoral.poll_source
                    (id, provider, dataset, source_url, retrieved_at, content_sha256, parser_version)
                VALUES
                    ('99100000-0000-0000-0000-000000000020', 'TSE', 'fixture-rounds', 'https://example.invalid/rounds', now(), repeat('c', 64), 'test');

                INSERT INTO electoral.poll
                    (id, year, office_code, registration_number, institute_id, field_start, field_end, source_id)
                VALUES
                    ('99100000-0000-0000-0000-000000000030', 2098, 1, 'BR-ROUND-2', '99100000-0000-0000-0000-000000000010', '2098-09-01', '2098-09-03', '99100000-0000-0000-0000-000000000020'),
                    ('99100000-0000-0000-0000-000000000031', 2098, 1, 'BR-METADATA', '99100000-0000-0000-0000-000000000010', '2098-09-02', '2098-09-04', '99100000-0000-0000-0000-000000000020');

                INSERT INTO electoral.poll_scenario(id, poll_id, round, name, scenario_order)
                VALUES
                    ('99100000-0000-0000-0000-000000000040', '99100000-0000-0000-0000-000000000030', 2, 'Segundo turno', 0);
                """, Ct);

            var firstRound = await new ElectoralLiveRepository(db)
                .PollsAsync(2098, 1, 1, null, null, Ct);
            var first = Assert.Single(firstRound);
            Assert.Equal("BR-METADATA", first.RegistrationNumber);

            var secondRound = await new ElectoralLiveRepository(db)
                .PollsAsync(2098, 2, 1, null, null, Ct);
            Assert.Equal(2, secondRound.Select(x => x.RegistrationNumber).Distinct().Count());
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
