#!/usr/bin/env node
/**
 * E2E da apuração ao vivo (Playwright + replay sintético; nenhuma requisição ao TSE).
 *
 * Pré-requisitos (stack local):
 *   API:   ELECTION_LIVE_ENABLED=true ELECTION_DATA_MODE=replay ELECTION_REPLAY_SPEED=30 ELECTION_REPLAY_OUTAGE=30-36
 *          (sem ConnectionStrings__Postgres o estado fica em memória) na porta de REPBRASIL_API_URL
 *   Front: NEXT_PUBLIC_API_URL=<api> em REPBRASIL_WEB_URL
 * Uso: REPBRASIL_WEB_URL=http://localhost:3100 REPBRASIL_API_URL=http://localhost:5320 node .github/scripts/live-election-e2e.mjs
 *
 * Roteiro (numeração do pedido): 1 abrir · 2 snapshot · 3 placar · 4 SSE chega · 5 votos mudam · 6 mapa muda ·
 * 7 filtro de UF · 8 município · 12 fonte offline · 13 último snapshot mantido · 14 fonte recupera · 9 troca de liderança ·
 * 10/11 md=e e banner · 15/16 tf=s e resultado final (sem "AO VIVO"). Uma única página aberta o tempo todo: as mudanças
 * chegam pelo stream, nunca por recarga.
 */
import { chromium } from "playwright";

