using System.Net;
using System.Net.Sockets;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Origem de um visitante para os limites da apuração (conexões SSE por origem e leituras por minuto). IPv4: o endereço
/// (muitos visitantes atrás de um CGNAT compartilham um); IPv6: o prefixo /64, que é o que um assinante recebe — por
/// endereço, quem tem um /64 trocaria de IP à vontade e escaparia do limite.
/// </summary>
public static class LiveClientKey
{
    public static string For(IPAddress? address)
    {
        if (address is null) return "unknown";
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return address.ToString();
        Span<byte> bytes = stackalloc byte[16];
        if (!address.TryWriteBytes(bytes, out _)) return address.ToString();
        bytes[8..].Clear();
        return new IPAddress(bytes).ToString() + "/64";
    }
}
