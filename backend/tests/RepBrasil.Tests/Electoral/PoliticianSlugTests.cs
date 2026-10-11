using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Endereço público permanente (migration AddPoliticianSlug), contra o schema real e numa transação revertida:
/// nome de urna → nome civil → nome civil + número; nunca muda depois do INSERT.
/// </summary>
public class PoliticianSlugTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    // Sem chaves literais no SQL: ExecuteSqlRaw formata o texto (string.Format).
    private const string Seed = """
        INSERT INTO public."Politicians" ("Id", "Name", "BallotName", "CreatedAt", "UpdatedAt") VALUES
          ('00000000-0000-0000-0000-0000000051a1', 'Zélia Fictícia de Souza', 'Zélia do Povo', now(), now()),
          ('00000000-0000-0000-0000-0000000051a2', 'Zélia Fictícia de Lima', 'Zélia do Povo', now(), now()),
          ('00000000-0000-0000-0000-0000000051a3', 'Zélia Fictícia de Lima', 'ZÉLIA DO POVO', now(), now()),
          ('00000000-0000-0000-0000-0000000051a4', 'Zélia Fictícia de Lima', '', now(), now());
        """;

    [ElectoralSchemaFact]
    public async Task Each_new_politician_gets_the_first_free_address_and_keeps_it()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        try
        {
            await db.Database.ExecuteSqlRawAsync(Seed, Ct);
            var slugs = await db.Database.SqlQueryRaw<string>("""
                SELECT "Slug" AS "Value" FROM public."Politicians" WHERE "Id"::text LIKE '00000000-0000-0000-0000-0000000051a%' ORDER BY "Id"
                """).ToListAsync(Ct);
            Assert.Equal(["zelia-do-povo", "zelia-ficticia-de-lima", "zelia-ficticia-de-lima-2", "zelia-ficticia-de-lima-3"], slugs);

            // o endereço não acompanha mudança de nome: é permanente
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE public.\"Politicians\" SET \"BallotName\" = 'Outra Zélia' WHERE \"Id\" = '00000000-0000-0000-0000-0000000051a1'", Ct);
            var query = new GetPoliticianByIdQuery(new PoliticianRepository(db));
            var zelia = await query.BySlugAsync("ZELIA-DO-POVO", Ct);
            Assert.Equal(Guid.Parse("00000000-0000-0000-0000-0000000051a1"), zelia?.Id);
            Assert.Equal("zelia-do-povo", zelia?.Slug);

            Assert.Null(await query.BySlugAsync("zelia do povo", Ct)); // fora do formato: não consulta
            Assert.Null(await query.BySlugAsync("%", Ct));
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
