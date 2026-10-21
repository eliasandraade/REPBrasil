using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Accounts;

/// <summary>Resultado de um ciclo: edições novas registradas e notificações entregues.</summary>
public sealed record AlertCycleResult(bool Ran, int Recorded, int Delivered);

/// <summary>
/// Transforma edições oficiais gravadas pelas ingestões em notificações na conta de quem assinou o alerta
/// (<see cref="AlertCatalog"/>). Cada edição é registrada uma vez em <c>account.alert_edition</c> (chave estável por
/// edição) e entregue uma vez por pessoa (<c>ON CONFLICT (user_id, event_key) DO NOTHING</c>). Só recebe quem já
/// assinava quando a edição apareceu: assinar hoje não traz avisos de edições antigas. No primeiro ciclo de todos
/// (<c>account.alert_publisher_state</c> vazio), o histórico existente vira linha de base, sem aviso: ligar o
/// publicador depois do deploy não dispara notificações de edições antigas.
/// </summary>
public sealed class AlertEditionService(ApplicationDbContext db)
{
    // Um só publicador por vez, mesmo com mais de uma réplica da API.
    private const long PublisherLock = 727_100_001;

    private static readonly string[] RecordEditions =
    [
        // Indicador socioeconômico: cada fonte nova (arquivo com SHA-256 próprio) é uma edição oficial.
        """
        INSERT INTO account.alert_edition (event_key, event_kind, resource_type, resource_key, title, body, href, payload)
        SELECT 'socioeconomic_source:' || s.id, 'new_edition', 'indicator', s.indicator_code,
               left('Nova edição oficial: ' || i.name || ' (' || s.period || ')', 200),
               left(s.provider || ' — ' || s.dataset || COALESCE(' — ' || NULLIF(s.metadata->>'uf', ''), ''), 500),
               -- o explorador territorial deriva o território da URL: o link leva a UF registrada pela ingestão
               '/dados?x=' || s.indicator_code || '&periodo=' || s.period
                 || CASE WHEN s.metadata->>'uf' ~* '^[a-z]{2}$' THEN '&uf=' || upper(s.metadata->>'uf') ELSE '' END,
               jsonb_build_object('indicator', s.indicator_code, 'period', s.period, 'provider', s.provider, 'dataset', s.dataset,
                                  'sourceUrl', s.source_url, 'retrievedAt', s.retrieved_at)
          FROM electoral.socioeconomic_source s
          JOIN electoral.indicator i ON i.code = s.indicator_code
        ON CONFLICT (event_key) DO NOTHING
        """,
        // Emendas: nova versão da base oficial da UF. A UF é o recorte gravado pela ingestão (metadata.uf).
        """
        INSERT INTO account.alert_edition (event_key, event_kind, resource_type, resource_key, title, body, href, payload)
        SELECT 'parliament_source:' || p.id, 'amendments_update', 'state', upper(p.metadata->>'uf'),
               'Emendas parlamentares atualizadas: ' || upper(p.metadata->>'uf'),
               left(p.provider || ' — nova versão da base oficial de emendas.', 500),
               '/parlamento?uf=' || upper(p.metadata->>'uf'),
               jsonb_build_object('provider', p.provider, 'dataset', p.dataset, 'sourceUrl', p.source_url,
                                  'retrievedAt', p.retrieved_at, 'publishedAt', p.published_at)
          FROM electoral.parliament_source p
         WHERE p.dataset LIKE 'emendas-parlamentares:%' AND upper(p.metadata->>'uf') ~ '^[A-Z]{2}$'
        ON CONFLICT (event_key) DO NOTHING
        """,
        // Pesquisas: por fonte e escopo, só quando a fonte traz registro que nenhuma fonte anterior tinha.
        """
        INSERT INTO account.alert_edition (event_key, event_kind, resource_type, resource_key, title, body, href, payload)
        SELECT 'poll_source:' || ps.id || ':' || p.year || ':' || p.office_code || ':' || COALESCE(p.state_code::text, 'BR'),
               'polls_update', 'election', p.year || ':' || p.office_code || ':' || COALESCE(p.state_code::text, 'BR'),
               left('Pesquisas registradas: ' || o.name || ' — ' || COALESCE(p.state_code::text, 'Brasil') || ' ' || p.year, 200),
               count(DISTINCT p.registration_number)
                 || CASE WHEN count(DISTINCT p.registration_number) = 1 THEN ' registro novo' ELSE ' registros novos' END
                 || ' na base oficial (' || ps.provider || ').',
               '/pesquisas?ano=' || p.year || '&cargo=' || p.office_code || '&uf=' || COALESCE(p.state_code::text, 'BR'),
               jsonb_build_object('provider', ps.provider, 'dataset', ps.dataset, 'sourceUrl', ps.source_url,
                                  'retrievedAt', ps.retrieved_at, 'newRegistrations', count(DISTINCT p.registration_number))
          FROM electoral.poll_source ps
          JOIN electoral.poll p ON p.source_id = ps.id
          JOIN electoral.office o ON o.code = p.office_code
         WHERE ps.retrieved_at > now() - interval '14 days'
           AND NOT EXISTS (
               SELECT 1
                 FROM electoral.poll q
                 JOIN electoral.poll_source qs ON qs.id = q.source_id
                WHERE q.registration_number = p.registration_number AND q.year = p.year AND q.office_code = p.office_code
                  AND q.state_code IS NOT DISTINCT FROM p.state_code AND qs.retrieved_at < ps.retrieved_at)
         GROUP BY ps.id, ps.provider, ps.dataset, ps.source_url, ps.retrieved_at, p.year, p.office_code, p.state_code, o.name
        ON CONFLICT (event_key) DO NOTHING
        """,
        // Apuração: marcos por escopo (início, 25%, 50%, 75%, encerramento), no primeiro snapshot que atinge cada um.
        """
        INSERT INTO account.alert_edition (event_key, event_kind, resource_type, resource_key, title, body, href, payload)
        SELECT DISTINCT ON (event_key) event_key, 'live_count_update', resource_type, resource_key, title, body, href, payload
          FROM (
            SELECT 'totalization:' || t.election_id || ':' || t.office_code || ':' || t.scope || ':'
                     || COALESCE(t.state_code::text, 'BR') || ':' || COALESCE(m.ibge_code::text, '-') || ':' || mk.milestone AS event_key,
                   CASE WHEN t.scope = 'municipal' THEN 'municipality' ELSE 'election' END AS resource_type,
                   CASE WHEN t.scope = 'municipal' THEN lpad(m.ibge_code::text, 7, '0')
                        ELSE e.year || ':' || t.office_code || ':' || COALESCE(t.state_code::text, 'BR') END AS resource_key,
                   left(CASE WHEN mk.milestone = 'final' THEN 'Apuração encerrada: ' ELSE 'Apuração em andamento: ' END
                        || o.name || ' — ' || COALESCE(m.name || '/' || t.state_code::text, t.state_code::text, 'Brasil')
                        || ' (' || e.year || ', ' || e.round || 'º turno)', 200) AS title,
                   CASE WHEN t.counted_percent IS NULL THEN 'Totalização oficial do TSE atualizada.'
                        ELSE replace(to_char(t.counted_percent, 'FM990.00'), '.', ',') || '% das seções totalizadas (TSE).' END AS body,
                   '/pesquisas?ano=' || e.year || '&turno=' || e.round || '&cargo=' || t.office_code
                     || '&uf=' || COALESCE(t.state_code::text, 'BR') || COALESCE('&municipio=' || m.tse_code::text, '') AS href,
                   jsonb_build_object('year', e.year, 'round', e.round, 'office', t.office_code, 'scope', t.scope, 'status', t.status,
                                      'countedPercent', t.counted_percent, 'capturedAt', t.captured_at,
                                      'tseGeneratedAt', t.tse_generated_at, 'sourceUrl', t.source_url) AS payload,
                   t.captured_at
              FROM electoral.totalization_snapshot t
              JOIN electoral.election e ON e.id = t.election_id
              JOIN electoral.office o ON o.code = t.office_code
              LEFT JOIN electoral.municipality m ON m.id = t.municipality_id
             CROSS JOIN LATERAL (
                   SELECT CASE WHEN t.status = 'final' THEN 'final'
                               ELSE 'p' || (floor(COALESCE(t.counted_percent, 0) / 25) * 25)::int END AS milestone) mk
             WHERE t.captured_at > now() - interval '3 days'
               AND t.status IN ('partial', 'final')
               AND (t.scope <> 'municipal' OR m.ibge_code IS NOT NULL)
          ) milestones
         ORDER BY event_key, captured_at
        ON CONFLICT (event_key) DO NOTHING
        """,
    ];

