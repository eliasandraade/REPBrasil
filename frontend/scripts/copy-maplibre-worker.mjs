#!/usr/bin/env node
/**
 * MapLibre 6 (ESM) resolve o worker relativo ao próprio módulo
 * (new URL("./maplibre-gl-worker.mjs", import.meta.url)), caminho que o
 * bundler do Next não publica. Copiamos o worker da versão INSTALADA para
 * /public/maplibre/worker-<versão>.mjs e o app chama setWorkerUrl().
 * Roda em predev/prebuild; o arquivo gerado não é versionado.
 */
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(await readFile(pkgPath, "utf8"));
const src = join(dirname(pkgPath), "dist", "maplibre-gl-worker.mjs");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

await mkdir(outDir, { recursive: true });
for (const f of await readdir(outDir)) if (f.startsWith("worker-")) await rm(join(outDir, f));
await copyFile(src, join(outDir, `worker-${version}.mjs`));
console.log(`maplibre worker ${version} → public/maplibre/`);
