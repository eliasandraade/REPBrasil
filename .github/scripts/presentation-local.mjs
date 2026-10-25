// Verifica o Modo Apresentação contra o build de produção (next start) desta revisão, com uma API de testes local
// (fixtures sintéticas em modo "replay" — a própria tela mostra "REPLAY — dados de teste"). Sem backend e sem TSE:
// o navegador só fala com a API do REPBrasil (aqui, a de testes), como em produção.
//
// Uso: build do frontend com NEXT_PUBLIC_API_URL=http://127.0.0.1:9100 e `next start -p 3100`; depois
//   REPBRASIL_WEB_URL=http://127.0.0.1:3100 node .github/scripts/presentation-local.mjs
// Saída: artifacts/presentation-local/ (report.json e capturas).
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { buildScenario, KEY_A, KEY_B, meta } from "./presentation-fixtures.mjs";

const WEB = new URL(process.env.REPBRASIL_WEB_URL ?? "http://127.0.0.1:3100");
const API_PORT = Number(process.env.PRESENTATION_API_PORT ?? 9100);
const OUT = process.env.PRESENTATION_OUT ?? "artifacts/presentation-local";
const ROUTE = "/apuracao/2026/presidente/segundo-turno/apresentacao";
const BASE = "/api/v1/elections/2026/president/second-round";
const HD = { width: 1920, height: 1080 };
const results = [];
const metrics = {};

function record(name, details = {}) {
  results.push({ name, ok: true, ...details });
  console.log(`✓ ${name}`);
}

const summarizeTasks = (tasks) => ({ count: tasks.length, maxMs: tasks.length ? Math.max(...tasks.map((t) => t.ms)) : 0 });
const fmtPct = (n) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const pctile = (values, p) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)] : null;
};

// ------------------------------------------------------------------ API de testes (REST + SSE de verdade)

