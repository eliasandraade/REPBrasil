using System.Globalization;
using System.Net;
using Npgsql;
using RepBrasil.Application.LiveElection;
using RepBrasil.Infrastructure.LiveElection;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Leitura da configuração. Aceita as variáveis planas pedidas para a operação (ELECTION_LIVE_ENABLED,
/// ELECTION_DATA_MODE, ELECTION_POLL_INTERVAL, ELECTION_REPLAY_SPEED…) e as chaves hierárquicas LiveElection:*.
/// Valor inválido vira o padrão seguro, com aviso no log; configuração nunca derruba a API.
/// </summary>
public static class LiveElectionConfiguration
{
    public static LiveElectionOptions Read(IConfiguration config, ILogger? logger = null)
    {
        var defaults = new LiveElectionOptions();
        string? Raw(string flat, string key) => config[flat] ?? config[$"LiveElection:{key}"];
        void Warn(string name) => logger?.LogWarning("Apuração: valor inválido em {Setting}; usando o padrão", name);

        bool Bool(string flat, string key, bool fallback)
        {
            var raw = Raw(flat, key);
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            if (bool.TryParse(raw.Trim(), out var value)) return value;
            if (raw.Trim() is "1" or "on" or "yes") return true;
            if (raw.Trim() is "0" or "off" or "no") return false;
            Warn(flat);
            return fallback;
        }

        int Int(string flat, string key, int fallback, int min, int max)
        {
            var raw = Raw(flat, key);
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            if (int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)) return Math.Clamp(value, min, max);
            Warn(flat);
            return fallback;
        }

        // "1000" (ms), "1500ms", "2s", "5m".
        TimeSpan Duration(string flat, string key, TimeSpan fallback, TimeSpan min, TimeSpan max)
        {
            var raw = Raw(flat, key)?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            TimeSpan? parsed = null;
            if (raw.EndsWith("ms", StringComparison.Ordinal) && double.TryParse(raw[..^2], NumberStyles.Float, CultureInfo.InvariantCulture, out var ms)) parsed = TimeSpan.FromMilliseconds(ms);
            else if (raw.EndsWith('s') && double.TryParse(raw[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var s)) parsed = TimeSpan.FromSeconds(s);
            else if (raw.EndsWith('m') && double.TryParse(raw[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var m)) parsed = TimeSpan.FromMinutes(m);
            else if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var plain)) parsed = TimeSpan.FromMilliseconds(plain);
            if (parsed is null)
            {
                Warn(flat);
                return fallback;
            }
            return parsed < min ? min : parsed > max ? max : parsed.Value;
        }

        var mode = (Raw("ELECTION_DATA_MODE", "Mode") ?? defaults.Mode).Trim().ToLowerInvariant();
        if (!LiveModes.IsValid(mode))
        {
            Warn("ELECTION_DATA_MODE");
            mode = defaults.Mode;
        }

        var speedRaw = Raw("ELECTION_REPLAY_SPEED", "ReplaySpeed")?.Trim().ToLowerInvariant();
        var speed = defaults.ReplaySpeed;
        if (speedRaw is "instant" or "instantaneo" or "instantâneo" or "0") speed = 0;
        else if (!string.IsNullOrEmpty(speedRaw))
        {
            if (double.TryParse(speedRaw.TrimEnd('x'), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedSpeed) && parsedSpeed is > 0 and <= 600) speed = parsedSpeed;
            else Warn("ELECTION_REPLAY_SPEED");
        }

        var startRaw = Raw("ELECTION_TOTALIZATION_START", "TotalizationStart");
        var start = defaults.TotalizationStartLocal;
        if (!string.IsNullOrWhiteSpace(startRaw) && !TimeOnly.TryParseExact(startRaw.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out start))
        {
            Warn("ELECTION_TOTALIZATION_START");
            start = defaults.TotalizationStartLocal;
        }

        int? OptionalCode(string flat, string key, int? fallback)
        {
            var raw = Raw(flat, key);
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            if (int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value > 0) return value;
            Warn(flat);
            return fallback;
        }

        (int, int)? outage = null;
        var outageRaw = Raw("ELECTION_REPLAY_OUTAGE", "ReplayOutage")?.Trim();
        if (!string.IsNullOrEmpty(outageRaw))
        {
            var parts = outageRaw.Split('-');
            if (parts.Length == 2 && int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var from) && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var to) && from >= 0 && to >= from)
                outage = (from, to);
            else Warn("ELECTION_REPLAY_OUTAGE");
        }

        var cycle = Raw("ELECTION_CYCLE", "Cycle")?.Trim() ?? defaults.Cycle;
        return defaults with
        {
            Enabled = Bool("ELECTION_LIVE_ENABLED", "Enabled", false),
            Mode = mode,
            Cycle = cycle,
            Year = Int("ELECTION_YEAR", "Year", defaults.Year, 2026, 2100),
            ExpectedElectionCode = OptionalCode("ELECTION_EXPECTED_CODE", "ExpectedElectionCode", defaults.ExpectedElectionCode),
            ExpectedPleitoCode = OptionalCode("ELECTION_EXPECTED_PLEITO", "ExpectedPleitoCode", defaults.ExpectedPleitoCode),
            ExpectedFirstRoundElectionCode = OptionalCode("ELECTION_EXPECTED_FIRST_ROUND_CODE", "ExpectedFirstRoundElectionCode", defaults.ExpectedFirstRoundElectionCode),
            SimulationEnvironment = Raw("ELECTION_SIMULATION_ENVIRONMENT", "SimulationEnvironment")?.Trim() ?? defaults.SimulationEnvironment,
            SimulationExpectedElectionCode = OptionalCode("ELECTION_SIMULATION_EXPECTED_CODE", "SimulationExpectedElectionCode", defaults.SimulationExpectedElectionCode),
            TotalizationStartLocal = start,
            PollInterval = Duration("ELECTION_POLL_INTERVAL", "PollInterval", defaults.PollInterval, TimeSpan.FromMilliseconds(500), TimeSpan.FromMinutes(5)),
            IdlePollInterval = Duration("ELECTION_IDLE_POLL_INTERVAL", "IdlePollInterval", defaults.IdlePollInterval, TimeSpan.FromSeconds(2), TimeSpan.FromMinutes(10)),
            AccompanimentInterval = Duration("ELECTION_UF_POLL_INTERVAL", "AccompanimentInterval", defaults.AccompanimentInterval, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(5)),
            StateAccompanimentInterval = Duration("ELECTION_MUNICIPAL_SWEEP_INTERVAL", "StateAccompanimentInterval", defaults.StateAccompanimentInterval, TimeSpan.FromSeconds(10), TimeSpan.FromMinutes(30)),
            MunicipalCacheTtl = Duration("ELECTION_MUNICIPAL_CACHE_TTL", "MunicipalCacheTtl", defaults.MunicipalCacheTtl, TimeSpan.FromSeconds(5), TimeSpan.FromMinutes(10)),
            MaxRequestsPerSecond = Int("ELECTION_MAX_RPS", "MaxRequestsPerSecond", defaults.MaxRequestsPerSecond, 1, LiveElectionOptions.HardMaxRequestsPerSecond),
            BackgroundRequestsPerSecond = Int("ELECTION_BACKGROUND_RPS", "BackgroundRequestsPerSecond", defaults.BackgroundRequestsPerSecond, 1, LiveElectionOptions.HardMaxRequestsPerSecond),
            PriorityMunicipalities = Int("ELECTION_PRIORITY_MUNICIPALITIES", "PriorityMunicipalities", defaults.PriorityMunicipalities, 0, 500),
            StaleAfter = Duration("ELECTION_STALE_AFTER", "StaleAfter", defaults.StaleAfter, TimeSpan.FromSeconds(30), TimeSpan.FromHours(1)),
            ReplaySpeed = speed,
            ReplayOutage = outage,
            ReplayStep = Duration("ELECTION_REPLAY_STEP", "ReplayStep", defaults.ReplayStep, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(30)),
            MaxSseConnections = Int("ELECTION_SSE_MAX_CONNECTIONS", "MaxSseConnections", defaults.MaxSseConnections, 10, 200_000),
            MaxSsePerIp = Int("ELECTION_SSE_MAX_PER_IP", "MaxSsePerIp", defaults.MaxSsePerIp, 1, 200_000),
        };
    }
}

