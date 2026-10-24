using System.Net;
using Microsoft.Extensions.Time.Testing;
using RepBrasil.API.LiveElection;
using RepBrasil.Application.LiveElection;

namespace RepBrasil.Tests.LiveElection;

/// <summary>Limites de conexão SSE por origem (CGNAT, IPv6, pressão) e teto da linha do tempo servida.</summary>
public sealed class LiveLimitsTests
{
    private static LiveElectionHub Hub(LiveElectionOptions options) =>
        new(options, new LiveElectionMetrics(), new FakeTimeProvider(DateTimeOffset.UtcNow));

    [Fact]
    public void Per_origin_cap_is_generous_and_tightens_only_under_pressure()
    {
        var hub = Hub(new LiveElectionOptions { MaxSseConnections = 100, MaxSsePerIp = 60, MaxSsePerIpUnderPressure = 10 });
        // CGNAT: muitos visitantes atrás de uma origem cabem enquanto o servidor tem folga.
        Assert.All(Enumerable.Range(0, 60), _ => Assert.NotNull(hub.Subscribe("200.1.1.1", null)));
        Assert.Null(hub.Subscribe("200.1.1.1", null));
        Assert.All(Enumerable.Range(0, 9), _ => Assert.NotNull(hub.Subscribe("200.2.2.2", null)));
        Assert.All(Enumerable.Range(0, 11), i => Assert.NotNull(hub.Subscribe($"200.3.3.{i}", null)));
        Assert.Equal(80, hub.Subscribers);

        // Acima de 80% do teto global: origem que já tem 10 não abre mais; as vagas ficam para origens distintas.
        Assert.NotNull(hub.Subscribe("200.2.2.2", null)); // 10ª da origem
        Assert.Null(hub.Subscribe("200.2.2.2", null));
        Assert.Null(hub.Subscribe("200.1.1.1", null));
        Assert.All(Enumerable.Range(0, 19), i => Assert.NotNull(hub.Subscribe($"200.4.4.{i}", null)));
        Assert.Equal(100, hub.Subscribers);
        Assert.Null(hub.Subscribe("200.5.5.5", null)); // teto global
    }

    [Fact]
    public void Origin_key_groups_ipv6_by_64_and_keeps_ipv4_whole()
    {
        Assert.Equal("200.10.20.30", LiveClientKey.For(IPAddress.Parse("200.10.20.30")));
        Assert.Equal("200.10.20.30", LiveClientKey.For(IPAddress.Parse("::ffff:200.10.20.30")));
        var a = LiveClientKey.For(IPAddress.Parse("2804:14c:65a1:1234:1111:2222:3333:4444"));
        var b = LiveClientKey.For(IPAddress.Parse("2804:14c:65a1:1234:aaaa:bbbb:cccc:dddd"));
        var other = LiveClientKey.For(IPAddress.Parse("2804:14c:65a1:9999::1"));
        Assert.Equal("2804:14c:65a1:1234::/64", a);
        Assert.Equal(a, b);
        Assert.NotEqual(a, other);
        Assert.Equal("unknown", LiveClientKey.For(null));
    }

    [Fact]
    public void Served_timeline_is_capped_keeping_first_last_and_order()
    {
        var start = new DateTimeOffset(2026, 10, 25, 20, 0, 0, TimeSpan.Zero);
        var points = Enumerable.Range(1, 14_400)
            .Select(i => new TimelinePoint(i, start.AddSeconds(i), start.AddSeconds(i), i / 144m, null, i, i * 10L, null, [], null, null, null))
            .ToList();
        var served = LiveProjector.Downsample(points, LiveProjector.MaxTimelinePoints);
        Assert.True(served.Count <= LiveProjector.MaxTimelinePoints);
        Assert.True(served.Count > LiveProjector.MaxTimelinePoints * 0.9);
        Assert.Equal(1, served[0].Version);
        Assert.Equal(14_400, served[^1].Version);
        Assert.Equal(served.Select(p => p.Version).Order(), served.Select(p => p.Version));
        var few = points.Take(100).ToList();
        Assert.Same(few, LiveProjector.Downsample(few, LiveProjector.MaxTimelinePoints));
    }
}