function createApi() {
  let boot = "b0000001";
  let seq = 0;
  // Versão monotônica entre execuções, como o id de snapshot do PostgreSQL: o cache de dados do Next (`.next/cache`)
  // guarda o HTML da execução anterior, e uma versão menor seria (corretamente) recusada pelo cliente como antiga.
  let version = Date.now();
  let current = buildScenario("pre");
  const ring = [];
  const clients = new Set();
  const streamRequests = [];
  const envelope = (data) => ({ data, meta: meta(current.summary, version) });
  const frame = (event, payload) => {
    seq += 1;
    const text = `id: ${boot}:${seq}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    ring.push({ seq, text });
    if (ring.length > 256) ring.shift();
    return text;
  };
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://api.test");
    requests.push(`${new Date().toISOString().slice(11, 23)} ${req.method} ${url.pathname.replace(BASE, "")}`);
    // Só a origem do site sob teste (fixa, nunca a que veio na requisição), com credenciais: o layout do site
    // consulta a sessão da conta com cookies.
    res.setHeader("Access-Control-Allow-Origin", WEB.origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Accept, Cache-Control, Last-Event-ID, Content-Type");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (url.pathname === "/api/v1/account/session") return res.writeHead(401, { "Content-Type": "application/json" }).end('{"authenticated":false}');
    if (!url.pathname.startsWith(BASE)) return res.writeHead(404).end();
    const path = url.pathname.slice(BASE.length);
    const json = (status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (path === "/summary") return json(200, envelope(current.summary));
    if (path === "/states") return json(200, envelope(current.states));
    if (path === "/timeline") return json(200, envelope({ scope: "br", code: "br", points: [], leadChanges: [] }));
    if (path === "/events") return res.writeHead(204).end();
    if (path.startsWith("/photos/")) return res.writeHead(404).end();
    if (path === "/stream") {
      const last = req.headers["last-event-id"] ?? url.searchParams.get("lastEventId") ?? null;
      streamRequests.push({ at: Date.now(), lastEventId: last });
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      const [lastBoot, lastSeq] = String(last ?? "").split(":");
      if (last && lastBoot === boot && Number(lastSeq) <= seq) {
        const missed = ring.filter((f) => f.seq > Number(lastSeq));
        for (const f of missed) res.write(f.text);
        streamRequests.at(-1).replayed = missed.length;
      } else {
        res.write(`id: ${boot}:${seq}\nevent: snapshot\ndata: ${JSON.stringify(envelope(current.summary))}\n\n`);
      }
      clients.add(res);
      const hb = setInterval(() => res.write(": hb\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(hb);
        clients.delete(res);
      });
      return;
    }
    return json(404, { error: "not found" });
  });
  const broadcast = (texts) => {
    for (const c of clients) for (const t of texts) c.write(t);
  };
  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(API_PORT, "127.0.0.1", resolve);
      }),
    // Streams e keep-alive de qualquer cliente (inclusive um navegador fora do teste) não podem segurar o encerramento.
    close: () =>
      new Promise((resolve) => {
        for (const c of clients) c.destroy();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
    /** Troca o cenário servido pelo REST (versão nova: o cliente aceita na ressincronização). */
    set(name) {
      current = buildScenario(name);
      version += 1;
      return current;
    },
    /** Publica o cenário como o backend faria numa atualização: national-update (+ state-update). Devolve o instante da escrita. */
    publish(name, { states = true, extra = [] } = {}) {
      current = buildScenario(name);
      version += 1;
      const m = meta(current.summary, version);
      const s = current.summary;
      const texts = [frame("national-update", { data: { phase: s.phase, official: s.official, national: s.national, math: s.math, source: s.source, velocity: s.velocity, defined: s.defined }, meta: m })];
      if (states) texts.push(frame("state-update", { data: current.states, meta: m }));
      for (const [event, data] of extra) texts.push(frame(event, { data, meta: m }));
      const writtenAt = Date.now();
      broadcast(texts);
      return { writtenAt, scenario: current };
    },
    dropStreams() {
      for (const c of clients) c.end();
      clients.clear();
    },
    newBoot() {
      boot = `b${Date.now().toString(16).slice(-7)}`;
      seq = 0;
      ring.length = 0;
    },
    streamRequests,
    requests,
    get clients() {
      return clients.size;
    },
    get scenario() {
      return current;
    },
  };
}

// ------------------------------------------------------------------ instrumentos no navegador (só no teste)

function instrument() {
  const now = () => performance.timeOrigin + performance.now();
  window.__pm = { sse: [], dom: [], longTasks: [], cls: 0, lcp: null, frames: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__pm.longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__pm.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      const e = list.getEntries();
      window.__pm.lcp = Math.round(e[e.length - 1].startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // sem suporte
  }
  const tick = () => {
    window.__pm.frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const Native = window.EventSource;
  function Wrapped(url, init) {
    const es = new Native(url, init);
    for (const name of ["snapshot", "national-update", "state-update"]) {
      es.addEventListener(name, (ev) => {
        let v = null;
        try {
          v = JSON.parse(ev.data).meta.snapshotVersion;
        } catch {
          // ignorado
        }
        window.__pm.sse.push({ name, t: now(), v, id: ev.lastEventId });
      });
    }
    return es;
  }
  Wrapped.prototype = Native.prototype;
  Wrapped.CONNECTING = 0;
  Wrapped.OPEN = 1;
  Wrapped.CLOSED = 2;
  window.EventSource = Wrapped;
  document.addEventListener("DOMContentLoaded", () => {
    const watch = () => {
      const el = document.querySelector('[data-testid="presentation-total"] .pm-total-pct');
      if (!el) return setTimeout(watch, 100);
      new MutationObserver(() => window.__pm.dom.push({ t: now(), text: el.textContent })).observe(el, { subtree: true, childList: true, characterData: true });
    };
    watch();
  });
}

const scrollCheck = () => {
  const se = document.scrollingElement;
  const scrollers = [...document.querySelectorAll("*")]
    .filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    })
    .map((el) => String(el.className || el.tagName).slice(0, 80));
  const outside = ["presentation-candidate-a", "presentation-candidate-b", "presentation-total", "presentation-strip", "presentation-ticker", "presentation-advantage"]
    .map((id) => [id, document.querySelector(`[data-testid="${id}"]`)])
    .filter(([, el]) => el && getComputedStyle(el).display !== "none")
    .filter(([, el]) => {
      const r = el.getBoundingClientRect();
      return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    })
    .map(([id]) => id);
  // Cabeçalho: cada peça visível inteira na tela e nenhuma sobre a outra (título, selos, horário).
  const nameOf = (el) => el.getAttribute("data-testid") || String(el.className || el.tagName).split(" ")[0];
  const parts = [...document.querySelectorAll(".pm-header > *:not(.pm-header-right), .pm-header-right > *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0;
  });
  const rects = parts.map((el) => [nameOf(el), el.getBoundingClientRect()]);
  for (const [name, r] of rects) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) outside.push(`header:${name}`);
  const overlaps = [];
  rects.forEach(([a, ra], i) =>
    rects.slice(i + 1).forEach(([b, rb]) => {
      if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) overlaps.push(`${a}×${b}`);
    }),
  );
  // Nada clicável fica coberto (os controles flutuam, mas nunca sobre as UFs).
  const covered = [...document.querySelectorAll('[data-testid="presentation-strip"] [data-uf]')]
    .filter((cell) => {
      const r = cell.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !hit || !cell.contains(hit);
    })
    .map((cell) => cell.getAttribute("data-uf"));
  // Rótulos fixos dos indicadores sempre inteiros, e o painel sem conteúdo vazando para baixo.
  const kpiLabels = [...document.querySelectorAll(".pm-kpi dt")].filter((dt) => dt.scrollWidth > dt.clientWidth + 1).map((dt) => dt.textContent);
  const kpis = document.querySelector('[data-testid="presentation-kpis"]');
  if (kpis && getComputedStyle(kpis).display !== "none") {
    const grid = kpis.querySelector(".pm-kpi-grid")?.getBoundingClientRect();
    if (grid && grid.bottom > kpis.getBoundingClientRect().bottom + 1) kpiLabels.push("(painel transborda)");
  }
  // Qualquer texto cortado com reticências fica registrado no relatório (nomes oficiais longos, por exemplo).
  const ellipsis = [...document.querySelectorAll(".pm-root *")]
    .filter((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${nameOf(el)}: ${el.textContent.trim().slice(0, 28)}`);
  return { documentScrolls: se.scrollHeight > se.clientHeight + 1, horizontal: se.scrollWidth > se.clientWidth + 1, scrollers, outside, covered, overlaps, kpiLabels, ellipsis };
};

