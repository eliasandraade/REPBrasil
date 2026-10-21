import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MUNICIPALITY_MESHES,
  UF_MESH_URL,
  loadMunicipalityMesh,
  loadTerritoryGeo,
  mergeCollections,
  resetGeoCache,
  type TerritoryCollection,
} from "@/lib/elections/geo";

const GEO = join(__dirname, "..", "public", "geo");
const meta = JSON.parse(readFileSync(join(GEO, "meta.json"), "utf8")) as {
  counts: { ufs: number; municipios: number; byUf: Record<string, number> };
  files: Record<string, { sha256: string; bytes: number; features: number }>;
  withoutGeometry: Array<{ code: string; name: string; uf: string }>;
};

const mesh = (codes: number[]): TerritoryCollection => ({
  type: "FeatureCollection",
  features: codes.map((id) => ({
    type: "Feature",
    id,
    properties: { code: String(id), name: `M${id}`, uf: "CE" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  })),
});
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => resetGeoCache());

describe("malhas oficiais do IBGE", () => {
  it("as 27 UFs têm malha municipal publicada, uma por arquivo", () => {
    expect(Object.keys(MUNICIPALITY_MESHES)).toHaveLength(27);
    for (const url of Object.values(MUNICIPALITY_MESHES)) expect(url).toMatch(/^\/geo\/municipios\/[A-Z]{2}\.json$/);
    expect(meta.counts.ufs).toBe(27);
    expect(Object.keys(meta.counts.byUf)).toHaveLength(27);
  });

  it("cada arquivo publicado confere com o SHA-256 e a contagem registrados na proveniência", () => {
    const published = ["br-uf.json", ...Object.values(MUNICIPALITY_MESHES).map((url) => url.replace("/geo/", ""))];
    expect(Object.keys(meta.files).sort()).toEqual(published.sort());
    for (const file of published) {
      const body = readFileSync(join(GEO, file), "utf8");
      expect(createHash("sha256").update(body).digest("hex"), file).toBe(meta.files[file].sha256);
      expect((JSON.parse(body) as TerritoryCollection).features).toHaveLength(meta.files[file].features);
    }
  });

  it("município sem polígono na malha publicada fica registrado, nunca desenhado à mão", () => {
    for (const gap of meta.withoutGeometry) {
      const collection = JSON.parse(readFileSync(join(GEO, "municipios", `${gap.uf}.json`), "utf8")) as TerritoryCollection;
      expect(collection.features.some((f) => f.properties.code === gap.code)).toBe(false);
    }
  });
});

describe("carga sob demanda", () => {
  it("o explorador começa só com as UFs; cada malha municipal é baixada uma vez", async () => {
    const fetcher = vi.fn((url: string) => ok(url === UF_MESH_URL ? mesh([23]) : mesh([2304400, 2304707])));
    const geo = await loadTerritoryGeo(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(geo.municipalities.features).toHaveLength(0);

    await loadMunicipalityMesh("23", fetcher as unknown as typeof fetch);
    await loadMunicipalityMesh("23", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("/geo/municipios/CE.json");
  });

  it("falha não fica em cache: a próxima tentativa refaz a requisição", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(new Response("", { status: 503 })))
      .mockImplementationOnce(() => ok(mesh([2304400])));
    await expect(loadMunicipalityMesh("23", fetcher as unknown as typeof fetch)).rejects.toThrow("malha indisponível");
    await expect(loadMunicipalityMesh("23", fetcher as unknown as typeof fetch)).resolves.toMatchObject({ features: [{ id: 2304400 }] });
  });

  it("UF inexistente não gera requisição e junta malhas sem repetir municípios", async () => {
    const fetcher = vi.fn();
    expect((await loadMunicipalityMesh("99", fetcher as unknown as typeof fetch)).features).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mergeCollections([mesh([1, 2]), mesh([2, 3])]).features.map((f) => f.id)).toEqual([1, 2, 3]);
  });
});
