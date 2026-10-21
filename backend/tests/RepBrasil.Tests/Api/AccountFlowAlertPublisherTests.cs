using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using RepBrasil.API.Accounts;
using RepBrasil.Tests.Electoral;
using static RepBrasil.Tests.Api.AccountTestKit;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Publicador de alertas contra o banco de teste: uma edição oficial nova vira uma notificação por assinante,
/// uma vez só; quem assina depois não recebe aviso de edição antiga; conta suspensa não recebe.
/// </summary>
public sealed class AccountFlowAlertPublisherTests
{
    /// <summary>Roda um ciclo; se outro publicador estiver com a trava, tenta de novo.</summary>
    private static async Task<AlertCycleResult> RunCycle(WebApplicationFactory<Program> api)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var result = await WithService<AlertEditionService, AlertCycleResult>(api, service => service.RunOnceAsync(Ct));
            if (result.Ran) return result;
            await Task.Delay(250);
        }
        throw new TimeoutException("Publicador ocupado por outro processo.");
    }

    private static async Task<JsonElement> Inbox(HttpClient browser, SignedIn user)
    {
        var (status, body) = await Send(browser, Request(HttpMethod.Get, "/api/v1/account/notifications", user.Session));
        Assert.Equal(HttpStatusCode.OK, status);
        return body!.Value;
    }

    private static Task<(HttpStatusCode Status, JsonElement? Body)> Subscribe(HttpClient browser, SignedIn user, string type, string key, string kind) =>
        Send(browser, Request(HttpMethod.Post, "/api/v1/account/alerts", user.Session, user.Csrf,
            new { resourceType = type, resourceKey = key, eventKind = kind, delivery = "in_app", enabled = true }));

    [ElectoralSchemaFact]
    public async Task New_official_edition_notifies_each_prior_subscriber_once()
    {
        var early = UniqueEmail("publisher-early");
        var late = UniqueEmail("publisher-late");
        var suspended = UniqueEmail("publisher-suspended");
        var indicator = $"test.flow_{Guid.NewGuid():N}";
        var sha = Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '0');
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            await Scalar("""
                INSERT INTO electoral.indicator (code, name, unit, provider, description)
                VALUES (@code, 'Indicador de Teste', 'pessoas', 'Teste', 'Indicador sintético do teste do publicador.')
                """, ("code", indicator));
            var first = await SignInByMagicLink(api, browser, early);
            var blocked = await SignInByMagicLink(api, browser, suspended);
            Assert.Equal(HttpStatusCode.OK, (await Subscribe(browser, first, "indicator", indicator, "new_edition")).Status);
            Assert.Equal(HttpStatusCode.OK, (await Subscribe(browser, blocked, "indicator", indicator, "new_edition")).Status);
            await Scalar("UPDATE account.user_account SET disabled_at = now() WHERE id = @id", ("id", blocked.UserId));

            await RunCycle(api);
            var sourceId = await Scalar("""
                INSERT INTO electoral.socioeconomic_source (indicator_code, period, provider, dataset, source_url, sha256, parser_version)
                VALUES (@code, 2022, 'Teste', 'fixture-publicador', 'https://example.invalid/indicador', @sha, 'test')
                RETURNING id
                """, ("code", indicator), ("sha", sha));

            var cycle = await RunCycle(api);
            Assert.True(cycle.Recorded >= 1);
            var notices = (await Inbox(browser, first)).EnumerateArray().Where(n => n.GetProperty("resourceKey").GetString() == indicator).ToList();
            var notice = Assert.Single(notices);
            Assert.Equal($"socioeconomic_source:{sourceId}", notice.GetProperty("eventKey").GetString());
            Assert.Equal("Nova edição oficial: Indicador de Teste (2022)", notice.GetProperty("title").GetString());
            Assert.Equal($"/dados?x={indicator}&periodo=2022", notice.GetProperty("href").GetString());
            Assert.Equal("https://example.invalid/indicador", notice.GetProperty("payload").GetProperty("sourceUrl").GetString());

            // Segundo ciclo não duplica; quem assina depois da edição não recebe aviso retroativo.
            var second = await SignInByMagicLink(api, browser, late);
            Assert.Equal(HttpStatusCode.OK, (await Subscribe(browser, second, "indicator", indicator, "new_edition")).Status);
            await RunCycle(api);
            Assert.Single((await Inbox(browser, first)).EnumerateArray(), n => n.GetProperty("resourceKey").GetString() == indicator);
            Assert.Equal(0, (await Inbox(browser, second)).GetArrayLength());
            Assert.Equal(0L, await Scalar("SELECT count(*) FROM account.notification WHERE user_id = @id", ("id", blocked.UserId)));
            Assert.Equal(1, (await Send(browser, Request(HttpMethod.Get, "/api/v1/account/me", first.Session))).Body!.Value
                .GetProperty("usage").GetProperty("unreadNotifications").GetInt32());

            Assert.Equal(HttpStatusCode.NoContent, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/notifications/read-all", first.Session, first.Csrf))).Status);
            Assert.Equal(0, (await Send(browser, Request(HttpMethod.Get, "/api/v1/account/me", first.Session))).Body!.Value
                .GetProperty("usage").GetProperty("unreadNotifications").GetInt32());
        }
        finally
        {
            await Cleanup(early, late, suspended);
            await Scalar("DELETE FROM account.alert_edition WHERE resource_key = @code", ("code", indicator));
            await Scalar("DELETE FROM electoral.socioeconomic_source WHERE indicator_code = @code", ("code", indicator));
            await Scalar("DELETE FROM electoral.indicator WHERE code = @code", ("code", indicator));
        }
    }

    [ElectoralSchemaFact]
    public async Task Subscribing_after_the_official_edition_but_before_the_cycle_gets_no_retroactive_notice()
    {
        var late = UniqueEmail("publisher-window");
        var indicator = $"test.window_{Guid.NewGuid():N}";
        var sha = Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '0');
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            await Scalar("""
                INSERT INTO electoral.indicator (code, name, unit, provider, description)
                VALUES (@code, 'Indicador de Teste', 'pessoas', 'Teste', 'Indicador sintético do teste do publicador.')
                """, ("code", indicator));
            await RunCycle(api);
            // A edição oficial chega (coletada há uma hora, com a UF registrada pela ingestão) antes do ciclo do publicador...
            await Scalar("""
                INSERT INTO electoral.socioeconomic_source (indicator_code, period, provider, dataset, source_url, sha256, parser_version, retrieved_at, metadata)
                VALUES (@code, 2022, 'Teste', 'fixture-janela', 'https://example.invalid/indicador', @sha, 'test', now() - interval '1 hour', '{"uf": "ce"}'::jsonb)
                """, ("code", indicator), ("sha", sha));
            // ...e a pessoa assina nesse intervalo: a edição já existia quando ela assinou.
            var user = await SignInByMagicLink(api, browser, late);
            Assert.Equal(HttpStatusCode.OK, (await Subscribe(browser, user, "indicator", indicator, "new_edition")).Status);
            await RunCycle(api);

            Assert.Equal(0, (await Inbox(browser, user)).GetArrayLength());
            // A edição foi registrada; só não virou aviso para quem assinou depois dela.
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.alert_edition WHERE resource_key = @code", ("code", indicator)));
        }
        finally
        {
            await Cleanup(late);
            await Scalar("DELETE FROM account.alert_edition WHERE resource_key = @code", ("code", indicator));
            await Scalar("DELETE FROM electoral.socioeconomic_source WHERE indicator_code = @code", ("code", indicator));
            await Scalar("DELETE FROM electoral.indicator WHERE code = @code", ("code", indicator));
        }
    }

    [ElectoralSchemaFact]
    public async Task First_cycle_ever_turns_existing_history_into_a_silent_baseline()
    {
        var email = UniqueEmail("publisher-baseline");
        var indicator = $"test.base_{Guid.NewGuid():N}";
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            await Scalar("""
                INSERT INTO electoral.indicator (code, name, unit, provider, description)
                VALUES (@code, 'Indicador de Linha de Base', 'pessoas', 'Teste', 'Indicador sintético do teste de linha de base.')
                """, ("code", indicator));
            var user = await SignInByMagicLink(api, browser, email);
            Assert.Equal(HttpStatusCode.OK, (await Subscribe(browser, user, "indicator", indicator, "new_edition")).Status);
            await Scalar("""
                INSERT INTO electoral.socioeconomic_source (indicator_code, period, provider, dataset, source_url, sha256, parser_version)
                VALUES (@code, 2010, 'Teste', 'historico', 'https://example.invalid/historico', repeat('d', 64), 'test')
                """, ("code", indicator));

            // Publicador ligado pela primeira vez (estado vazio): a edição que já existia não vira aviso.
            await Scalar("DELETE FROM account.alert_publisher_state");
            await RunCycle(api);
            Assert.Equal(0, (await Inbox(browser, user)).GetArrayLength());
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.alert_publisher_state"));

            await Scalar("""
                INSERT INTO electoral.socioeconomic_source (indicator_code, period, provider, dataset, source_url, sha256, parser_version)
                VALUES (@code, 2011, 'Teste', 'nova', 'https://example.invalid/nova', repeat('e', 64), 'test')
                """, ("code", indicator));
            await RunCycle(api);
            var notice = Assert.Single((await Inbox(browser, user)).EnumerateArray());
            Assert.Equal("Nova edição oficial: Indicador de Linha de Base (2011)", notice.GetProperty("title").GetString());
        }
        finally
        {
            await Cleanup(email);
            await Scalar("DELETE FROM account.alert_edition WHERE resource_key = @code", ("code", indicator));
            await Scalar("DELETE FROM electoral.socioeconomic_source WHERE indicator_code = @code", ("code", indicator));
            await Scalar("DELETE FROM electoral.indicator WHERE code = @code", ("code", indicator));
        }
    }

    [ElectoralSchemaFact]
    public async Task Amendment_editions_reach_the_state_recorded_by_the_ingestion()
    {
        var email = UniqueEmail("publisher-amendments");
        var sha = Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '1');
        using var api = CreateApi();
        using var browser = Browser(api);
        object? sourceId = null;
        try
        {
            var user = await SignInByMagicLink(api, browser, email);
            Assert.Equal(HttpStatusCode.OK, (await Subscribe(browser, user, "state", "TO", "amendments_update")).Status);
            await RunCycle(api);
            sourceId = await Scalar("""
                INSERT INTO electoral.parliament_source (provider, dataset, source_url, sha256, parser_version, metadata)
                VALUES ('Teste', 'emendas-parlamentares:TO', 'https://example.invalid/emendas', @sha, 'test', '{"uf":"TO"}'::jsonb)
                RETURNING id
                """, ("sha", sha));
            await RunCycle(api);
            var notice = Assert.Single((await Inbox(browser, user)).EnumerateArray(), n => n.GetProperty("eventKey").GetString() == $"parliament_source:{sourceId}");
            Assert.Equal("Emendas parlamentares atualizadas: TO", notice.GetProperty("title").GetString());
            Assert.Equal("/parlamento?uf=TO", notice.GetProperty("href").GetString());
        }
        finally
        {
            await Cleanup(email);
            if (sourceId is not null)
            {
                await Scalar("DELETE FROM account.alert_edition WHERE event_key = @key", ("key", $"parliament_source:{sourceId}"));
                await Scalar("DELETE FROM electoral.parliament_source WHERE id = @id", ("id", sourceId));
            }
        }
    }
}