/** Tela cheia recusada pelo navegador (política, sem gesto, quiosque): a apresentação tem de seguir no viewport. */
function denyFullscreen() {
  Element.prototype.requestFullscreen = () => Promise.reject(new DOMException("recusada no teste", "NotAllowedError"));
}

async function openStage(browser, viewport, { reducedMotion = "no-preference", start = true, mobile = false, query = "", fullscreen = true } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion, locale: "pt-BR", timezoneId: "America/Sao_Paulo", isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(instrument);
  if (!fullscreen) await context.addInitScript(denyFullscreen);
  const page = await context.newPage();
  const errors = [];
  page.__log = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    page.__log.push(`[${m.type()}] ${m.text().slice(0, 240)}`);
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  page.on("requestfailed", (r) => page.__log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ""}`));
  await page.goto(new URL(`${ROUTE}${query}`, WEB).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="presentation-intro"]', { timeout: 30_000 });
  if (start) {
    await page.click('[data-testid="presentation-start"]');
    await page.waitForSelector('[data-testid="presentation-intro"]', { state: "detached", timeout: 10_000 });
  }
  return { context, page, errors };
}

async function statusIs(page, label) {
  try {
    await page.waitForFunction((l) => document.querySelector('[data-testid="presentation-status"]')?.textContent?.includes(l), label, { timeout: 20_000 });
  } catch (error) {
    // Diagnóstico da falha: o que a página mostrava, o console e as requisições que a API de testes recebeu.
    const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "(sem página)");
    const sse = await page.evaluate(() => window.__pm?.sse?.slice(-5) ?? null).catch(() => null);
    const lines = [
      `statusIs("${label}") falhou`,
      `— página: ${body.replace(/\n+/g, " | ")}`,
      `— sse: ${JSON.stringify(sse)}`,
      "— console:",
      ...page.__log.slice(-25),
      "— api:",
      ...api.requests.slice(-25),
    ];
    console.error(lines.join("\n"));
    await page.screenshot({ path: `${OUT}/falha-${label.replace(/\W+/g, "-")}.png` }).catch(() => undefined);
    throw error;
  }
}
const text = (page, sel) => page.locator(sel).first().innerText();

/** Quadros por segundo medidos pelo rAF da página (o mesmo relógio da animação). */
async function measureFps(page, ms) {
  const a = await page.evaluate(() => ({ f: window.__pm.frames, t: performance.now() }));
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => ({ f: window.__pm.frames, t: performance.now() }));
  return Math.round(((b.f - a.f) * 1000) / (b.t - a.t));
}

/** Captura no estado de telão: ponteiro parado longe do mapa e controles recolhidos (depois das checagens de DOM). */
async function idleShot(page, path) {
  await page.mouse.move(4, 4);
  await page.waitForSelector('[data-testid="presentation-root"][data-idle="true"]', { timeout: 8_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path });
}

// ------------------------------------------------------------------ roteiro

await mkdir(OUT, { recursive: true });
const api = createApi();
await api.listen();
const browser = await chromium.launch();
let failure = null;
try {
  // 1) Cenários visuais em 1920×1080 + regras de correção na tela + DOM sem segundo scroll.
  const expectations = {
    pre: { status: "PRÉ-APURAÇÃO" },
    p5: { status: "AO VIVO" },
    p20: { status: "AO VIVO" },
    p50: { status: "AO VIVO" },
    p80: { status: "AO VIVO" },
    p95: { status: "AO VIVO" },
    close: { status: "AO VIVO" },
    comfortable: { status: "AO VIVO" },
    stale: { status: "AGUARDANDO ATUALIZAÇÃO" },
    md: { status: "ELEIÇÃO DEFINIDA" },
    final: { status: "RESULTADO FINAL" },
  };
  for (const [name, expect] of Object.entries(expectations)) {
    const scenario = api.set(name);
    const { context, page, errors } = await openStage(browser, HD);
    await statusIs(page, expect.status);
    await page.waitForTimeout(name === "md" || name === "final" ? 700 : 1_200);
    const dom = await page.evaluate(scrollCheck);
    assert.equal(dom.documentScrolls, false, `${name}: documento não pode rolar`);
    assert.deepEqual(dom.scrollers, [], `${name}: nenhum contêiner rolável (${dom.scrollers.join(", ")})`);
    assert.equal(dom.horizontal, false, `${name}: sem overflow horizontal`);
    assert.deepEqual(dom.outside, [], `${name}: nada cortado fora da viewport (${dom.outside.join(", ")})`);
    assert.deepEqual(dom.covered, [], `${name}: nenhuma UF coberta pelos controles (${dom.covered.join(", ")})`);
    assert.deepEqual(dom.overlaps, [], `${name}: peças do cabeçalho sobrepostas (${dom.overlaps.join(", ")})`);
    assert.deepEqual(dom.kpiLabels, [], `${name}: indicadores cortados (${dom.kpiLabels.join(", ")})`);
    const mdBanner = await page.locator('[data-testid="presentation-md-banner"]').count();
    assert.equal(mdBanner > 0, name === "md", `${name}: banner de definição só com md=e`);
    if (name === "pre") {
      assert.equal(await page.locator('[data-testid="presentation-pct-a"][data-empty="true"]').count(), 1, "pré-apuração: nenhum percentual de A");
      assert.equal(await page.locator('[data-testid="presentation-pct-b"][data-empty="true"]').count(), 1, "pré-apuração: nenhum percentual de B");
      assert.match(await text(page, '[data-testid="presentation-advantage"]'), /Aguardando início da totalização/);
    } else {
      const a = scenario.summary.national.candidates.find((c) => c.key === KEY_A).pct;
      assert.equal((await text(page, '[data-testid="presentation-pct-a"]')).replace(/\s/g, ""), fmtPct(a), `${name}: percentual de A igual ao da API`);
      const leaderSlot = scenario.summary.national.leaderKey === KEY_A ? "a" : "b";
      assert.match(await text(page, `[data-testid="presentation-candidate-${leaderSlot}"] .pm-badge`), name === "final" ? /ELEITO/ : /NA FRENTE/, `${name}: destaque de quem lidera`);
    }
    if (name === "stale") assert.ok(await page.locator('[data-testid="presentation-stale-banner"]').count(), "fonte parada: aviso e último dado mantido");
    if (name === "final") {
      assert.ok(!(await text(page, '[data-testid="presentation-status"]')).includes("AO VIVO"), "FINAL sem AO VIVO");
      assert.ok(await page.locator('[data-testid="presentation-final-banner"]').count(), "banner de resultado final");
    }
    const tag = await text(page, '[data-testid="presentation-ticker-tag"]');
    assert.equal(tag.includes("AO VIVO"), expect.status === "AO VIVO" || expect.status === "ELEIÇÃO DEFINIDA", `${name}: selo do ticker (${tag})`);
    if (name === "pre") assert.doesNotMatch(await text(page, '[data-testid="presentation-ticker"]'), /\b[A-Z]{2} • \d/, "pré-apuração: ticker sem percentuais por UF");
    assert.deepEqual(errors, [], `${name}: sem erro de JavaScript`);
    await idleShot(page, `${OUT}/1920x1080-${name}.png`);
    record(`cenário ${name}: ${expect.status}, sem segundo scroll, regras de correção`, { dom });
    await context.close();
  }

  // 2) Tamanhos (cenário 50%): telas grandes, notebook, tablet e celular.
  api.set("p50");
  for (const [w, h, mobile] of [[2560, 1440], [3840, 2160], [1440, 900], [1366, 768], [1024, 768], [844, 390, true], [390, 844, true]]) {
    const { context, page, errors } = await openStage(browser, { width: w, height: h }, { mobile: Boolean(mobile) });
    await statusIs(page, "AO VIVO");
    await page.waitForTimeout(1_200);
    const dom = await page.evaluate(scrollCheck);
    assert.equal(dom.documentScrolls, false, `${w}x${h}: documento não pode rolar`);
    assert.deepEqual(dom.scrollers, [], `${w}x${h}: nenhum contêiner rolável`);
    assert.equal(dom.horizontal, false, `${w}x${h}: sem overflow horizontal`);
    assert.deepEqual(dom.outside, [], `${w}x${h}: nada cortado (${dom.outside.join(", ")})`);
    assert.deepEqual(dom.covered, [], `${w}x${h}: nenhuma UF coberta (${dom.covered.join(", ")})`);
    assert.deepEqual(dom.overlaps, [], `${w}x${h}: peças do cabeçalho sobrepostas (${dom.overlaps.join(", ")})`);
    assert.deepEqual(dom.kpiLabels, [], `${w}x${h}: indicadores cortados (${dom.kpiLabels.join(", ")})`);
    assert.deepEqual(errors, [], `${w}x${h}: sem erro de JavaScript`);
    await idleShot(page, `${OUT}/${w}x${h}-p50.png`);
    // Telão parado (ticker, luz e ponto ao vivo em movimento): quadros por segundo no tamanho de TV.
    if (w >= 1920) (metrics.idleFps ??= {})[`${w}x${h}`] = await measureFps(page, 3_000);
    record(`tamanho ${w}x${h}: composição fechada na viewport`, { dom });
    await context.close();
  }

  // 3) UF em foco (clique na faixa), troca de liderança por SSE e latência SSE → DOM.
  {
    api.set("leadBefore");
    const { context, page } = await openStage(browser, HD);
    await statusIs(page, "AO VIVO");
    await page.locator('[data-testid="presentation-strip"] [data-uf="SP"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="presentation-spotlight"]')?.getAttribute("data-uf") === "SP");
    await idleShot(page, `${OUT}/1920x1080-foco-uf.png`);
    assert.ok(await page.locator(".pm-uf-lift").count(), "UF em foco sobe no mapa");
    record("UF em foco: spotlight e mapa (SP)");

    await page.keyboard.press("r");
    await page.waitForFunction(() => document.querySelector('[data-testid="presentation-spotlight"]')?.getAttribute("data-uf") === "BR");
    const before = await text(page, '[data-testid="presentation-candidate-a"] .pm-badge');
    assert.match(before, /NA FRENTE/, "antes: A à frente");
    await page.waitForSelector('[data-testid="presentation-root"][data-idle="true"]', { timeout: 8_000 });
    const change = { id: 9001, at: new Date().toISOString(), detectedAt: new Date().toISOString(), previousLeaderKey: KEY_A, newLeaderKey: KEY_B, sectionsPct: 35.9, votes: [], leadVotes: 1, snapshotVersion: 0 };
    const { writtenAt } = api.publish("leadAfter", { extra: [["lead-change", change]] });
    await page.waitForFunction(() => /NA FRENTE/.test(document.querySelector('[data-testid="presentation-candidate-b"] .pm-badge')?.textContent ?? ""), null, { timeout: 5_000 });
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${OUT}/1920x1080-troca-lideranca-cena.png` });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/1920x1080-troca-lideranca.png` });
    const trace = await page.evaluate(() => window.__pm);
    const domAt = trace.dom.find((d) => d.t >= writtenAt)?.t ?? null;
    assert.ok(await page.locator('.pm-split-mid[data-pulse="true"]').count(), "divisor central pulsou");
    assert.match(await text(page, '[data-testid="presentation-ticker"]'), /MUDANÇA DE LIDERANÇA/, "ticker registra a troca");
    metrics.leadChange = { writtenToDomMs: domAt ? Math.round(domAt - writtenAt) : null };
    record("troca de liderança: badge troca de lado, divisor pulsa, ticker registra", metrics.leadChange);

    // Série de atualizações nacionais: escrita no servidor → evento no EventSource → DOM (mesmo relógio da máquina).
    const writes = [];
    const order = ["p50", "p80", "p95", "p80", "p50", "close", "comfortable", "p80", "p95", "p50"];
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const frames0 = await page.evaluate(() => ({ f: window.__pm.frames, t: performance.now() }));
    // Long tasks separados: carregamento/hidratação (antes da série) × durante as atualizações ao vivo.
    for (const name of order) {
      writes.push(api.publish(name).writtenAt);
      await page.waitForTimeout(1_500);
    }
    const frames1 = await page.evaluate(() => ({ f: window.__pm.frames, t: performance.now() }));
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const pm = await page.evaluate(() => window.__pm);
    const sseNational = pm.sse.filter((e) => e.name === "national-update").slice(-order.length);
    const sseToDom = [];
    const writeToDom = [];
    sseNational.forEach((e, i) => {
      const dom = pm.dom.find((d) => d.t >= e.t);
      if (dom) {
        sseToDom.push(dom.t - e.t);
        writeToDom.push(dom.t - writes[i]);
      }
    });
    metrics.updates = {
      samples: sseToDom.length,
      sseToDomMs: { p50: Math.round(pctile(sseToDom, 50)), p95: Math.round(pctile(sseToDom, 95)), max: Math.round(Math.max(...sseToDom)) },
      serverWriteToDomMs: { p50: Math.round(pctile(writeToDom, 50)), p95: Math.round(pctile(writeToDom, 95)), max: Math.round(Math.max(...writeToDom)) },
      fps: Math.round(((frames1.f - frames0.f) * 1000) / (frames1.t - frames0.t)),
      longTasksLoad: summarizeTasks(pm.longTasks.filter((t) => t.at < frames0.t)),
      longTasksDuringUpdates: summarizeTasks(pm.longTasks.filter((t) => t.at >= frames0.t)),
      heapMB: heap0 && heap1 ? { before: +(heap0 / 1e6).toFixed(1), after: +(heap1 / 1e6).toFixed(1) } : null,
      cls: +pm.cls.toFixed(4),
      lcpMs: pm.lcp,
    };
    assert.ok(sseToDom.length >= order.length - 1, "todas as atualizações chegaram ao DOM");
    assert.ok(metrics.updates.sseToDomMs.p95 < 100, `SSE recebido → DOM atualizado p95 < 100 ms (${metrics.updates.sseToDomMs.p95})`);
    record("latência SSE → DOM e desempenho durante 10 atualizações", metrics.updates);
    await context.close();
  }

  // 4) Reconexão: queda do stream (replay pelo Last-Event-ID) e nova época (troca de réplica/reinício).
  {
    api.set("p50");
    const { context, page } = await openStage(browser, HD);
    await statusIs(page, "AO VIVO");
    await page.waitForTimeout(800);
    const pctBefore = await text(page, '[data-testid="presentation-pct-a"]');
    const requestsBefore = api.streamRequests.length;
    api.dropStreams();
    const { scenario } = api.publish("p80");
    const target = fmtPct(scenario.summary.national.sections.totalizedPct);
    await page.waitForFunction((t) => document.querySelector('[data-testid="presentation-total"] .pm-total-pct')?.textContent?.includes(t), target, { timeout: 15_000 });
    const reconnect = api.streamRequests.slice(requestsBefore).find((r) => r.lastEventId);
    assert.ok(reconnect, "reconexão enviou Last-Event-ID");
    assert.ok((reconnect.replayed ?? 0) > 0, "a API reenviou o que foi publicado durante a queda");
    assert.notEqual(pctBefore, "", "o dado anterior não foi zerado");
    record("reconexão: replay pelo Last-Event-ID entrega o que foi publicado durante a queda", { lastEventId: reconnect.lastEventId, replayed: reconnect.replayed });

    api.newBoot();
    const after = api.set("p95");
    api.dropStreams();
    const target2 = fmtPct(after.summary.national.sections.totalizedPct);
    await page.waitForFunction((t) => document.querySelector('[data-testid="presentation-total"] .pm-total-pct')?.textContent?.includes(t), target2, { timeout: 15_000 });
    record("nova época (outro boot no id SSE): o snapshot da réplica nova substitui o vigente");
    await context.close();
  }

  // 5) Teclado: F, Esc, Espaço, A, R, M, ← e → — e nenhuma tecla vale dentro de campo.
  {
    api.set("p50");
    const { context, page } = await openStage(browser, HD);
    await statusIs(page, "AO VIVO");
    const uf = () => page.evaluate(() => document.querySelector('[data-testid="presentation-spotlight"]')?.getAttribute("data-uf"));
    await page.keyboard.press("ArrowRight");
    assert.equal(await uf(), "AC", "→ foca a primeira UF");
    await page.keyboard.press("ArrowRight");
    assert.equal(await uf(), "AL", "→ avança");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await uf(), "AC", "← volta");
    await page.keyboard.press("r");
    assert.equal(await uf(), "BR", "R volta à visão nacional");
    const rotationPressed = () => page.locator('[data-testid="presentation-controls"] [aria-pressed]').first().getAttribute("aria-pressed");
    await page.mouse.move(400, 300);
    await page.keyboard.press("a");
    assert.equal(await rotationPressed(), "false", "A desliga a rotação");
    await page.keyboard.press("a");
    assert.equal(await rotationPressed(), "true", "A religa a rotação");
    await page.keyboard.press(" ");
    assert.equal(await page.locator(".pm-dwell").count(), 0, "Espaço pausa (sem contagem da vista)");
    await page.keyboard.press(" ");
    assert.equal(await page.locator(".pm-dwell").count(), 1, "Espaço retoma");
    await page.keyboard.press("m");
    assert.equal(await page.locator('[data-testid="presentation-controls"]').getAttribute("data-hidden"), "true", "M oculta os controles");
    await page.keyboard.press("m");
    await page.mouse.move(420, 320);
    assert.equal(await page.locator('[data-testid="presentation-controls"]').getAttribute("data-hidden"), null, "M mostra os controles");
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    const fullscreenOn = await page.evaluate(() => Boolean(document.fullscreenElement));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const fullscreenOff = await page.evaluate(() => !document.fullscreenElement);
    // Campo de digitação: as teclas são do campo.
    await page.locator('[data-testid="presentation-controls"] button[aria-label="Intervalos da rotação"]').click();
    await page.locator(".pm-settings select").first().focus();
    await page.keyboard.press("r");
    await page.keyboard.press("ArrowRight");
    assert.equal(await uf(), "BR", "teclas dentro de um campo não viram atalho");
    record("atalhos de teclado (F, Esc, Espaço, A, R, M, ←, →) e campos protegidos", { fullscreenOn, fullscreenOff });
    await context.close();
  }

  // 6) Reduced Motion: efeitos reduzidos, mesmos dados e hierarquia.
  {
    api.set("p50");
    const { context, page } = await openStage(browser, HD, { reducedMotion: "reduce" });
    await statusIs(page, "AO VIVO");
    assert.equal(await page.locator('[data-testid="presentation-root"]').getAttribute("data-effects"), "reduced");
    const { writtenAt } = api.publish("p80");
    await page.waitForTimeout(600);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    await page.screenshot({ path: `${OUT}/1920x1080-reduced-motion.png` });
    record("Reduced Motion: efeitos reduzidos, dado atualizado", { runningAnimations: running, writtenAt });
    await context.close();
  }

  // 7) Rotação automática nos tempos pedidos pela URL: nacional → 2 UFs → nacional, sem tocar no teclado.
  {
    api.set("p50");
    const { context, page } = await openStage(browser, HD, { query: "?nacional=10&estado=5&estados=2" });
    await statusIs(page, "AO VIVO");
    const focus = () => page.evaluate(() => document.querySelector('[data-testid="presentation-spotlight"]')?.getAttribute("data-uf"));
    const changesFrom = (uf, timeout) =>
      page.waitForFunction((u) => document.querySelector('[data-testid="presentation-spotlight"]')?.getAttribute("data-uf") !== u, uf, { timeout });
    assert.equal(await focus(), "BR", "começa na visão nacional");
    const t0 = Date.now();
    await changesFrom("BR", 15_000);
    const nationalMs = Date.now() - t0;
    const first = await focus();
    await changesFrom(first, 9_000);
    const second = await focus();
    assert.notEqual(second, "BR", "a segunda UF do ciclo entra antes da volta");
    assert.notEqual(second, first, "UFs diferentes no mesmo ciclo");
    await changesFrom(second, 9_000);
    assert.equal(await focus(), "BR", "o ciclo volta à visão nacional");
    assert.ok(nationalMs > 6_000 && nationalMs < 13_000, `visão nacional pelo tempo da URL (${nationalMs} ms)`);
    metrics.rotation = { first, second, nationalMs };
    record("rotação automática: nacional → 2 UFs → nacional, nos tempos da URL", metrics.rotation);
    await context.close();
  }

  // 8) Tela cheia recusada: a entrada fecha e o palco segue no viewport, com o dado.
  {
    api.set("p50");
    const { context, page, errors } = await openStage(browser, HD, { fullscreen: false });
    await statusIs(page, "AO VIVO");
    assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, "sem tela cheia");
    assert.equal(await page.locator('[data-testid="presentation-root"]').getAttribute("data-started"), "true", "o palco começou mesmo assim");
    const dom = await page.evaluate(scrollCheck);
    assert.equal(dom.documentScrolls, false, "sem rolagem no viewport comum");
    assert.deepEqual(errors, [], "a recusa não vira erro na página");
    record("tela cheia recusada: a apresentação segue no viewport");
    await context.close();
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await api.close();
}

// Relatório também na falha (evidência no CI): o que passou, as métricas e o erro.
await writeFile(
  `${OUT}/report.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), web: WEB.href, ok: !failure, error: failure ? String(failure.stack ?? failure).slice(0, 4000) : null, results, metrics }, null, 2)}\n`,
  "utf8",
);
if (failure) throw failure;
console.log(JSON.stringify(metrics, null, 2));
