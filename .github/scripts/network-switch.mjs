// Proxy HTTP local que funciona como "interruptor de rede" para os testes da PWA.
//
// Todo o tráfego do navegador de teste passa por aqui (CONNECT para HTTPS, encaminhamento simples
// para HTTP — o Playwright força também o loopback pelo proxy). Desligado, o proxy derruba as
// conexões abertas e recusa as novas: o fetch do service worker falha de verdade, como em modo
// avião. A emulação offline do DevTools para service workers não serve para isso: ela se perde
// quando a página passa a ser controlada pelo worker (foi o falso resultado do smoke #3).
import http from "node:http";
import net from "node:net";

export async function startNetworkSwitch() {
  let offline = false;
  let refused = 0;
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const refuse = (socket) => {
    refused += 1;
    socket.destroy();
  };

  const server = http.createServer((request, response) => {
    if (offline) {
      refuse(request.socket);
      return;
    }
    let target;
    try {
      target = new URL(request.url);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port || 80,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: request.headers,
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });

  server.on("connection", track);
  server.on("connect", (request, client, head) => {
    if (offline) {
      refuse(client);
      return;
    }
    const [host, port] = request.url.split(":");
    const upstream = net.connect(Number(port) || 443, host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  return {
    proxyServer: `http://127.0.0.1:${port}`,
    get refused() {
      return refused;
    },
    setOffline(value) {
      offline = value;
      if (value) for (const socket of sockets) socket.destroy();
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
