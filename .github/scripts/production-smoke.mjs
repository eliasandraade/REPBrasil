import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const WEB = process.env.REPBRASIL_WEB_URL ?? "https://www.apprepbrasil.com.br";
const API = process.env.REPBRASIL_API_URL ?? "https://api.apprepbrasil.com.br";
const outputDir = "artifacts/production-smoke";
const results = [];

const apiChecks = [
  ["members API", "/api/v1/parliament/members?uf=CE"],
  ["activities API", "/api/v1/parliament/activities?uf=CE&limit=5"],
  ["amendments API", "/api/v1/parliament/amendments?uf=CE&limit=5"],
  ["amendment map API", "/api/v1/parliament/amendments/map?uf=CE"],
];
const webChecks = ["/parlamento", "/dados", "/offline", "/sw.js"];
const captureTargets = [["parlamento", "/parlamento"], ["dados", "/dados"]];

await mkdir(outputDir, { recursive: true });

function record(name, details = {}) {
  results.push({ name, ok: true, ...details });
  console.log(`✓ ${name}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchOk(url, options = {}, attempt = 1) {
  let failure;
  try {
    const response = await fetch(url, { redirect: "manual", ...options });
    if (response.ok) return response;
    failure = new Error(`${url} returned ${response.status}`);
  } catch (error) {
    failure = error;
  }

  if (attempt >= 20) throw failure ?? new Error(`Unable to reach ${url}`);
  await delay(5000);
  return fetchOk(url, options, attempt + 1);
}

async function verifyApi([name, path]) {
  const response = await fetchOk(`${API}${path}`);
  const body = await response.json();
  assert.ok(Array.isArray(body), `${name} must return a JSON array`);
  record(name, { status: response.status, rows: body.length });
}

async function verifyWebPath(path) {
  const response = await fetchOk(`${WEB}${path}`);
  record(`${path} HTTP`, { status: response.status });
}

async function capturePage(context, slug, path, profile, waitMs) {
  const page = await context.newPage();
  try {
    const response = await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.ok(response?.ok(), `${path} ${profile} navigation failed`);
    await page.waitForTimeout(waitMs);
    await page.screenshot({ path: `${outputDir}/${slug}-${profile}.png`, fullPage: true });
    record(`${path} ${profile} screenshot`);
  } finally {
    await page.close();
  }
}

await Promise.all(apiChecks.map(verifyApi));
await Promise.all(webChecks.map(verifyWebPath));

const sw = await fetchOk(`${WEB}/sw.js`);
const cacheControl = sw.headers.get("cache-control") ?? "";
assert.match(cacheControl, /no-store/i, "service worker must not be served from a stale cache");
assert.equal(sw.headers.get("service-worker-allowed"), "/");
record("service worker headers", { cacheControl });

const parliamentPage = await fetchOk(`${WEB}/parlamento`);
assert.equal(parliamentPage.headers.get("x-content-type-options"), "nosniff");
assert.equal(parliamentPage.headers.get("x-frame-options"), "SAMEORIGIN");
record("browser security headers");

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await Promise.all(captureTargets.map(([slug, path]) => capturePage(desktop, slug, path, "desktop", 3000)));

  const offlinePage = await desktop.newPage();
  try {
    await offlinePage.goto(`${WEB}/dados`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const serviceWorkerScope = await offlinePage.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("Service worker unsupported");
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });
    assert.ok(serviceWorkerScope.startsWith(WEB), `unexpected service worker scope: ${serviceWorkerScope}`);
    await offlinePage.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await desktop.setOffline(true);
    await offlinePage.goto(`${WEB}/dados?production-offline-smoke=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await offlinePage.getByText("Você está sem conexão", { exact: true }).waitFor({ timeout: 15000 });
    await offlinePage.screenshot({ path: `${outputDir}/offline-desktop.png`, fullPage: true });
    record("PWA factual-safe offline fallback", { scope: serviceWorkerScope });
  } finally {
    await offlinePage.close();
    await desktop.close();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await Promise.all(captureTargets.map(([slug, path]) => capturePage(mobile, slug, path, "mobile", 2500)));
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  `${outputDir}/report.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), web: WEB, api: API, results }, null, 2)}\n`,
  "utf8",
);

console.log(`Production smoke passed with ${results.length} checks.`);
