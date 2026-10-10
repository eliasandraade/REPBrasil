#!/usr/bin/env node
/**
 * Gera as malhas territoriais do explorador eleitoral a partir da API oficial do IBGE (v3).
 *
 *   node scripts/fetch-ibge-geo.mjs
 *
 * Saída em public/geo/ (servida estaticamente e carregada pelo MapLibre sob
 * demanda; nada disso entra no bundle JS):
 *   - br-uf.json         27 UFs, qualidade "minima"
 *   - ce-municipios.json 184 municípios do Ceará, qualidade "minima"
 *   - meta.json          URLs, data da consulta, contagens
 *
 * Nenhuma geometria é editada ou estimada: só arredondamos coordenadas a
 * 4 casas (~11 m, abaixo da resolução da malha "minima") e anexamos nomes
 * oficiais (API de localidades do IBGE) às propriedades.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://servicodados.ibge.gov.br/api";
const GEOJSON = "formato=application/vnd.geo%2Bjson";
const sources = {
  ufs: `${API}/v3/malhas/paises/BR?${GEOJSON}&qualidade=minima&intrarregiao=UF`,
  ceMunicipios: `${API}/v3/malhas/estados/23?${GEOJSON}&qualidade=minima&intrarregiao=municipio`,
  ufNames: `${API}/v1/localidades/estados`,
  ceNames: `${API}/v1/localidades/estados/23/municipios`
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "geo");

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
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
        geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }
      };
    })
  };
}

const [ufs, ce, ufNames, ceNames] = await Promise.all(Object.values(sources).map(get));

const brUf = enrich(ufs, new Map(ufNames.map((u) => [String(u.id), { name: u.nome, uf: u.sigla }])));
const ceMun = enrich(ce, new Map(ceNames.map((m) => [String(m.id), { name: m.nome, uf: "CE" }])));

await mkdir(out, { recursive: true });
await writeFile(join(out, "br-uf.json"), JSON.stringify(brUf));
await writeFile(join(out, "ce-municipios.json"), JSON.stringify(ceMun));
await writeFile(
  join(out, "meta.json"),
  JSON.stringify(
    {
      source: "IBGE — API de malhas territoriais v3 e API de localidades v1",
      retrieved_at: new Date().toISOString(),
      quality: "minima",
      projection: "WGS84 (EPSG:4326); renderizado em Web Mercator pelo MapLibre",
      urls: sources,
      counts: { ufs: brUf.features.length, ceMunicipios: ceMun.features.length }
    },
    null,
    2
  ) + "\n"
);
console.log(`ok: ${brUf.features.length} UFs, ${ceMun.features.length} municípios → ${out}`);
