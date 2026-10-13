// Verificação factual-safe da PWA, compartilhada pelo job de CI (build local de produção) e pelo
// production smoke. O ciclo de vida do service worker é esperado por eventos (ready,
// controllerchange, statechange) — nunca por sleep — e "sem conexão" é uma queda real de rede
// (network-switch.mjs), que também derruba o fetch do próprio service worker.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startNetworkSwitch } from "./network-switch.mjs";

const OFFLINE_HEADING = "Você está sem conexão";
const FACTUAL_SAFE_META = 'meta[name="repbrasil-offline"][content="factual-safe"]';
const LIFECYCLE_TIMEOUT_MS = 30000;
const DESKTOP = { viewport: { width: 1440, height: 1000 } };
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

/** Espera o worker ativo assumir a página; devolve escopo, script e estado observados. */
export async function waitForServiceWorkerControl(page) {
  return page.evaluate(async (timeoutMs) => {
    if (!("serviceWorker" in navigator)) throw new Error("service worker unsupported");
    const timeout = (label) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs));
    const controllerChanged = new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
    );
    const registration = await Promise.race([navigator.serviceWorker.ready, timeout("registration.ready")]);
    if (!navigator.serviceWorker.controller) await Promise.race([controllerChanged, timeout("controllerchange")]);
    const active = registration.active;
    if (active && active.state !== "activated") {
      const activated = new Promise((resolve) => {
        const check = () => {
          if (active.state !== "activated") return;
          active.removeEventListener("statechange", check);
          resolve();
        };
        active.addEventListener("statechange", check);
        check();
      });
      await Promise.race([activated, timeout("activated state")]);
    }
    return {
      scope: registration.scope,
      scriptURL: registration.active?.scriptURL ?? null,
      state: registration.active?.state ?? null,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      waiting: registration.waiting !== null,
    };
  }, LIFECYCLE_TIMEOUT_MS);
}

function assertControl(control, web, expectedRevision, label) {
  const scriptURL = new URL(`/sw.js?v=${encodeURIComponent(expectedRevision)}`, web).href;
  assert.equal(control.scope, new URL("/", web).href, `${label}: unexpected service worker scope`);
  assert.equal(control.state, "activated", `${label}: service worker is not activated`);
  assert.equal(control.scriptURL, scriptURL, `${label}: active worker is not the deployed revision`);
  assert.equal(control.controller, scriptURL, `${label}: page is not controlled by the deployed worker`);
  assert.equal(control.waiting, false, `${label}: a worker is stuck in the waiting state`);
}

async function bodyExcerpt(page) {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
}

async function assertStaticFallback(page, label) {
  if ((await page.locator(FACTUAL_SAFE_META).count()) !== 1) {
    throw new Error(`${label}: did not render the static offline fallback. Body: ${await bodyExcerpt(page)}`);
  }
  await page.getByRole("heading", { name: OFFLINE_HEADING }).waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.title(), "Sem conexão · REPBrasil", `${label}: unexpected fallback title`);
}

/** Navegação sem rede precisa receber o fallback estático do worker, nunca a página factual. */
async function expectOfflineFallback(page, network, url, label) {
  const refusedBefore = network.refused;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.ok(response, `${label}: offline navigation produced no response`);
  assert.equal(response.fromServiceWorker(), true, `${label}: offline navigation was not answered by the service worker`);
  assert.ok(network.refused > refusedBefore, `${label}: the service worker never tried the network`);
  await assertStaticFallback(page, label);
}

async function setNetwork(context, network, online) {
  network.setOffline(!online);
  await context.setOffline(!online);
}

/** Só o fallback estático, ícones e estáticos com hash podem estar em cache — nunca páginas, RSC ou API. */
async function auditCaches(page, expectedRevision) {
  const inventory = await page.evaluate(async () => {
    const result = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result[name] = (await cache.keys()).map((request) => {
        const url = new URL(request.url);
        return `${url.origin === location.origin ? "" : url.origin}${url.pathname}${url.search}`;
      });
    }
    return result;
  });
  assert.deepEqual(Object.keys(inventory), [`repbrasil-${expectedRevision}`], "only the deployed revision may own a cache");
  const entries = Object.values(inventory).flat();
  const allowed = (path) =>
    path === "/offline.html" || path === "/favicon.ico" || path.startsWith("/brand/") || path.startsWith("/_next/static/");
  const forbidden = entries.filter((path) => !allowed(path));
  assert.deepEqual(forbidden, [], `factual pages, RSC payloads or API responses were cached: ${forbidden.join(", ")}`);
  assert.ok(entries.includes("/offline.html"), "offline fallback is not precached");
  return entries;
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `${label}: page scrolls horizontally by ${overflow}px`);
}

/**
 * Simula o próximo deploy: o worker novo assume sem ficar em espera e poda o cache anterior.
 * O `controllerchange` dispara já no estado "activating" (antes do handler de activate, que poda
 * os caches); por isso a verificação espera o estado "activated" por evento.
 */
