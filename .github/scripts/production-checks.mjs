// Verificações de produção sem efeitos colaterais relevantes: contratos anônimos de auth/API,
// lake arquivado, páginas com guarda de console/rede e exports validados pelo conteúdo.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const INVALID_KEY = `rep_live_${"0".repeat(43)}`;

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setCookie(response, name) {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`)) ?? "";
}

async function expectStatus(response, status, label) {
  if (response.status !== status) {
    const body = await response.text().catch(() => "");
    assert.fail(`${label}: expected HTTP ${status}, got ${response.status} ${body.slice(0, 200)}`);
  }
}

/**
 * Contratos anônimos de conta, superadmin e API comercial. Efeito colateral único: o início do
 * login Google grava um desafio de `state` que expira em 10 minutos (sem e-mail, sem sessão).
 */
export async function verifyAnonymousContracts({ web, api, record }) {
  const call = (path, init = {}) => fetch(`${api}${path}`, { redirect: "manual", cache: "no-store", ...init });

  await expectStatus(await call("/api/v1/account/me"), 401, "account/me without session");
  await expectStatus(await call("/api/v1/admin/me"), 401, "admin/me without session");
  await expectStatus(await call("/api/v1/commercial/ping"), 401, "commercial ping without key");
  await expectStatus(await call("/api/v1/commercial/ping", { headers: { "X-Api-Key": INVALID_KEY } }), 401, "commercial ping with an unknown key");
  record("Anonymous account, superadmin and commercial API contracts (401)");

  const consume = await call("/api/v1/auth/magic-link/consume?token=production-smoke-without-correlation");
  await expectStatus(consume, 302, "magic link without browser correlation");
  assert.equal(consume.headers.get("location"), `${web}/entrar?erro=link-invalido`);
  const callback = await call("/api/v1/auth/google/callback?code=production-smoke&state=production-smoke");
  await expectStatus(callback, 302, "Google callback without browser correlation");
  assert.equal(callback.headers.get("location"), `${web}/entrar?erro=estado-invalido`);
  record("Magic link and Google callback fail closed without the initiating browser");

  const start = await call("/api/v1/auth/google/start?returnTo=/conta");
  await expectStatus(start, 302, "Google start");
  const authorize = new URL(start.headers.get("location") ?? "about:blank");
  assert.equal(`${authorize.origin}${authorize.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
  const state = authorize.searchParams.get("state") ?? "";
  assert.ok(state.length >= 32, "Google start must carry a random state");
  const correlation = setCookie(start, "repbrasil_google_state").toLowerCase();
  for (const attribute of ["httponly", "secure", "samesite=lax", "path=/api/v1/auth/google"]) {
    assert.ok(correlation.includes(attribute), `Google correlation cookie lacks ${attribute}`);
  }
  assert.ok(correlation.startsWith(`repbrasil_google_state=${state.toLowerCase()}`), "correlation cookie must hold the issued state");
  record("Google OAuth start: random state bound to a HttpOnly/Secure/SameSite=Lax browser cookie");
}

// Seções do Ceará cujos votos foram podados do PostGIS: a API só os obtém do worker do lake.
const ARCHIVED_SECTIONS = [
  [2022, "/api/v1/elections/2022/1/states/CE/municipalities/13897/zones/1/sections/33/results"],
  [2024, "/api/v1/elections/2024/1/states/CE/municipalities/13897/zones/1/sections/33/results"],
];

async function answeredSection(url, attemptsLeft, intervalMs) {
  let observed;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return response.json();
    observed = `HTTP ${response.status}`;
  } catch (error) {
    observed = error.message;
  }
  if (attemptsLeft <= 1) assert.fail(`${url} did not answer: ${observed}`);
  await pause(intervalMs);
  return answeredSection(url, attemptsLeft - 1, intervalMs);
}

