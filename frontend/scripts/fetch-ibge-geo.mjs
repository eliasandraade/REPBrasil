#!/usr/bin/env node
/**
 * Gera as malhas territoriais do REPBrasil a partir da API oficial do IBGE (v3).
 *
 *   node scripts/fetch-ibge-geo.mjs
 *
 * Saída em public/geo/ (servida estaticamente e carregada pelo MapLibre sob
 * demanda, uma UF por vez; nada disso entra no bundle JS):
 *   - br-uf.json             27 UFs, qualidade "minima"
 *   - municipios/<UF>.json   municípios de cada UF (sigla em maiúsculas), qualidade "minima"
 *   - meta.json              URLs, data da consulta, contagens, SHA-256 de cada arquivo e municípios
 *                            que existem nas localidades mas ainda não têm polígono na malha publicada
 *
 * Nenhuma geometria é editada ou estimada: só arredondamos coordenadas a
 * 4 casas (~11 m, abaixo da resolução da malha "minima") e anexamos nomes
 * oficiais (API de localidades do IBGE) às propriedades.
 */
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://servicodados.ibge.gov.br/api";
const GEOJSON = "formato=application/vnd.geo%2Bjson";
const sources = {
  ufs: `${API}/v3/malhas/paises/BR?${GEOJSON}&qualidade=minima&intrarregiao=UF`,
  ufNames: `${API}/v1/localidades/estados`,
  municipios: `${API}/v3/malhas/estados/{uf}?${GEOJSON}&qualidade=minima&intrarregiao=municipio`,
  municipioNames: `${API}/v1/localidades/estados/{uf}/municipios`,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "geo");

async function get(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    return get(url, attempt + 1);
  }
}

const round = (v) => (Array.isArray(v) ? v.map(round) : Math.round(v * 1e4) / 1e4);

function enrich(fc, props) {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => {
      const code = String(f.properties.codarea);
      const extra = props.get(code);
      if (!extra) throw new Error(`Sem nome oficial para ${code}`);
      return {
        type: "Feature",
        id: Number(code),
        properties: { code, ...extra },
        geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      };
    }),
  };
}

const files = {};
const withoutGeometry = [];
async function save(relative, collection) {
  const body = JSON.stringify(collection);
  await mkdir(dirname(join(out, relative)), { recursive: true });
  await writeFile(join(out, relative), body);
  files[relative] = {
    sha256: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
    features: collection.features.length,
  };
}

/** Executa `task` sobre `items` com no máximo `limit` requisições simultâneas (cortesia com a API do IBGE). */
async function pool(items, limit, task) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const [ufs, ufNames] = await Promise.all([get(sources.ufs), get(sources.ufNames)]);
const brUf = enrich(ufs, new Map(ufNames.map((u) => [String(u.id), { name: u.nome, uf: u.sigla }])));
if (brUf.features.length !== 27) throw new Error(`Esperadas 27 UFs, vieram ${brUf.features.length}`);

await rm(join(out, "municipios"), { recursive: true, force: true });
await rm(join(out, "ce-municipios.json"), { force: true });
await save("br-uf.json", brUf);

const states = [...ufNames].sort((a, b) => a.sigla.localeCompare(b.sigla));
const counts = await pool(states, 4, async (state) => {
  const [mesh, names] = await Promise.all([
    get(sources.municipios.replace("{uf}", state.id)),
    get(sources.municipioNames.replace("{uf}", state.id)),
  ]);
  const collection = enrich(mesh, new Map(names.map((m) => [String(m.id), { name: m.nome, uf: state.sigla }])));
  // Município recém-instalado pode existir nas localidades antes de ganhar polígono na malha publicada:
  // fica registrado (aparece nas listas, não no mapa); nada é desenhado à mão.
  const drawn = new Set(collection.features.map((f) => f.properties.code));
  for (const m of names)
    if (!drawn.has(String(m.id))) withoutGeometry.push({ code: String(m.id), name: m.nome, uf: state.sigla });
  await save(`municipios/${state.sigla}.json`, collection);
  return [state.sigla, collection.features.length];
});

const byUf = Object.fromEntries(counts);
await writeFile(
  join(out, "meta.json"),
  JSON.stringify(
    {
      source: "IBGE — API de malhas territoriais v3 e API de localidades v1",
      retrieved_at: new Date().toISOString(),
      quality: "minima",
      projection: "WGS84 (EPSG:4326); renderizado em Web Mercator pelo MapLibre",
      transformation: "Coordenadas arredondadas a 4 casas decimais; nomes oficiais anexados às propriedades. Nenhuma geometria editada.",
      urls: sources,
      counts: { ufs: brUf.features.length, municipios: Object.values(byUf).reduce((sum, n) => sum + n, 0), byUf },
      withoutGeometry: withoutGeometry.sort((a, b) => a.code.localeCompare(b.code)),
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);
console.log(`ok: ${brUf.features.length} UFs, ${Object.values(byUf).reduce((sum, n) => sum + n, 0)} municípios → ${out}`);