async function verifyDeployUpgrade(page, web, nextRevision) {
  const result = await page.evaluate(
    async ({ revision, timeoutMs }) => {
      const transitions = [];
      let controllerChanged = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        controllerChanged = true;
      });
      const registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(revision)}`, {
        scope: "/",
        updateViaCache: "none",
      });
      const worker = registration.installing ?? registration.waiting ?? registration.active;
      const settled = new Promise((resolve) => {
        const check = () => {
          if (worker.state === "activated" || worker.state === "redundant") resolve(worker.state);
        };
        worker.addEventListener("statechange", () => {
          transitions.push(worker.state);
          check();
        });
        check();
      });
      const state = await Promise.race([
        settled,
        new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
      ]);
      return {
        state,
        transitions,
        controllerChanged,
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        waiting: registration.waiting !== null,
        caches: await caches.keys(),
      };
    },
    { revision: nextRevision, timeoutMs: LIFECYCLE_TIMEOUT_MS },
  );
  const detail = JSON.stringify(result);
  assert.equal(result.state, "activated", `upgraded worker did not activate: ${detail}`);
  assert.equal(result.controllerChanged, true, `open pages were not handed to the upgraded worker: ${detail}`);
  assert.equal(result.controller, new URL(`/sw.js?v=${nextRevision}`, web).href, `upgraded worker did not take control: ${detail}`);
  assert.equal(result.waiting, false, `upgraded worker is stuck waiting: ${detail}`);
  assert.deepEqual(result.caches, [`repbrasil-${nextRevision}`], `previous revision cache was not pruned: ${detail}`);
}

async function desktopScenarios(browser, network, { web, outputDir, record, expectedRevision, factualPath, upgradeTo }) {
  const context = await browser.newContext(DESKTOP);
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", web).href, { waitUntil: "domcontentloaded", timeout: 60000 });
    const firstVisit = await waitForServiceWorkerControl(page);
    assertControl(firstVisit, web, expectedRevision, "first visit");
    record("PWA first visit: deployed worker activated and controlling", { scope: firstVisit.scope });

    await setNetwork(context, network, false);
    await expectOfflineFallback(page, network, new URL(`${factualPath}?pwa-check=first-visit`, web).href, "first visit");
    await page.screenshot({ path: `${outputDir}/offline-desktop.png`, fullPage: true });
    record("PWA first visit, network lost: static factual-safe fallback");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await assertStaticFallback(page, "reload without network");
    record("PWA reload without network: static factual-safe fallback");

    await setNetwork(context, network, true);
    const loaded = await context.newPage();
    await loaded.goto(new URL(factualPath, web).href, { waitUntil: "domcontentloaded", timeout: 60000 });
    assertControl(await waitForServiceWorkerControl(loaded), web, expectedRevision, "second visit");
    await setNetwork(context, network, false);
    await loaded.getByTestId("offline-notice").waitFor({ state: "visible", timeout: 10000 });
    record("Loaded factual page announces the lost connection");
    await expectOfflineFallback(loaded, network, new URL("/pesquisas?pwa-check=second-visit", web).href, "second visit");
    record("PWA second visit (warm cache), network lost: static factual-safe fallback");

    await setNetwork(context, network, true);
    const online = await context.newPage();
    await online.goto(new URL(factualPath, web).href, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(await online.locator(FACTUAL_SAFE_META).count(), 0, "online navigation must reach the live page");
    assert.equal(await online.getByTestId("offline-notice").count(), 0, "online page must not show the offline notice");
    const entries = await auditCaches(online, expectedRevision);
    record("PWA cache holds no factual page, RSC or API response", { entries: entries.length });

    if (upgradeTo) {
      await verifyDeployUpgrade(online, web, upgradeTo);
      record("PWA next deploy: new worker takes control at once and prunes the previous cache");
    }
  } finally {
    await context.close();
  }
}

async function mobileScenario(browser, network, { web, outputDir, record, expectedRevision }) {
  const context = await browser.newContext(MOBILE);
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", web).href, { waitUntil: "domcontentloaded", timeout: 60000 });
    assertControl(await waitForServiceWorkerControl(page), web, expectedRevision, "mobile first visit");
    await setNetwork(context, network, false);
    await expectOfflineFallback(page, network, new URL("/parlamento?pwa-check=mobile", web).href, "mobile");
    await assertNoHorizontalOverflow(page, "mobile offline fallback");
    await page.screenshot({ path: `${outputDir}/offline-mobile.png`, fullPage: true });
    record("PWA mobile viewport, network lost: static fallback without horizontal scroll");
  } finally {
    await setNetwork(context, network, true).catch(() => undefined);
    await context.close();
  }
}

/**
 * Cenários: primeira visita → sem rede; recarga sem rede; aviso numa página factual já carregada;
 * segunda visita (cache quente) → sem rede; inventário do cache; viewport móvel; (opcional) deploy
 * seguinte. O navegador é próprio, com todo o tráfego passando pelo interruptor de rede.
 */
export async function verifyFactualSafeOffline(options) {
  assert.ok(options.expectedRevision, "expected revision is required");
  const network = await startNetworkSwitch();
  const browser = await chromium.launch({ headless: true, proxy: { server: network.proxyServer } });
  try {
    await desktopScenarios(browser, network, options);
    await mobileScenario(browser, network, options);
  } finally {
    await browser.close();
    await network.close();
  }
}