/**
 * Votos de seção arquivada (2022 e 2024) servidos pelo RPC privado do lake. O worker é implantado
 * separadamente da API; enquanto um lado ainda não terminou, a leitura responde 503 "indisponível"
 * (fail-closed), por isso a verificação tolera alguns minutos antes de falhar.
 */
export async function verifyArchivedSections({ api, record, attempts = 60, intervalMs = 5000 }) {
  await Promise.all(
    ARCHIVED_SECTIONS.map(async ([year, path]) => {
      const body = await answeredSection(`${api}${path}`, attempts, intervalMs);
      assert.equal(body.election?.year, year, `${path} must answer for ${year}`);
      assert.equal(body.status, "available", `${path} must be available`);
      assert.ok(Array.isArray(body.votes) && body.votes.length > 0, `${path} must carry the archived votes`);
      // O rótulo do log usa só a constante local: nada vindo da resposta remota chega ao console.
      record(`Archived ${year} section votes served through the private lake RPC`, { votes: body.votes.length });
    }),
  );
}

function expectedConsoleError(message) {
  const text = message.text();
  const url = message.location()?.url ?? "";
  return text.includes("status of 401") && url.includes("/api/v1/account/me");
}

/** Abre a página e falha em 5xx, erro de página ou erro de console inesperado. */
export async function visitGuarded(context, url, ready) {
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !expectedConsoleError(message)) problems.push(`console: ${message.text()}`);
  });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.ok(response?.ok(), `${url} answered ${response?.status()}`);
    await ready(page);
    const rendered = await page.getByText(/Não foi possível/).count();
    assert.equal(rendered, 0, `${url} rendered an application data error`);
  } catch (error) {
    await page.close();
    const observed = problems.length > 0 ? ` | observed: ${problems.join(" | ")}` : "";
    throw new Error(`${url}: ${error.message}${observed}`, { cause: error });
  }
  return { page, problems };
}

export function assertNoProblems(problems, label) {
  assert.deepEqual(problems, [], `${label}: ${problems.join(" | ")}`);
}

function zipEntries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "XLSX without a ZIP end-of-central-directory record");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "corrupt ZIP central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const data = buffer.subarray(start, start + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const MUNICIPALITY_COMPARISON = "/comparar?tipo=municipio&uf=CE&itens=2304400,2312908&periodo=2022";
const COMPARISON_TITLE = "REPBrasil — Comparação de municípios";
const EXPORTS = [["csv", "CSV"], ["xlsx", "XLSX"], ["pdf", "PDF"], ["png", "PNG"]];

async function pollsReady(page) {
  await page.getByText("Carregando fontes oficiais…").waitFor({ state: "hidden", timeout: 60000 });
  await page.locator('[data-testid="poll-card"], [data-testid="polls-empty"]').first().waitFor({ timeout: 30000 });
  await page.locator('[data-testid="live-snapshot"], [data-testid="live-empty"]').first().waitFor({ timeout: 30000 });
}

async function comparisonReady(page) {
  await page.getByTestId("export-actions").waitFor({ state: "visible", timeout: 60000 });
}

// O Next.js também renderiza um `role="alert"` vazio (anunciador de rotas, em shadow DOM): a
// verificação mira só o aviso de recusa, pelo texto que o explica.
async function signInRefusalReady(page) {
  await page.getByRole("alert").filter({ hasText: /navegador diferente/ }).waitFor({ state: "visible", timeout: 30000 });
}

const GUARDED_TARGETS = [
  ["pesquisas", "/pesquisas", pollsReady],
  ["comparar-municipios", MUNICIPALITY_COMPARISON, comparisonReady],
  ["entrar-link-invalido", "/entrar?erro=link-invalido", signInRefusalReady],
];