    private const string FanOut = """
        WITH pending AS (
            SELECT event_key, event_kind, resource_type, resource_key, title, body, href, payload, first_seen_at
              FROM account.alert_edition
             WHERE fanned_out_at IS NULL
             ORDER BY first_seen_at
             LIMIT 500
        ), delivered AS (
            INSERT INTO account.notification (id, user_id, event_key, resource_type, resource_key, title, body, href, payload)
            SELECT DISTINCT ON (s.user_id, p.event_key)
                   gen_random_uuid(), s.user_id, p.event_key, p.resource_type, p.resource_key, p.title, p.body, p.href, p.payload
              FROM pending p
              JOIN account.alert_subscription s
                ON s.resource_type = p.resource_type AND s.resource_key = p.resource_key AND s.event_kind = p.event_kind
               AND s.enabled
               -- Quem assinou depois da edição oficial não recebe aviso dela: vale a hora da fonte (coleta ou captura),
               -- não a hora em que o publicador a encontrou (até um ciclo depois, ou mais se ele falhou).
               AND s.created_at <= COALESCE((p.payload->>'retrievedAt')::timestamptz, (p.payload->>'capturedAt')::timestamptz, p.first_seen_at)
              JOIN account.user_account u ON u.id = s.user_id AND u.disabled_at IS NULL
            ON CONFLICT (user_id, event_key) DO NOTHING
            RETURNING 1
        ), marked AS (
            UPDATE account.alert_edition e
               SET fanned_out_at = now()
              FROM pending p
             WHERE e.event_key = p.event_key
            RETURNING 1
        )
        SELECT (SELECT count(*) FROM delivered)::int, (SELECT count(*) FROM marked)::int
        """;