/// <summary>Estado de execução compartilhado entre o serviço de ingestão, a API e o Super Admin.</summary>
public sealed class LiveElectionRuntime
{
    private CancellationTokenSource restart = new();

    public LiveIngestionEngine? Engine { get; set; }

    public ReplaySource? Replay { get; set; }

    public PgLiveCoordinator? Coordinator { get; init; }

    public bool IsLeader { get; set; }

    public string? LastError { get; set; }

    public DateTimeOffset? SessionStartedAt { get; set; }

    public string InstanceId { get; } =
        Environment.GetEnvironmentVariable("RAILWAY_REPLICA_ID") ?? $"{Environment.MachineName}:{Environment.ProcessId}";

    public CancellationToken RestartToken => Volatile.Read(ref restart).Token;

    /// <summary>Reinicia a sessão de ingestão (ex.: novo replay). O estado servido é reconstruído do zero.</summary>
    public void RequestRestart()
    {
        var previous = Interlocked.Exchange(ref restart, new CancellationTokenSource());
        previous.Cancel();
        previous.Dispose();
    }
}

public static class LiveElectionRegistration
{
    public static IServiceCollection AddLiveElection(this IServiceCollection services, IConfiguration configuration)
    {
        var options = LiveElectionConfiguration.Read(configuration);
        services.AddSingleton(options);
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<LiveElectionMetrics>();
        services.AddSingleton<LiveElectionHub>();

        services.AddHttpClient(TseHttpSource.HttpClientName, client =>
            {
                client.Timeout = TimeSpan.FromSeconds(20);
                client.MaxResponseContentBufferSize = 32L * 1024 * 1024;
                client.DefaultRequestVersion = HttpVersion.Version11;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
            {
                AutomaticDecompression = DecompressionMethods.All,
                PooledConnectionLifetime = TimeSpan.FromMinutes(5),
                PooledConnectionIdleTimeout = TimeSpan.FromMinutes(1),
                ConnectTimeout = TimeSpan.FromSeconds(5),
                MaxConnectionsPerServer = 16,
            })
            // Sem as duas linhas por requisição do HttpClient (dezenas por segundo na apuração): o TseHttpSource já
            // registra cada requisição em Debug e os alertas em Error.
            .RemoveAllLoggers();

        var connectionString = configuration.GetConnectionString("Postgres");
        if (!string.IsNullOrWhiteSpace(connectionString))
        {
            // Pool próprio e pequeno: a ingestão não disputa conexões com as consultas da API.
            var builder = new NpgsqlConnectionStringBuilder(connectionString)
            {
                MaxPoolSize = 8,
                ApplicationName = "repbrasil-live-election",
                Timeout = 5,
                CommandTimeout = 15,
            };
            services.AddKeyedSingleton<NpgsqlDataSource>("live-election", (_, _) => NpgsqlDataSource.Create(builder.ConnectionString));
            services.AddSingleton<ILiveElectionStore>(sp => new PgLiveElectionStore(sp.GetRequiredKeyedService<NpgsqlDataSource>("live-election")));
            services.AddSingleton(sp => new LiveElectionRuntime { Coordinator = new PgLiveCoordinator(sp.GetRequiredKeyedService<NpgsqlDataSource>("live-election")) });
        }
        else
        {
            services.AddSingleton(new LiveElectionRuntime());
        }

        services.AddHostedService<LiveIngestionService>();
        return services;
    }

    /// <summary>Monta o motor da sessão: fonte HTTP do TSE (official/simulation) ou replay sintético.</summary>
    public static LiveIngestionEngine CreateEngine(IServiceProvider services, LiveElectionRuntime runtime)
    {
        var options = services.GetRequiredService<LiveElectionOptions>();
        var time = services.GetRequiredService<TimeProvider>();
        var metrics = services.GetRequiredService<LiveElectionMetrics>();
        ITseSource source;
        var effective = options;
        if (options.Mode == LiveModes.Replay)
        {
            runtime.Replay ??= new ReplaySource(time, options, metrics);
            source = runtime.Replay;
        }
        else
        {
            var http = services.GetRequiredService<IHttpClientFactory>().CreateClient(TseHttpSource.HttpClientName);
            source = new TseHttpSource(http, options, metrics, time, services.GetRequiredService<ILogger<TseHttpSource>>());
        }
        var engine = new LiveIngestionEngine(
            source,
            services.GetService<ILiveElectionStore>(),
            services.GetRequiredService<LiveElectionHub>(),
            effective,
            metrics,
            time,
            services.GetRequiredService<ILoggerFactory>().CreateLogger("RepBrasil.LiveElection"));
        if (runtime.Replay is not null) engine.ReplayEnvironment = runtime.Replay.EnvironmentName;
        return engine;
    }
}