async function verifyGuardedPage(context, { web, outputDir, record, profile }, [slug, path, ready]) {
  const { page, problems } = await visitGuarded(context, `${web}${path}`, ready);
  try {
    if (profile === "mobile") {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${path} scrolls horizontally on mobile by ${overflow}px`);
    }
    await page.screenshot({ path: `${outputDir}/${slug}-${profile}.png`, fullPage: true });
    assertNoProblems(problems, `${path} (${profile})`);
    record(`${path} ${profile}: rendered without 5xx, page or console errors`);
  } finally {
    await page.close();
  }
}

async function verifyGuardedProfile(browser, profile, options, settings) {
  const context = await browser.newContext(options);
  try {
    await Promise.all(GUARDED_TARGETS.map((target) => verifyGuardedPage(context, { ...settings, profile }, target)));
  } finally {
    await context.close();
  }
}

/** Páginas públicas sem 5xx, erro de página ou erro de console inesperado, em desktop e celular. */
export async function verifyGuardedPages({ browser, web, outputDir, record }) {
  const settings = { web, outputDir, record };
  await verifyGuardedProfile(browser, "desktop", { viewport: { width: 1440, height: 1000 } }, settings);
  await verifyGuardedProfile(browser, "mobile", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, settings);
}

// Um download por vez na mesma página: cada clique espera o seu próprio evento de download.
async function downloadInOrder(page, formats, { outputDir, record }) {
  if (formats.length === 0) return;
  const [[format, label], ...rest] = formats;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByTestId("export-actions").getByRole("button", { name: label, exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), `repbrasil-municipios-2022.${format}`);
  const path = `${outputDir}/export-municipios.${format}`;
  await download.saveAs(path);
  await assertExport(format, path, { title: COMPARISON_TITLE, url: page.url() });
  record(`Comparator export ${label}: valid file with title, context and reproducible URL`);
  await downloadInOrder(page, rest, { outputDir, record });
}

/** Comparador de municípios: CSV, XLSX, PDF e PNG baixados e validados pelo conteúdo. */
export async function verifyComparatorExports({ browser, web, outputDir, record }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  try {
    const { page, problems } = await visitGuarded(context, `${web}${MUNICIPALITY_COMPARISON}`, comparisonReady);
    await downloadInOrder(page, EXPORTS, { outputDir, record });
    assertNoProblems(problems, "comparator exports");
  } finally {
    await context.close();
  }
}

/** Valida o arquivo pelo conteúdo: estrutura, contexto obrigatório e dados não vazios. */
export async function assertExport(format, path, { title, url }) {
  const bytes = await readFile(path);
  assert.ok(bytes.length > 200, `${format} export is suspiciously small (${bytes.length} bytes)`);
  if (format === "csv") {
    const text = bytes.toString("utf8");
    assert.ok(text.startsWith("﻿"), "CSV must start with a UTF-8 BOM");
    const lines = text.slice(1).split("\r\n");
    assert.equal(lines[0], title, "CSV first line must be the report title");
    assert.ok(lines.includes(`URL reproduzível;${url}`), "CSV must carry the reproducible URL");
    assert.ok(lines.some((line) => line.startsWith("Fonte;")), "CSV must cite sources");
    assert.ok(lines.some((line) => line.startsWith("Metodologia;")), "CSV must carry methodology");
  } else if (format === "xlsx") {
    const entries = zipEntries(bytes);
    for (const name of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]) {
      assert.ok(entries.has(name), `XLSX lacks ${name}`);
    }
    const sheet = entries.get("xl/worksheets/sheet1.xml").toString("utf8");
    assert.ok((sheet.match(/<row /g) ?? []).length >= 4, "XLSX sheet has no data rows");
    assert.ok(sheet.includes(title.replaceAll("&", "&amp;")), "XLSX must carry the report title");
  } else if (format === "pdf") {
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-", "PDF header");
    assert.ok(bytes.subarray(-64).toString("latin1").includes("%%EOF"), "PDF trailer");
    assert.ok(/\/Type\s*\/Page\b/.test(bytes.toString("latin1")), "PDF has no page");
  } else if (format === "png") {
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.ok(width >= 600 && height >= 200, `PNG too small (${width}x${height})`);
  }
}
