import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const WEB = process.env.REPBRASIL_WEB_URL ?? "https://www.apprepbrasil.com.br";
const API = process.env.REPBRASIL_API_URL ?? "https://api.apprepbrasil.com.br";
const outputDir = "artifacts/production-smoke";
const results = [];

await mkdir(outputDir, { recursive: true });

function record(name, details = {}) {
  results.push({ name, ok: true, ...details });
  console.log(`✓ ${name}`);
}

async function fetchOk(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual", ...options });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw lastError ?? new Error(`Unable to reach ${url}`);
}

for (const [name, path] of [
  ["members API", "/api/v1/parliament/members?uf=CE"],
  ["activities API", "/api/v1/parliament/activities?uf=CE&limit=5"],
  ["amendments API", "/api/v1/parliament/amendments?uf=CE&limit=5"],
  ["amendment map API", "/api/v1/parliament/amendments/map?uf=CE"],
]) {
  const response = await fetchOk(`${API}${path}`);
  const body = await response.json();
  assert.ok(Array.isArray(body), `${name} must return a JSON array`);
  record(name, { status: response.status, rows: body.length });
}

for (const path of ["/parlamento", "/dados", "/offline", "/sw.js"]) {
  const response = await fetchOk(`${WEB}${path}`);
  record(`${path} HTTP`, { status: response.status });
}

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
  const desktopPage = await desktop.newPage();

  for (const [slug, path] of [["parlamento", "/parlamento"], ["dados", "/dados"]]) {
    const response = await desktopPage.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.ok(response?.ok(), `${path} navigation failed`);
    await desktopPage.waitForTimeout(3000);
    await desktopPage.screenshot({ path: `${outputDir}/${slug}-desktop.png`, fullPage: true });
    record(`${path} desktop screenshot`);
  }

  await desktopPage.goto(`${WEB}/dados`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const serviceWorkerScope = await desktopPage.evaluate(async () => {
    assertServiceWorkerSupport();
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;

    function assertServiceWorkerSupport() {
      if (!("serviceWorker" in navigator)) throw new Error("Service worker unsupported");
    }
  });
  assert.ok(serviceWorkerScope.startsWith(WEB), `unexpected service worker scope: ${serviceWorkerScope}`);
  await desktopPage.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await desktop.setOffline(true);
  await desktopPage.goto(`${WEB}/dados?production-offline-smoke=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await desktopPage.getByText("Você está sem conexão", { exact: true }).waitFor({ timeout: 15000 });
  await desktopPage.screenshot({ path: `${outputDir}/offline-desktop.png`, fullPage: true });
  record("PWA factual-safe offline fallback", { scope: serviceWorkerScope });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  for (const [slug, path] of [["parlamento", "/parlamento"], ["dados", "/dados"]]) {
    const response = await mobilePage.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.ok(response?.ok(), `${path} mobile navigation failed`);
    await mobilePage.waitForTimeout(2500);
    await mobilePage.screenshot({ path: `${outputDir}/${slug}-mobile.png`, fullPage: true });
    record(`${path} mobile screenshot`);
  }
  await mobile.close();
} finally {
  await browser.close();
}

await writeFile(
  `${outputDir}/report.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), web: WEB, api: API, results }, null, 2)}\n`,
  "utf8",
);

console.log(`Production smoke passed with ${results.length} checks.`);
