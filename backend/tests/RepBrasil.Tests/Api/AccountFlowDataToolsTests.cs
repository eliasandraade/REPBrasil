using System.Net;
using System.Text.Json;
using RepBrasil.API.Accounts;
using RepBrasil.Tests.Electoral;
using static RepBrasil.Tests.Api.AccountTestKit;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Explorador territorial contra o banco de teste: a cobertura diz só o que está carregado, e as ferramentas pagas
/// (matriz, exportações e série do mapa) são decididas pela API — 401 sem sessão, 403 com o plano mínimo, 200 no plano.
/// Os dados ficam numa UF fictícia ("QZ") criada e removida pelo próprio teste.
/// </summary>
public sealed class AccountFlowDataToolsTests
{
    private const string Uf = "QZ";
    private const string Population = "teste.qz_population";
    private const string Rate = "teste.qz_rate";

    private static string Sha() => Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '7');

    private static async Task<object?> Seed()
    {
        await Scalar("INSERT INTO electoral.state (code, name, ibge_code) VALUES ('QZ', 'Estado de Teste', 99)");
        await Scalar("""
            INSERT INTO electoral.municipality (state_code, tse_code, ibge_code, name, slug) VALUES
              ('QZ', '97771', 9977701, 'Primeira de Teste', 'primeira-de-teste'),
              ('QZ', '97772', 9977702, 'Segunda de Teste', 'segunda-de-teste'),
              ('QZ', '97773', 9977703, 'Terceira de Teste', 'terceira-de-teste')
            """);
        await Scalar("""
            INSERT INTO electoral.indicator (code, name, unit, provider, description) VALUES
              (@population, 'População de teste', 'pessoas', 'Teste', 'Fixture do teste.'),
              (@rate, 'Taxa de teste', '%', 'Teste', 'Fixture do teste.')
            """, ("population", Population), ("rate", Rate));
        var population = await Scalar("""
            INSERT INTO electoral.socioeconomic_source (indicator_code, period, provider, dataset, source_url, sha256, parser_version)
            VALUES (@code, 2022, 'Teste', 'fixture-qz', 'https://example.invalid/populacao', @sha, 'test') RETURNING id
            """, ("code", Population), ("sha", Sha()));
        var rate = await Scalar("""
            INSERT INTO electoral.socioeconomic_source (indicator_code, period, provider, dataset, source_url, sha256, parser_version)
            VALUES (@code, 2022, 'Teste', 'fixture-qz', 'https://example.invalid/taxa', @sha, 'test') RETURNING id
            """, ("code", Rate), ("sha", Sha()));
        // A taxa não tem o terceiro município: ausência fica fora do N, nunca vira zero.
        await Scalar("""
            INSERT INTO electoral.indicator_value (indicator_code, municipality_ibge_code, period, value, source_id) VALUES
              (@population, '9977701', 2022, 1000, @populationSource),
              (@population, '9977702', 2022, 2000, @populationSource),
              (@population, '9977703', 2022, 3000, @populationSource),
              (@rate, '9977701', 2022, 10.5, @rateSource),
              (@rate, '9977702', 2022, 20.25, @rateSource)
            """, ("population", Population), ("rate", Rate), ("populationSource", population!), ("rateSource", rate!));
        var amendments = await Scalar("""
            INSERT INTO electoral.parliament_source (provider, dataset, source_url, sha256, parser_version, metadata)
            VALUES ('Teste', 'emendas-parlamentares:QZ', 'https://example.invalid/emendas', @sha, 'test', '{"uf":"QZ"}'::jsonb)
            RETURNING id
            """, ("sha", Sha()));
        await Scalar("""
            INSERT INTO electoral.parliament_amendment (external_id, year, municipality_ibge_code, committed_amount, paid_amount, source_id) VALUES
              ('qz-1', 2024, '9977701', 1000.00, 500.00, @source),
              ('qz-2', 2024, '9977701', NULL, NULL, @source),
              ('qz-3', 2025, '9977702', 300.00, 300.00, @source),
              ('qz-4', 2025, NULL, 50.00, 0.00, @source)
            """, ("source", amendments!));
        return amendments;
    }

    private static async Task Unseed(object? amendmentSource)
    {
        if (amendmentSource is not null)
        {
            await Scalar("DELETE FROM electoral.parliament_amendment WHERE source_id = @id", ("id", amendmentSource));
            await Scalar("DELETE FROM electoral.parliament_source WHERE id = @id", ("id", amendmentSource));
        }
        await Scalar("DELETE FROM electoral.indicator_value WHERE indicator_code IN (@a, @b)", ("a", Population), ("b", Rate));
        await Scalar("DELETE FROM electoral.socioeconomic_source WHERE indicator_code IN (@a, @b)", ("a", Population), ("b", Rate));
        await Scalar("DELETE FROM electoral.indicator WHERE code IN (@a, @b)", ("a", Population), ("b", Rate));
        await Scalar("DELETE FROM electoral.municipality WHERE state_code = 'QZ'");
        await Scalar("DELETE FROM electoral.state WHERE code = 'QZ'");
    }

    private static Task<object?> GrantPlan(Guid user, string plan) =>
        Scalar("""
            INSERT INTO account.entitlement (id, user_id, entitlement_key, entitlement_value, source, starts_at)
            VALUES (gen_random_uuid(), @user, 'plan', @plan, 'admin', now() - interval '1 minute')
            ON CONFLICT (user_id, entitlement_key, source) DO UPDATE SET entitlement_value = EXCLUDED.entitlement_value
            """, ("user", user), ("plan", plan));

    private static async Task<(HttpStatusCode Status, string Body, HttpResponseMessage Response)> Get(HttpClient browser, string path, string? session)
    {
        var response = await browser.SendAsync(Request(HttpMethod.Get, path, session), Ct);
        return (response.StatusCode, await response.Content.ReadAsStringAsync(Ct), response);
    }

    private static readonly string[] PaidTools =
    [
        $"/api/v1/data/correlation-matrix?uf={Uf}&period=2022",
        $"/api/v1/data/export?indicator={Population}&uf={Uf}&period=2022",
        $"/api/v1/data/export/bulk?uf={Uf}",
        $"/api/v1/parliament/amendments/map-series?uf={Uf}",
    ];

    [ElectoralSchemaFact]
    public async Task Coverage_says_only_what_is_loaded_in_each_state()
    {
        object? source = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            source = await Seed();
            var (status, body, _) = await Get(browser, "/api/v1/data/coverage", null);
            Assert.Equal(HttpStatusCode.OK, status);
            using var json = JsonDocument.Parse(body);
            var state = json.RootElement.GetProperty("states").EnumerateArray().Single(s => s.GetProperty("uf").GetString() == Uf);
            Assert.Equal(3, state.GetProperty("municipalities").GetInt32());

            var socio = state.GetProperty("socioeconomic").EnumerateArray()
                .ToDictionary(i => i.GetProperty("indicator").GetString()!, i => (i.GetProperty("period").GetInt32(), i.GetProperty("municipalities").GetInt32()));
            Assert.Equal((2022, 3), socio[Population]);
            Assert.Equal((2022, 2), socio[Rate]);
            Assert.Empty(state.GetProperty("elections").EnumerateArray());

            var amendments = state.GetProperty("amendments").EnumerateArray()
                .Select(a => (a.GetProperty("year").GetInt32(), a.GetProperty("municipalities").GetInt32(), a.GetProperty("amendments").GetInt32()))
                .ToList();
            // 2025 tem uma emenda sem município oficial: conta como emenda, não como município.
            Assert.Equal([(2025, 1, 2), (2024, 1, 2)], amendments);
        }
        finally
        {
            await Unseed(source);
        }
    }

    [ElectoralSchemaFact]
    public async Task Paid_data_tools_are_decided_by_the_server_from_the_plan()
    {
        var free = UniqueEmail("data-free");
        var advanced = UniqueEmail("data-advanced");
        var professional = UniqueEmail("data-professional");
        object? source = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            source = await Seed();
            foreach (var path in PaidTools) Assert.Equal(HttpStatusCode.Unauthorized, (await Get(browser, path, null)).Status);

            var freeUser = await SignInByMagicLink(api, browser, free);
            foreach (var path in PaidTools)
            {
                var (status, body, _) = await Get(browser, path, freeUser.Session);
                Assert.Equal(HttpStatusCode.Forbidden, status);
                using var refusal = JsonDocument.Parse(body);
                Assert.Equal("plan_required", refusal.RootElement.GetProperty("error").GetString());
                var expected = path.Contains("/bulk") ? PlanCatalog.Professional : PlanCatalog.Advanced;
                Assert.Equal(expected, refusal.RootElement.GetProperty("requiredPlan").GetString());
            }

            var advancedUser = await SignInByMagicLink(api, browser, advanced);
            await GrantPlan(advancedUser.UserId, PlanCatalog.Advanced);

            var matrix = await Get(browser, PaidTools[0], advancedUser.Session);
            Assert.Equal(HttpStatusCode.OK, matrix.Status);
            Assert.True(matrix.Response.Headers.CacheControl is { Private: true, NoStore: true });
            using (var json = JsonDocument.Parse(matrix.Body))
            {
                Assert.Equal([Population, Rate], json.RootElement.GetProperty("indicators").EnumerateArray().Select(i => i.GetProperty("code").GetString()!));
                var cell = Assert.Single(json.RootElement.GetProperty("cells").EnumerateArray());
                Assert.Equal(2, cell.GetProperty("n").GetInt32());
                Assert.Equal(1d, cell.GetProperty("pearson").GetDouble(), 10);
                Assert.Contains("Correlação não implica causalidade", json.RootElement.GetProperty("caveat").GetString());
            }

            var export = await Get(browser, PaidTools[1], advancedUser.Session);
            Assert.Equal(HttpStatusCode.OK, export.Status);
            Assert.Equal("text/csv", export.Response.Content.Headers.ContentType?.MediaType);
            Assert.Equal("repbrasil-teste.qz-population-qz-2022.csv", export.Response.Content.Headers.ContentDisposition?.FileName);
            var lines = export.Body.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
            Assert.Equal(4, lines.Length);
            Assert.StartsWith("uf;municipio_ibge;municipio;indicador", lines[0]);
            Assert.StartsWith("QZ;9977701;Primeira de Teste;teste.qz_population;População de teste;pessoas;2022;1000;Teste;fixture-qz;", lines[1]);

            var series = await Get(browser, PaidTools[3], advancedUser.Session);
            Assert.Equal(HttpStatusCode.OK, series.Status);
            using (var json = JsonDocument.Parse(series.Body))
            {
                var years = json.RootElement.GetProperty("years").EnumerateArray().ToList();
                Assert.Equal([2024, 2025], years.Select(y => y.GetProperty("year").GetInt32()));
                var first = Assert.Single(years[0].GetProperty("municipalities").EnumerateArray());
                Assert.Equal(("9977701", 2, 1000m, 1), (first.GetProperty("municipalityIbgeCode").GetString(), first.GetProperty("amendmentCount").GetInt32(),
                    first.GetProperty("committedAmount").GetDecimal(), first.GetProperty("committedAmountMissing").GetInt32()));
            }

            var bulkRefused = await Get(browser, PaidTools[2], advancedUser.Session);
            Assert.Equal(HttpStatusCode.Forbidden, bulkRefused.Status);

            var professionalUser = await SignInByMagicLink(api, browser, professional);
            await GrantPlan(professionalUser.UserId, PlanCatalog.Professional);
            var bulk = await Get(browser, PaidTools[2], professionalUser.Session);
            Assert.Equal(HttpStatusCode.OK, bulk.Status);
            var bulkLines = bulk.Body.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
            Assert.Equal(6, bulkLines.Length);
            Assert.All(bulkLines.Skip(1), line => Assert.EndsWith("Z", line));

            Assert.Equal(HttpStatusCode.BadRequest, (await Get(browser, $"/api/v1/data/export?indicator={Population}", advancedUser.Session)).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Get(browser, $"/api/v1/data/export?indicator=nao.existe&uf={Uf}", advancedUser.Session)).Status);
        }
        finally
        {
            await Cleanup(free, advanced, professional);
            await Unseed(source);
        }
    }
}
