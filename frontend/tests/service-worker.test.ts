// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://www.apprepbrasil.com.br";
const SOURCE = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");

type Listener = (event: unknown) => void;

class FakeCache {
  readonly entries = new Map<string, Response>();

  async addAll(requests: Request[]) {
    for (const request of requests) this.entries.set(request.url, new Response(`precached ${request.url}`));
  }

  async put(request: Request | string, response: Response) {
    this.entries.set(typeof request === "string" ? request : request.url, response);
  }

  async match(request: Request | string) {
    return this.entries.get(typeof request === "string" ? request : request.url);
  }
}

function loadWorker(fetchImpl: (request: Request) => Promise<Response>, version = "rev-2", existing: string[] = []) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, FakeCache>(existing.map((name) => [name, new FakeCache()]));
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    has: async (name: string) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: Request | string, options: { cacheName: string }) =>
      stores.get(options.cacheName)?.match(request),
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=${version}`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const fetchSpy = vi.fn(fetchImpl);
  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchSpy, Request, Response, URL, Promise, console });
  return { listeners, stores, self, fetchSpy };
}

async function lifecycle(worker: ReturnType<typeof loadWorker>, type: "install" | "activate") {
  let pending: Promise<unknown> = Promise.resolve();
  worker.listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
}

async function dispatchFetch(worker: ReturnType<typeof loadWorker>, request: Request) {
  let responded: Promise<Response> | undefined;
  worker.listeners.get("fetch")!({ request, respondWith: (promise: Promise<Response>) => { responded = promise; } });
  return responded ? await responded : undefined;
}

function navigation(path: string) {
  const request = new Request(`${ORIGIN}${path}`);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("service worker factual-safe", () => {
  it("precacheia só o fallback estático e os ícones, num cache da versão do deploy", async () => {
    const worker = loadWorker(offline);
    await lifecycle(worker, "install");

    expect([...worker.stores.keys()]).toEqual(["repbrasil-rev-2"]);
    expect([...worker.stores.get("repbrasil-rev-2")!.entries.keys()]).toEqual([
      `${ORIGIN}/offline.html`,
      `${ORIGIN}/favicon.ico`,
      `${ORIGIN}/brand/icon-192.png`,
      `${ORIGIN}/brand/icon-512.png`,
      `${ORIGIN}/brand/icon-maskable-512.png`,
      `${ORIGIN}/brand/apple-touch-icon.png`,
    ]);
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("ao ativar apaga os caches de versões anteriores (inclusive o legado) e assume as abas", async () => {
    const worker = loadWorker(offline, "rev-2", ["repbrasil-shell-v1", "repbrasil-rev-1", "outro-app"]);
    await lifecycle(worker, "install");
    await lifecycle(worker, "activate");

    expect([...worker.stores.keys()].sort()).toEqual(["outro-app", "repbrasil-rev-2"]);
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });

  it("navegação online vem da rede e nunca é guardada em cache", async () => {
    const worker = loadWorker(async () => new Response("<h1>apuração atual</h1>", { status: 200 }));
    await lifecycle(worker, "install");
    const response = await dispatchFetch(worker, navigation("/eleicoes/2026/1/ce"));

    expect(await response!.text()).toBe("<h1>apuração atual</h1>");
    expect(worker.stores.get("repbrasil-rev-2")!.entries.has(`${ORIGIN}/eleicoes/2026/1/ce`)).toBe(false);
  });

  it("navegação sem conexão recebe o fallback estático, nunca uma página factual guardada", async () => {
    const worker = loadWorker(offline);
    await lifecycle(worker, "install");
    const response = await dispatchFetch(worker, navigation("/pesquisas?ano=2026"));

    expect(await response!.text()).toBe(`precached ${ORIGIN}/offline.html`);
  });

  it("sem fallback em cache responde 503 explícito em vez de falhar em silêncio", async () => {
    const worker = loadWorker(offline);
    const response = await dispatchFetch(worker, navigation("/parlamento"));

    expect(response!.status).toBe(503);
    expect(response!.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["API da mesma origem", new Request(`${ORIGIN}/api/v1/overview`)],
    ["API de outra origem", new Request("https://api.apprepbrasil.com.br/api/v1/parliament/members?uf=CE")],
    ["payload RSC do Next", new Request(`${ORIGIN}/dados?_rsc=abc123`, { headers: { RSC: "1" } })],
    ["método que não é GET", new Request(`${ORIGIN}/_next/static/chunks/app.js`, { method: "POST", body: "x" })],
    ["arquivo de malha geográfica", new Request(`${ORIGIN}/geo/ce/municipios.json`)],
  ])("%s nunca é interceptado", async (_label, request) => {
    const worker = loadWorker(offline);
    expect(await dispatchFetch(worker, request)).toBeUndefined();
  });

  it("estáticos com hash são cache-first e só respostas válidas da mesma origem entram no cache", async () => {
    const worker = loadWorker(async () => new Response("chunk", { status: 200 }));
    await lifecycle(worker, "install");
    Object.defineProperty(Response.prototype, "type", { configurable: true, get: () => "basic" });
    try {
      const request = new Request(`${ORIGIN}/_next/static/chunks/app-123.js`);
      const first = await dispatchFetch(worker, request);
      const second = await dispatchFetch(worker, request);

      expect(await first!.text()).toBe("chunk");
      expect(await second!.text()).toBe("chunk");
      expect(worker.fetchSpy).toHaveBeenCalledOnce();
    } finally {
      delete (Response.prototype as { type?: unknown }).type;
    }
  });

  it("worker antigo, depois que um deploy novo apagou seu cache, só repassa e não recria o cache", async () => {
    const worker = loadWorker(async () => new Response("chunk", { status: 200 }), "rev-1");
    await lifecycle(worker, "install");
    worker.stores.delete("repbrasil-rev-1");

    const chunk = await dispatchFetch(worker, new Request(`${ORIGIN}/_next/static/chunks/late-prefetch.js`));
    const page = await dispatchFetch(worker, navigation("/dados"));

    expect(await chunk!.text()).toBe("chunk");
    expect(await page!.text()).toBe("chunk");
    expect(worker.stores.has("repbrasil-rev-1")).toBe(false);
  });

  it("estático com erro não é guardado", async () => {
    const worker = loadWorker(async () => new Response("missing", { status: 404 }));
    const request = new Request(`${ORIGIN}/_next/static/chunks/missing.js`);
    await dispatchFetch(worker, request);
    await dispatchFetch(worker, request);

    expect(worker.fetchSpy).toHaveBeenCalledTimes(2);
  });
});
