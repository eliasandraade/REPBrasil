// "Interruptores de rede" para os testes da PWA: uma queda de conexão real, que também derruba o
// fetch do service worker (a emulação offline do DevTools não alcança o worker de forma confiável —
// foi o falso resultado do smoke #3). Nenhum dos dois é um proxy aberto: o destino nunca vem da
// requisição, só da configuração.
import { createServer } from "node:http";
import net from "node:net";

function switchboard() {
  let offline = false;
  let refused = 0;
  const sockets = new Set();
  return {
    track(socket) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    },
    admit(client) {
      if (!offline) return true;
      refused += 1;
      client.destroy();
      return false;
    },
    pipe(client, upstream) {
      this.track(upstream);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    },
    get refused() {
      return refused;
    },
    setOffline(value) {
      offline = value;
      if (value) for (const socket of sockets) socket.destroy();
    },
    destroyAll() {
      for (const socket of sockets) socket.destroy();
    },
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

/**
 * Build local: o navegador acessa http://127.0.0.1:<porta do gate>, que repassa bytes para um único
 * upstream fixo (o `next start` do job). Desligado, derruba as conexões e recusa as novas.
 */
export async function startTcpGate({ upstreamHost, upstreamPort }) {
  const state = switchboard();
  const server = net.createServer((client) => {
    state.track(client);
    if (!state.admit(client)) return;
    const upstream = net.connect(upstreamPort, upstreamHost, () => {
      upstream.pipe(client);
      client.pipe(upstream);
    });
    state.pipe(client, upstream);
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    launchOptions: {},
    get refused() {
      return state.refused;
    },
    setOffline: (value) => state.setOffline(value),
    close() {
      state.destroyAll();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Produção: proxy só de túnel (CONNECT) para uma lista fechada de destinos HTTPS configurados
 * (site e API). O destino pedido é apenas a chave de busca na lista; qualquer outro é recusado.
 */
export async function startConnectTunnel({ origins }) {
  const allowed = new Map(
    origins.map((origin) => {
      const url = new URL(origin);
      const port = Number(url.port || 443);
      return [`${url.hostname}:${port}`, { host: url.hostname, port }];
    }),
  );
  const state = switchboard();
  // Requisições HTTP comuns não são encaminhadas: só túneis CONNECT para a lista acima.
  const proxy = createServer((_request, response) => {
    response.writeHead(405, { Connection: "close" }).end();
  });
  proxy.on("connection", (socket) => state.track(socket));
  proxy.on("connect", (request, client, head) => {
    if (!state.admit(client)) return;
    const destination = allowed.get(request.url);
    if (!destination) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect(destination.port, destination.host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    state.pipe(client, upstream);
  });
  const port = await listen(proxy);
  return {
    launchOptions: { proxy: { server: `http://127.0.0.1:${port}` } },
    get refused() {
      return state.refused;
    },
    setOffline: (value) => state.setOffline(value),
    close() {
      state.destroyAll();
      return new Promise((resolve) => proxy.close(resolve));
    },
  };
}
