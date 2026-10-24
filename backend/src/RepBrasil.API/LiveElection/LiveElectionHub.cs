using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using RepBrasil.Application.LiveElection;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Estado servido pela API e distribuição SSE. O estado é uma referência imutável trocada atomicamente; as projeções
/// (resumo, UFs) são calculadas uma vez por versão do estado e reaproveitadas por todos os visitantes. Cada mensagem SSE
/// é serializada uma única vez e entregue a todas as conexões — mil ou dez mil visitantes não geram nenhuma requisição a
/// mais ao TSE.
/// </summary>
public sealed class LiveElectionHub(LiveElectionOptions options, LiveElectionMetrics metrics, TimeProvider time)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private const int RingSize = 512;
    private readonly object writeLock = new();
    private readonly object viewLock = new();
    private readonly ConcurrentDictionary<Guid, Subscriber> subscribers = new();
    private readonly ConcurrentDictionary<string, int> perIp = new(StringComparer.Ordinal);
    private readonly (long Seq, byte[] Frame)[] ring = new (long, byte[])[RingSize];
    private readonly object ringLock = new();
    private readonly string boot = Guid.NewGuid().ToString("N")[..8];
    private LiveElectionState? state;
    private Views? views;
    private long sequence;

    public LiveElectionOptions Options => options;

    public LiveElectionState? Current => Volatile.Read(ref state);

    public string BootId => boot;

    public int Subscribers => subscribers.Count;

    public void Replace(LiveElectionState next)
    {
        lock (writeLock) Volatile.Write(ref state, next);
    }

    /// <summary>Atualização funcional sob lock: nenhuma escrita concorrente se perde.</summary>
    public LiveElectionState Update(Func<LiveElectionState, LiveElectionState> change)
    {
        lock (writeLock)
        {
            var current = state ?? throw new InvalidOperationException("Apuração ainda não inicializada.");
            var next = change(current);
            Volatile.Write(ref state, next);
            return next;
        }
    }

    // ------------------------------------------------------------ projeções em cache por versão do estado

    private sealed class Views(LiveElectionState owner)
    {
        public LiveElectionState Owner { get; } = owner;
        public byte[]? Summary;
        public byte[]? States;
        public byte[]? Candidates;
        public byte[]? Timeline;
    }

    private Views ViewsFor(LiveElectionState current)
    {
        var v = Volatile.Read(ref views);
        if (v is not null && ReferenceEquals(v.Owner, current)) return v;
        lock (viewLock)
        {
            if (views is null || !ReferenceEquals(views.Owner, current)) views = new Views(current);
            return views;
        }
    }

    private static byte[] Cached(ref byte[]? slot, Func<object> build)
    {
        var value = Volatile.Read(ref slot);
        if (value is not null) return value;
        value = JsonSerializer.SerializeToUtf8Bytes(build(), Json);
        Interlocked.CompareExchange(ref slot, value, null);
        return Volatile.Read(ref slot)!;
    }

    public byte[] SummaryJson(LiveElectionState s)
    {
        var v = ViewsFor(s);
        return Cached(ref v.Summary, () => LiveProjector.Summary(s));
    }

    public byte[] StatesJson(LiveElectionState s)
    {
        var v = ViewsFor(s);
        return Cached(ref v.States, () => LiveProjector.States(s));
    }

    public byte[] CandidatesJson(LiveElectionState s)
    {
        var v = ViewsFor(s);
        return Cached(ref v.Candidates, () => new CandidatesPayloadDto(LiveProjector.Candidates(s)));
    }

    public byte[] NationalTimelineJson(LiveElectionState s)
    {
        var v = ViewsFor(s);
        return Cached(ref v.Timeline, () => LiveProjector.Timeline(s, "br", "br"));
    }

    /// <summary>{"data": …, "meta": …} com a meta calculada agora (idade do dado) e os dados já serializados.</summary>
    public byte[] EnvelopeRaw(LiveElectionState s, ReadOnlySpan<byte> data, string? coverage = null)
    {
        var meta = JsonSerializer.SerializeToUtf8Bytes(LiveProjector.Meta(s, time.GetUtcNow(), coverage), Json);
        var buffer = new byte[data.Length + meta.Length + 18];
        var span = buffer.AsSpan();
        var n = 0;
        n += Encoding.UTF8.GetBytes("{\"data\":", span[n..]);
        data.CopyTo(span[n..]);
        n += data.Length;
        n += Encoding.UTF8.GetBytes(",\"meta\":", span[n..]);
        meta.CopyTo(span[n..]);
        n += meta.Length;
        n += Encoding.UTF8.GetBytes("}", span[n..]);
        return buffer[..n];
    }

    public byte[] Envelope(LiveElectionState s, object data, string? coverage = null) =>
        EnvelopeRaw(s, JsonSerializer.SerializeToUtf8Bytes(data, Json), coverage);

    // ------------------------------------------------------------ SSE

    public sealed class Subscriber
    {
        public required Guid Id { get; init; }
        public required string Ip { get; init; }
        public required Channel<byte[]> Channel { get; init; }
    }

    public sealed record Subscription(Subscriber Subscriber, IReadOnlyList<byte[]> Replay, bool NeedsSnapshot);

    /// <summary>
    /// Abre uma assinatura. Com Last-Event-ID desta instância ainda no buffer, devolve as mensagens perdidas; senão o
    /// cliente recebe um snapshot completo antes de continuar (nunca depende só de eventos perdidos).
    /// null = limite de conexões atingido.
    /// </summary>
    public Subscription? Subscribe(string ip, string? lastEventId)
    {
        if (subscribers.Count >= options.MaxSseConnections) return null;
        var count = perIp.AddOrUpdate(ip, 1, (_, c) => c + 1);
        if (count > options.MaxSsePerIp)
        {
            Release(ip);
            return null;
        }
        var subscriber = new Subscriber
        {
            Id = Guid.NewGuid(),
            Ip = ip,
            // Wait: TryWrite devolve false com a fila cheia (os modos Drop* devolvem true e descartariam em silêncio).
            Channel = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(64) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait }),
        };
        List<byte[]> replay = [];
        var needsSnapshot = true;
        lock (ringLock)
        {
            if (TryParseId(lastEventId, out var seq) && seq <= sequence)
            {
                var oldest = ring.Where(r => r.Frame is not null).Select(r => r.Seq).DefaultIfEmpty(long.MaxValue).Min();
                if (seq >= oldest - 1)
                {
                    replay = [.. ring.Where(r => r.Frame is not null && r.Seq > seq).OrderBy(r => r.Seq).Select(r => r.Frame)];
                    needsSnapshot = false;
                }
            }
            subscribers[subscriber.Id] = subscriber;
        }
        metrics.SseOpened();
        return new Subscription(subscriber, replay, needsSnapshot);
    }

    public void Unsubscribe(Subscriber subscriber)
    {
        if (subscribers.TryRemove(subscriber.Id, out _))
        {
            Release(subscriber.Ip);
            metrics.SseClosed();
        }
        subscriber.Channel.Writer.TryComplete();
    }

    private void Release(string ip)
    {
        var left = perIp.AddOrUpdate(ip, 0, (_, c) => Math.Max(0, c - 1));
        if (left == 0) perIp.TryRemove(new KeyValuePair<string, int>(ip, 0));
    }

    private bool TryParseId(string? id, out long seq)
    {
        seq = 0;
        if (string.IsNullOrWhiteSpace(id)) return false;
        var parts = id.Split(':');
        return parts.Length == 2 && parts[0] == boot && long.TryParse(parts[1], out seq);
    }

    /// <summary>Frame SSE com id próprio, sem guardar no buffer (snapshot inicial de uma conexão).</summary>
    public byte[] Frame(string eventName, ReadOnlySpan<byte> json)
    {
        var id = $"{boot}:{Interlocked.Read(ref sequence)}";
        return Encode(id, eventName, json);
    }

    private static byte[] Encode(string id, string eventName, ReadOnlySpan<byte> json)
    {
        var head = Encoding.UTF8.GetBytes($"id: {id}\nevent: {eventName}\ndata: ");
        var frame = new byte[head.Length + json.Length + 2];
        head.CopyTo(frame, 0);
        json.CopyTo(frame.AsSpan(head.Length));
        frame[^2] = (byte)'\n';
        frame[^1] = (byte)'\n';
        return frame;
    }

    /// <summary>Publica um evento: serializado uma vez, guardado no buffer e enviado a todas as conexões.</summary>
    public void Publish(string eventName, byte[] envelopeJson)
    {
        byte[] frame;
        lock (ringLock)
        {
            var seq = ++sequence;
            frame = Encode($"{boot}:{seq}", eventName, envelopeJson);
            ring[seq % RingSize] = (seq, frame);
        }
        var delivered = 0;
        foreach (var subscriber in subscribers.Values)
        {
            if (subscriber.Channel.Writer.TryWrite(frame)) delivered++;
            else Unsubscribe(subscriber); // conexão lenta: fecha; o cliente reconecta e recebe snapshot
        }
        metrics.SseMessage(delivered);
    }
}
