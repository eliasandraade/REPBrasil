#!/usr/bin/env node
/**
 * Teste de carga do stream SSE da apuração ao vivo (sem dependências; Node 22).
 *
 * Abre N conexões simultâneas em /stream, conta quantas receberam o snapshot inicial e os eventos seguintes, mede o
 * tempo até o primeiro byte e compara o contador PÚBLICO de requisições ao TSE (/health → tseRequests) antes e depois:
 * o número de visitantes não pode aumentar as requisições ao TSE (condição arquitetural).
 *
 * Uso (API local em modo replay — nunca contra produção sem combinar):
 *   ELECTION_SSE_MAX_PER_IP=20000 (na API, porque todas as conexões saem do mesmo IP)
 *   node scripts/load/live-election-sse.mjs --api http://localhost:5320 --clients 1000 --seconds 60
 *   node scripts/load/live-election-sse.mjs --api http://localhost:5320 --clients 5000 --seconds 60
 *   node scripts/load/live-election-sse.mjs --api http://localhost:5320 --clients 10000 --seconds 90 --ramp 20
 */
import { setTimeout as sleep } from "node:timers/promises";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []),
);
const API = (args.api ?? "http://localhost:5320").replace(/\/+$/, "");
const CLIENTS = Number(args.clients ?? 1000);
const SECONDS = Number(args.seconds ?? 60);
const RAMP = Number(args.ramp ?? 10); // segundos para abrir todas as conexões
const BASE = `${API}/api/v1/elections/2026/president/second-round`;

// O fetch global do Node (undici) não limita conexões por origem; o corpo SSE tem heartbeat a cada 15 s.

async function health() {
  const res = await fetch(`${BASE}/health`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`/health respondeu ${res.status}`);
  return res.json();
}

const stats = { opened: 0, snapshot: 0, events: 0, errors: 0, rejected: 0, ttfb: [], byType: new Map() };
const controllers = [];

async function client(i) {
  const controller = new AbortController();
  controllers.push(controller);
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}/stream`, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
    if (res.status === 429) {
      stats.rejected++;
      return;
    }
    if (!res.ok || !res.body) {
      stats.errors++;
      return;
    }
    stats.opened++;
    const decoder = new TextDecoder();
    let buffer = "";
    let first = true;
    for await (const chunk of res.body) {
      if (first) {
        stats.ttfb.push(performance.now() - started);
        first = false;
      }
      buffer += decoder.decode(chunk, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const type = /^event: (.+)$/m.exec(frame)?.[1];
        if (!type) continue;
        stats.byType.set(type, (stats.byType.get(type) ?? 0) + 1);
        if (type === "snapshot") stats.snapshot++;
        else stats.events++;
      }
    }
  } catch (error) {
    if (error?.name !== "AbortError") stats.errors++;
  }
  void i;
}

/** Valor vindo da rede vai para o log sem quebras de linha nem caracteres de controle. */
const clean = (value) => String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 80);

const before = await health();
console.log(`API ${clean(API)} · modo ${clean(before.mode)} · fase ${clean(before.phase)} · tseRequests=${Number(before.tseRequests)}`);
console.log(`Abrindo ${CLIENTS} conexões em ${RAMP}s e mantendo por ${SECONDS}s…`);
const t0 = performance.now();
const runs = [];
for (let i = 0; i < CLIENTS; i++) {
  runs.push(client(i));
  if (RAMP > 0 && i % 50 === 49) await sleep((RAMP * 1000 * 50) / CLIENTS);
}
await sleep(SECONDS * 1000);
const after = await health();
for (const c of controllers) c.abort();
await Promise.allSettled(runs);
const elapsed = (performance.now() - t0) / 1000;

const ttfb = stats.ttfb.sort((a, b) => a - b);
const pct = (p) => (ttfb.length ? ttfb[Math.min(ttfb.length - 1, Math.floor((p / 100) * ttfb.length))].toFixed(0) : "—");
const tseDelta = after.tseRequests - before.tseRequests;
console.log("");
console.log(`Conexões abertas: ${stats.opened}/${CLIENTS} · recusadas (429): ${stats.rejected} · erros: ${stats.errors}`);
console.log(`Snapshot inicial recebido: ${stats.snapshot} · eventos seguintes: ${stats.events}`);
console.log(`Tempo até o 1º byte (ms): p50 ${pct(50)} · p95 ${pct(95)} · p99 ${pct(99)}`);
console.log(`Eventos por tipo: ${[...stats.byType].map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`Requisições ao TSE durante o teste: ${tseDelta} em ${elapsed.toFixed(0)}s (${(tseDelta / elapsed).toFixed(2)}/s) — independe do número de clientes.`);
const ok = stats.opened === CLIENTS && stats.snapshot === CLIENTS && stats.errors === 0;
console.log(ok ? "RESULTADO: OK" : "RESULTADO: FALHOU");
process.exit(ok ? 0 : 1);
