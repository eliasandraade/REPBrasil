// CI: verifica a PWA factual-safe contra o build de produção local (next start) desta revisão,
// antes de qualquer merge. Inclui o cenário do próximo deploy (worker novo assume e poda o cache).
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { verifyFactualSafeOffline } from "./pwa-offline-verify.mjs";

const WEB = process.env.REPBRASIL_WEB_URL ?? "http://127.0.0.1:3100";
const EXPECTED_REVISION = process.env.REPBRASIL_EXPECTED_SHA ?? "";
const outputDir = "artifacts/pwa-local";
const results = [];

function record(name, details = {}) {
  results.push({ name, ok: true, ...details });
  console.log(`✓ ${name}`);
}

assert.ok(EXPECTED_REVISION, "REPBRASIL_EXPECTED_SHA must name the revision the local build was made with");
await mkdir(outputDir, { recursive: true });

await verifyFactualSafeOffline({
  web: WEB,
  outputDir,
  record,
  expectedRevision: EXPECTED_REVISION,
  factualPath: "/dados",
  upgradeTo: `${EXPECTED_REVISION}-next`,
});

await writeFile(
  `${outputDir}/report.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), web: WEB, revision: EXPECTED_REVISION, results }, null, 2)}\n`,
  "utf8",
);
console.log(`PWA offline verification passed with ${results.length} checks.`);