const WEB = (process.env.REPBRASIL_WEB_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const API = (process.env.REPBRASIL_API_URL ?? "http://localhost:5320").replace(/\/+$/, "");
const PAGE = `${WEB}/apuracao/2026/presidente/segundo-turno`;
const SUMMARY = `${API}/api/v1/elections/2026/president/second-round/summary`;
const results = [];

function step(id, name, ok, detail = "") {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api() {
  const res = await fetch(SUMMARY, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  return res.json();
}

async function until(predicate, timeoutMs, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await predicate();
      if (last) return last;
    } catch {
      // continua tentando
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`tempo esgotado: ${label}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await context.newPage();
// O topo tem variantes para celular e desktop (uma escondida por CSS): sempre o elemento visível.
const visible = (id) => page.locator(`[data-testid="${id}"]:visible`).first();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
let failed = false;

try {
  // 1, 2, 3
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  step(1, "abrir a página", (await page.title()).includes("Apuração Presidente 2026"));
  await visible("live-hero").waitFor({ timeout: 20_000 });
  // O HTML pode vir do cache curto (ISR de 5 s) de uma sessão anterior do replay; a página relê o snapshot ao hidratar.
  await until(async () => !((await visible("live-hero").textContent()) ?? "").includes("RESULTADO FINAL"), 30_000, "snapshot atual após hidratar");
  const badge = (await visible("live-mode-badge").textContent()) ?? "";
  step(2, "snapshot carregado (modo replay sinalizado)", /REPLAY/i.test(badge), badge.trim());
  const hero = visible("live-hero");
  step(3, "placar visível", (await hero.textContent())?.includes("CANDIDATA A") === true && (await hero.textContent())?.includes("CANDIDATO B") === true);

  // 4, 5: sem recarregar, o percentual de seções e os votos mudam pelo SSE
  await until(async () => (await api()).meta.phase === "LIVE", 120_000, "fase LIVE na API");
  const sections0 = await visible("live-sections-pct").textContent();
  const votes0 = await hero.textContent();
  const sections1 = await until(async () => {
    const now = await visible("live-sections-pct").textContent();
    return now !== sections0 ? now : null;
  }, 60_000, "percentual de seções mudar");
  step(4, "evento SSE recebido (seções mudaram sem recarga)", true, `${sections0?.trim()} → ${sections1?.trim()}`);
  const votes1 = await until(async () => ((await hero.textContent()) !== votes0 ? await hero.textContent() : null), 60_000, "votos mudarem");
  step(5, "votos atualizados", votes1 !== votes0);

  // 6: o mapa reflete a liderança por UF (aria-label muda conforme os dados chegam)
  const map = page.getByTestId("live-brazil-map");
  await map.scrollIntoViewIfNeeded();
  const label = async () => map.locator('[aria-label*="BA"], [aria-label*="Bahia"]').first().getAttribute("aria-label");
  const map0 = await label();
  const map1 = await until(async () => ((await label()) !== map0 ? await label() : null), 90_000, "mapa da UF mudar");
  step(6, "mapa atualizado", map1 !== map0, `${map0?.slice(0, 60)} → ${map1?.slice(0, 60)}`);

  // 7: filtro de região na tabela de UFs
  const table = page.getByTestId("live-state-table");
  await table.scrollIntoViewIfNeeded();
  await table.locator("select").first().selectOption({ label: "Nordeste" });
  const rows = await table.getByTestId("live-state-row").count();
  step(7, "filtro de UF (região Nordeste)", rows === 9, `${rows} linhas`);
  await table.locator("select").first().selectOption({ index: 0 });

  // 8: explorador municipal → abrir um município
  // Seções abaixo da dobra montam sob demanda (IntersectionObserver): rola até o espaço reservado da seção.
  await page.getByTestId("live-lazy-explorer").scrollIntoViewIfNeeded();
  const explorer = page.getByTestId("live-municipality-explorer");
  await explorer.waitFor({ timeout: 30_000 });
  await explorer.scrollIntoViewIfNeeded();
  await explorer.locator("select").first().selectOption("CE");
  await explorer.getByPlaceholder("Digite o nome (com ou sem acento)").fill("fortaleza");
  const item = explorer.getByTestId("live-municipality-list").getByText("Fortaleza", { exact: false }).first();
  await item.waitFor({ timeout: 20_000 });
  await item.click();
  const detail = await until(async () => {
    const text = await explorer.textContent();
    return text?.includes("Zonas") || text?.includes("zonas") ? text : null;
  }, 20_000, "detalhe do município");
  step(8, "abrir município", !!detail);

  // 12, 13, 14: falha simulada da fonte (quadros ELECTION_REPLAY_OUTAGE) e recuperação
  const stale = page.getByTestId("live-stale-notice");
  await stale.waitFor({ timeout: 180_000 });
  const staleText = (await stale.textContent()) ?? "";
  step(12, "fonte oficial fora do ar sinalizada", /Aguardando nova atualização da fonte/.test(staleText), staleText.trim().slice(0, 90));
  const heroDuring = (await hero.textContent()) ?? "";
  step(13, "último snapshot mantido (sem zerar)", /\d{1,3}(\.\d{3})+ votos/.test(heroDuring) && !/0,00%/.test(heroDuring));
  await stale.waitFor({ state: "detached", timeout: 120_000 });
  step(14, "fonte recuperada", true);

  // 9: troca de liderança registrada na linha do tempo
  await until(async () => (await api()).data.events.some((e) => e.type === "lead-change"), 240_000, "troca de liderança na API");
  const milestones = page.getByTestId("live-milestones");
  await milestones.scrollIntoViewIfNeeded();
  await until(async () => ((await milestones.textContent()) ?? "").includes("Mudança de liderança"), 30_000, "marco de troca de liderança na página");
  step(9, "troca de liderança exibida", true);

  // 10, 11: md=e → banner
  await until(async () => (await api()).data.official.mathematicallyDefinedFlag === "e", 300_000, "md=e na API");
  const banner = page.getByTestId("live-math-defined-banner");
  await banner.waitFor({ timeout: 30_000 });
  const bannerText = (await banner.textContent()) ?? "";
  step(10, "md=e recebido", true);
  step(
    11,
    "banner de eleição matematicamente definida",
    bannerText.includes("ELEIÇÃO MATEMATICAMENTE DEFINIDA") &&
      bannerText.includes("Com os votos já totalizados, não há mais votos possíveis em quantidade suficiente para alterar a liderança.") &&
      bannerText.includes("Resultado matematicamente definido segundo os dados oficiais do TSE."),
  );

  // 15, 16: totalização final
  await until(async () => (await api()).data.official.finalTotalization === true, 300_000, "tf=s na API");
  await page.getByTestId("live-final-banner").waitFor({ timeout: 30_000 });
  step(15, "tf=s recebido", true);
  const pill = (await visible("live-status-pill").textContent()) ?? "";
  step(16, "página em RESULTADO FINAL (sem AO VIVO)", pill.includes("RESULTADO FINAL") && !(await hero.textContent())?.includes("AO VIVO"), pill.trim());
} catch (error) {
  failed = true;
  console.error("ERRO:", error.message);
  await page.screenshot({ path: "live-election-e2e-failure.png", fullPage: false }).catch(() => {});
} finally {
  await browser.close();
}

if (consoleErrors.length) console.log(`Erros no console do navegador: ${consoleErrors.length}\n  ${consoleErrors.slice(0, 5).join("\n  ")}`);
const ok = !failed && results.length === 16 && results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/16 passos OK`);
process.exit(ok ? 0 : 1);
