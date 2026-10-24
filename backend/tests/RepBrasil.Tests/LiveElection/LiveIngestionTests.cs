using System.Net;
using Microsoft.Extensions.Configuration;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RepBrasil.API.LiveElection;
using RepBrasil.Application.LiveElection;
using RepBrasil.Infrastructure.LiveElection;

namespace RepBrasil.Tests.LiveElection;

/// <summary>
/// Ingestão de ponta a ponta com o replay sintético (mesmo parser, mesmas regras), hub SSE e cliente HTTP do TSE.
/// </summary>
public sealed class LiveIngestionTests
{
    private static readonly LiveElectionOptions ReplayOptions = new()
    {
        Enabled = true,
        Mode = LiveModes.Replay,
        ReplaySpeed = 1,
        ReplayStep = TimeSpan.FromSeconds(10),
    };

    private sealed class Setup
    {
        public required FakeTimeProvider Time { get; init; }
        public required ReplaySource Replay { get; init; }
        public required LiveElectionHub Hub { get; init; }
        public required LiveIngestionEngine Engine { get; init; }
        public required LiveElectionMetrics Metrics { get; init; }
    }

    private static async Task<Setup> StartAsync()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 10, 25, 20, 0, 0, TimeSpan.Zero));
        var metrics = new LiveElectionMetrics();
        var replay = new ReplaySource(time, ReplayOptions);
        var hub = new LiveElectionHub(ReplayOptions, metrics, time);
        var engine = new LiveIngestionEngine(replay, null, hub, ReplayOptions, metrics, time, NullLogger.Instance) { ReplayEnvironment = replay.EnvironmentName };
        await engine.InitializeAsync(CancellationToken.None);
        return new Setup { Time = time, Replay = replay, Hub = hub, Engine = engine, Metrics = metrics };
    }

    private static async Task TickAsync(Setup s)
    {
        await s.Engine.PollNationalAsync(CancellationToken.None);
        await s.Engine.PollAccompanimentAsync(CancellationToken.None);
        await s.Engine.EvaluateAsync(CancellationToken.None);
    }

    [Fact]
    public async Task Discovery_comes_from_ea11_and_the_first_snapshot_is_pre_election_without_zero_results()
    {
        var s = await StartAsync();
        Assert.Equal(SyntheticScenario.SecondRound, s.Hub.Current!.Context.Election.ElectionCode);
        Assert.Equal(SyntheticScenario.FirstRound, s.Hub.Current.Context.Election.FirstRoundElectionCode);
        await TickAsync(s);
        var state = s.Hub.Current!;
        Assert.Equal("n", state.National!.Progress);
        Assert.Contains(state.Phase, new[] { LivePhase.PRE_ELECTION, LivePhase.WAITING_FOR_RELEASE });
        Assert.Null(state.National.LeaderKey);
        Assert.Equal(28, state.States.Count);
    }

    [Fact]
    public async Task Full_story_lead_change_threshold_before_md_e_and_final_result()
    {
        var s = await StartAsync();
        var defined = false;
        var thresholdBeforeOfficial = false;
        for (var frame = 0; frame <= s.Replay.FinalFrame + 1; frame++)
        {
            await TickAsync(s);
            var st = s.Hub.Current!;
            if (st.Math.RepBrasilDetectedAt is not null && st.Math.TseSignalDetectedAt is null) thresholdBeforeOfficial = true;
            if (st.Phase == LivePhase.MATHEMATICALLY_DEFINED) defined = true;
            s.Time.Advance(TimeSpan.FromSeconds(10));
        }
        var final = s.Hub.Current!;
        Assert.Equal(LivePhase.FINAL, final.Phase);
        Assert.True(defined, "a fase MATHEMATICALLY_DEFINED deveria aparecer antes do final");
        Assert.True(thresholdBeforeOfficial, "o validador do REPBrasil deveria atingir o limite antes do sinal oficial");
        Assert.NotEmpty(final.LeadChanges);
        Assert.Single(final.Events, e => e.Type == LiveEventTypes.MathematicallyDefined);
        Assert.Single(final.Events, e => e.Type == LiveEventTypes.Finalized);
        Assert.Contains(final.Events, e => e.Type == LiveEventTypes.MathThreshold && !e.IsPublic);
        Assert.Contains(final.National!.Profiles, p => p.Situation == "Eleito" && p.Elected == true);
        Assert.Equal(final.Timeline.Count, final.Timeline.Select(p => p.Version).Distinct().Count());
        Assert.True(final.Timeline.Count > 10);
        var summary = LiveProjector.Summary(final);
        Assert.Equal("FINAL", summary.Phase);
        Assert.Contains(summary.Events, e => e.Type == "lead-change");
        Assert.DoesNotContain(summary.Events, e => e.Type == LiveEventTypes.MathThreshold);
    }

    [Fact]
    public async Task Source_outage_keeps_the_last_snapshot_and_publishes_the_stale_phase_then_recovers()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 10, 25, 20, 0, 0, TimeSpan.Zero));
        var options = ReplayOptions with { ReplayOutage = (20, 22) };
        var metrics = new LiveElectionMetrics();
        var replay = new ReplaySource(time, options, metrics);
        var hub = new LiveElectionHub(options, metrics, time);
        var engine = new LiveIngestionEngine(replay, null, hub, options, metrics, time, NullLogger.Instance) { ReplayEnvironment = replay.EnvironmentName };
        await engine.InitializeAsync(CancellationToken.None);
        var s = new Setup { Time = time, Replay = replay, Hub = hub, Engine = engine, Metrics = metrics };
        for (var frame = 0; frame < 20; frame++)
        {
            await TickAsync(s);
            time.Advance(TimeSpan.FromSeconds(10));
        }
        var before = hub.Current!;
        Assert.Equal(LivePhase.LIVE, before.Phase);
        var listener = hub.Subscribe("10.2.2.2", null)!;

        // Quadro 20: a fonte cai. Três falhas seguidas no nacional → fase LIVE_STALE, último snapshot mantido.
        for (var i = 0; i < 3; i++) await TickAsync(s);
        var during = hub.Current!;
        Assert.Equal(LivePhase.LIVE_STALE, during.Phase);
        Assert.Same(before.National, during.National);
        var frames = new List<string>();
        while (listener.Subscriber.Channel.Reader.TryRead(out var frame)) frames.Add(Encoding.UTF8.GetString(frame));
        Assert.Contains(frames, f => f.Contains("event: source-stale", StringComparison.Ordinal));
        Assert.Contains(frames, f => f.Contains("event: national-update", StringComparison.Ordinal) && f.Contains("\"phase\":\"LIVE_STALE\"", StringComparison.Ordinal));

        // Fora da janela de falha: a fonte volta e a fase também.
        time.Advance(TimeSpan.FromSeconds(30));
        await TickAsync(s);
        Assert.Equal(LivePhase.LIVE, hub.Current!.Phase);
        frames.Clear();
        while (listener.Subscriber.Channel.Reader.TryRead(out var frame)) frames.Add(Encoding.UTF8.GetString(frame));
        Assert.Contains(frames, f => f.Contains("event: source-recovered", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Unchanged_files_are_conditional_gets_and_create_no_new_snapshot()
    {
        var s = await StartAsync();
        await TickAsync(s);
        var version = s.Hub.Current!.NationalVersion;
        await TickAsync(s); // mesmo quadro → 304
        Assert.Equal(version, s.Hub.Current!.NationalVersion);
    }

    [Fact]
    public async Task Visitors_never_increase_requests_to_the_source()
    {
        var s = await StartAsync();
        var counting = new CountingSource(s.Replay);
        var engine = new LiveIngestionEngine(counting, null, s.Hub, ReplayOptions, s.Metrics, s.Time, NullLogger.Instance) { ReplayEnvironment = s.Replay.EnvironmentName };
        await engine.InitializeAsync(CancellationToken.None);
        await engine.PollNationalAsync(CancellationToken.None);
        var before = counting.Requests;
        for (var i = 0; i < 1000; i++)
        {
            var sub = s.Hub.Subscribe($"10.0.{i / 250}.{i % 250}", null);
            Assert.NotNull(sub);
            _ = s.Hub.SummaryJson(s.Hub.Current!);
        }
        Assert.Equal(1000, s.Hub.Subscribers);
        Assert.Equal(before, counting.Requests);
    }

    private sealed class CountingSource(ITseSource inner) : ITseSource
    {
        public int Requests;

        public Task<TseFetchResult> FetchAsync(Uri url, TseConditional? conditional, TsePriority priority, CancellationToken ct)
        {
            Interlocked.Increment(ref Requests);
            return inner.FetchAsync(url, conditional, priority, ct);
        }
    }

    [Fact]
    public async Task Sse_reconnect_with_last_event_id_replays_missed_events_or_requires_snapshot()
    {
        var s = await StartAsync();
        var first = s.Hub.Subscribe("10.0.0.1", null)!;
        Assert.True(first.NeedsSnapshot);
        s.Hub.Publish("national-update", Encoding.UTF8.GetBytes("{\"data\":1}"));
        s.Hub.Publish("national-update", Encoding.UTF8.GetBytes("{\"data\":2}"));
        Assert.True(first.Subscriber.Channel.Reader.TryRead(out var frame1));
        var id = Encoding.UTF8.GetString(frame1).Split('\n')[0]["id: ".Length..];

        var resumed = s.Hub.Subscribe("10.0.0.1", id)!;
        Assert.False(resumed.NeedsSnapshot);
        var replayed = Assert.Single(resumed.Replay);
        Assert.Contains("{\"data\":2}", Encoding.UTF8.GetString(replayed));

        var unknown = s.Hub.Subscribe("10.0.0.2", "outra-instancia:5")!;
        Assert.True(unknown.NeedsSnapshot);
        Assert.Empty(unknown.Replay);
    }

    [Fact]
    public async Task Sse_limits_connections_per_ip_and_drops_slow_readers()
    {
        var s = await StartAsync();
        var subs = Enumerable.Range(0, ReplayOptions.MaxSsePerIp).Select(_ => s.Hub.Subscribe("10.9.9.9", null)).ToList();
        Assert.All(subs, Assert.NotNull);
        Assert.Null(s.Hub.Subscribe("10.9.9.9", null));
        s.Hub.Unsubscribe(subs[0]!.Subscriber);
        Assert.NotNull(s.Hub.Subscribe("10.9.9.9", null));

        var slow = s.Hub.Subscribe("10.1.1.1", null)!;
        for (var i = 0; i < 80; i++) s.Hub.Publish("timeline-event", Encoding.UTF8.GetBytes("{}"));
        // Ninguém leu: todas as conexões lentas foram fechadas (o cliente reconecta e recebe snapshot).
        Assert.Equal(0, s.Hub.Subscribers);
        Assert.False(slow.Subscriber.Channel.Writer.TryWrite([]));
    }

    [Fact]
    public async Task Envelope_meta_carries_source_and_ingestion_times_separately()
    {
        var s = await StartAsync();
        s.Time.Advance(TimeSpan.FromSeconds(10 * 30));
        await TickAsync(s);
        var state = s.Hub.Current!;
        var json = Encoding.UTF8.GetString(s.Hub.EnvelopeRaw(state, s.Hub.SummaryJson(state)));
        Assert.StartsWith("{\"data\":{", json, StringComparison.Ordinal);
        Assert.Contains("\"meta\":{\"source\":\"TSE\",\"mode\":\"replay\"", json, StringComparison.Ordinal);
        Assert.Contains("\"sourceGeneratedAt\":", json, StringComparison.Ordinal);
        Assert.Contains("\"ingestedAt\":", json, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------ cliente HTTP do TSE

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public readonly List<HttpRequestMessage> Requests = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(respond(request));
        }
    }

    private static (TseHttpSource Source, StubHandler Handler, FakeTimeProvider Time, LiveElectionMetrics Metrics) Http(Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var handler = new StubHandler(respond);
        var time = new FakeTimeProvider(DateTimeOffset.UtcNow);
        var metrics = new LiveElectionMetrics();
        var options = new LiveElectionOptions { MaxRequestsPerSecond = 80, BackgroundRequestsPerSecond = 80 };
        return (new TseHttpSource(new HttpClient(handler), options, metrics, time, NullLogger<TseHttpSource>.Instance), handler, time, metrics);
    }

    private static readonly Uri National = new("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json");

    [Fact]
    public async Task Http_source_sends_conditional_headers_and_maps_304()
    {
        var (source, handler, _, metrics) = Http(_ => new HttpResponseMessage(HttpStatusCode.NotModified));
        var result = await source.FetchAsync(National, new TseConditional("\"abc\"", "Sun, 25 Oct 2026 21:00:00 GMT"), TsePriority.Critical, CancellationToken.None);
        Assert.Equal(TseFetchStatus.NotModified, result.Status);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("\"abc\"", request.Headers.IfNoneMatch.Single().ToString());
        Assert.NotNull(request.Headers.IfModifiedSince);
        Assert.Equal(1, metrics.TseRequests);
    }

    [Fact]
    public async Task Http_source_never_retries_404_in_a_loop()
    {
        var (source, handler, time, _) = Http(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        Assert.Equal(TseFetchStatus.NotFound, (await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None)).Status);
        Assert.Equal(TseFetchStatus.NotFound, (await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None)).Status);
        Assert.Single(handler.Requests);
        time.Advance(TimeSpan.FromSeconds(61));
        await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Http_source_pauses_everything_after_a_block(HttpStatusCode status)
    {
        var (source, handler, time, _) = Http(_ => new HttpResponseMessage(status));
        Assert.Equal(TseFetchStatus.Blocked, (await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None)).Status);
        var other = new Uri("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-e006258-ab.json");
        Assert.Equal(TseFetchStatus.Blocked, (await source.FetchAsync(other, null, TsePriority.Critical, CancellationToken.None)).Status);
        Assert.Single(handler.Requests);
        time.Advance(TimeSpan.FromMinutes(12));
        await source.FetchAsync(other, null, TsePriority.Critical, CancellationToken.None);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task Http_source_backs_off_after_server_errors_and_refuses_foreign_hosts()
    {
        var (source, handler, time, _) = Http(_ => new HttpResponseMessage(HttpStatusCode.BadGateway));
        Assert.Equal(TseFetchStatus.Failed, (await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None)).Status);
        Assert.Equal(TseFetchStatus.Skipped, (await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None)).Status);
        Assert.Single(handler.Requests);
        time.Advance(TimeSpan.FromSeconds(5));
        await source.FetchAsync(National, null, TsePriority.Critical, CancellationToken.None);
        Assert.Equal(2, handler.Requests.Count);
        await Assert.ThrowsAsync<InvalidOperationException>(() => source.FetchAsync(new Uri("https://example.com/x.json"), null, TsePriority.Critical, CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() => source.FetchAsync(new Uri("https://replay.repbrasil.invalid/x.json"), null, TsePriority.Critical, CancellationToken.None));
    }

    [Fact]
    public void Configuration_accepts_flat_variables_and_keeps_safe_defaults()
    {
        var empty = LiveElectionConfiguration.Read(new ConfigurationBuilder().Build());
        Assert.False(empty.Enabled);
        Assert.Equal(LiveModes.Official, empty.Mode);
        Assert.Equal(20, empty.EffectiveMaxRequestsPerSecond);

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ELECTION_LIVE_ENABLED"] = "true",
            ["ELECTION_DATA_MODE"] = "replay",
            ["ELECTION_POLL_INTERVAL"] = "1500ms",
            ["ELECTION_REPLAY_SPEED"] = "30x",
            ["ELECTION_MAX_RPS"] = "500",
        }).Build();
        var options = LiveElectionConfiguration.Read(config);
        Assert.True(options.Enabled);
        Assert.Equal(LiveModes.Replay, options.Mode);
        Assert.Equal(TimeSpan.FromMilliseconds(1500), options.PollInterval);
        Assert.Equal(30, options.ReplaySpeed);
        Assert.Equal(LiveElectionOptions.HardMaxRequestsPerSecond, options.EffectiveMaxRequestsPerSecond);

        var invalid = LiveElectionConfiguration.Read(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ELECTION_DATA_MODE"] = "producao" }).Build());
        Assert.Equal(LiveModes.Official, invalid.Mode);
    }
}