    public async Task<AlertCycleResult> RunOnceAsync(CancellationToken cancellationToken)
    {
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await using (var lockCommand = db.Command("SELECT pg_try_advisory_xact_lock(@key)", ("key", PublisherLock)))
            {
                if (await lockCommand.ExecuteScalarAsync(cancellationToken) is not true) return new(false, 0, 0);
            }

            bool baseline;
            await using (var state = db.Command("INSERT INTO account.alert_publisher_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING"))
            {
                baseline = await state.ExecuteNonQueryAsync(cancellationToken) == 1;
            }

            var recorded = 0;
            foreach (var sql in RecordEditions)
            {
                await using var record = db.Command(sql);
                recorded += await record.ExecuteNonQueryAsync(cancellationToken);
            }

            if (baseline)
            {
                await using var settle = db.Command("UPDATE account.alert_edition SET fanned_out_at = now() WHERE fanned_out_at IS NULL");
                await settle.ExecuteNonQueryAsync(cancellationToken);
            }

            var delivered = 0;
            while (true)
            {
                await using var fanOut = db.Command(FanOut);
                await using var reader = await fanOut.ExecuteReaderAsync(cancellationToken);
                await reader.ReadAsync(cancellationToken);
                delivered += reader.GetInt32(0);
                if (reader.GetInt32(1) == 0) break;
            }

            await transaction.CommitAsync(cancellationToken);
            return new(true, recorded, delivered);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}

/// <summary>
/// Roda <see cref="AlertEditionService"/> em intervalo fixo dentro da API. Configuração:
/// <c>Alerts:Publisher:Enabled</c> (padrão: ligado), <c>Alerts:Publisher:IntervalSeconds</c> (padrão: 300, de 30 a 86400) e
/// <c>Alerts:Publisher:InitialDelaySeconds</c> (padrão: 60). Uma falha registra no log e espera o próximo ciclo; nunca derruba a API.
/// </summary>
public sealed partial class DataEditionAlertPublisher(
    IServiceScopeFactory scopes,
    IConfiguration configuration,
    ILogger<DataEditionAlertPublisher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Valor malformado (ex.: "300s") vira o padrão com aviso no log: configuração nunca derruba a API.
        if (!Setting("Alerts:Publisher:Enabled", true, bool.TryParse)) return;
        var interval = TimeSpan.FromSeconds(Math.Clamp(Setting("Alerts:Publisher:IntervalSeconds", 300, ParseInt), 30, 86_400));
        var initialDelay = TimeSpan.FromSeconds(Math.Clamp(Setting("Alerts:Publisher:InitialDelaySeconds", 60, ParseInt), 0, 3_600));
        try
        {
            await Task.Delay(initialDelay, stoppingToken);
            using var timer = new PeriodicTimer(interval);
            do
            {
                await RunCycleAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Desligamento da API.
        }
    }

    private delegate bool Parser<T>(string? text, out T value);

    private static bool ParseInt(string? text, out int value) =>
        int.TryParse(text, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out value);

    private T Setting<T>(string key, T fallback, Parser<T> parse)
    {
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        if (parse(raw.Trim(), out var value)) return value;
        LogBadSetting(logger, key);
        return fallback;
    }

    private async Task RunCycleAsync(CancellationToken stoppingToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var result = await scope.ServiceProvider.GetRequiredService<AlertEditionService>().RunOnceAsync(stoppingToken);
            if (result.Recorded > 0 || result.Delivered > 0) LogCycle(logger, result.Recorded, result.Delivered);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogFailure(logger, ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Alertas: {Recorded} edições oficiais novas, {Delivered} notificações entregues")]
    private static partial void LogCycle(ILogger logger, int recorded, int delivered);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Alertas: valor inválido em {Setting}; usando o padrão")]
    private static partial void LogBadSetting(ILogger logger, string setting);

    [LoggerMessage(Level = LogLevel.Error, Message = "Alertas: ciclo do publicador falhou; nova tentativa no próximo intervalo")]
    private static partial void LogFailure(ILogger logger, Exception exception);
}
