import type { Metadata } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

const titleOf = (m: Metadata) => (m.title as { absolute: string }).absolute;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const ANDRE = {
  id: "96ed5eaf-d528-4ae4-934d-e32b7f9427c8",
  name: "Andre Fernandes De Moura",
  ballotName: "André Fernandes",
  office: "DEPUTADO FEDERAL",
  partyAcronym: "PL",
  state: "CE",
  slug: "andre-fernandes",
  latestCandidacy: {
    year: 2026, round: 1, officeCode: 6, officeName: "Deputado Federal", unitName: "Ceará", uf: "CE", party: "PL",
    outcome: "ELEITO POR QP", elected: true,
  },
};

async function loadSeo(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/lib/seo");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("endereços", () => {
  it("perfil usa o slug e cai para o id quando não há slug", async () => {
    const { isUuid, politicianPath } = await import("@/lib/paths");
    expect(politicianPath({ id: ANDRE.id, slug: "andre-fernandes" })).toBe("/politicos/andre-fernandes");
    expect(politicianPath({ id: ANDRE.id, slug: null })).toBe(`/politicos/${ANDRE.id}`);
    expect(isUuid(ANDRE.id)).toBe(true);
    expect(isUuid("andre-fernandes")).toBe(false);
  });
});

describe("indexação", () => {
  it("sem endereço público e permissão explícita, nada é indexado nem tem canonical absoluto", async () => {
    const { pageMetadata } = await loadSeo();
    const m = pageMetadata({ title: "Eleições", description: "x", path: "/eleicoes" });
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.alternates).toBeUndefined();
    const robots = (await import("@/app/robots")).default();
    expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
    await expect((await import("@/app/sitemap")).default()).resolves.toEqual([]);
  });

  it("com endereço definitivo e permissão, indexa o canônico e aponta o sitemap", async () => {
    const env = { NEXT_PUBLIC_SITE_URL: "https://repbrasil.example/", NEXT_PUBLIC_ALLOW_INDEXING: "true" };
    const { pageMetadata } = await loadSeo(env);
    const m = pageMetadata({ title: "Eleições", description: "x", path: "/eleicoes" });
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.alternates).toEqual({ canonical: "/eleicoes" });
    const zone = pageMetadata({ title: "Zona", description: "x", path: "/eleicoes/2026/1/ce/fortaleza/zona/1", index: false });
    expect(zone.robots).toEqual({ index: false, follow: true }); // não indexa, mas segue os links
    const robots = (await import("@/app/robots")).default();
    expect(robots.sitemap).toBe("https://repbrasil.example/sitemap.xml");
  });

  it("a permissão sozinha (sem endereço público) não liga a indexação", async () => {
    const { pageMetadata } = await loadSeo({ NEXT_PUBLIC_ALLOW_INDEXING: "true" });
    expect(pageMetadata({ title: "a", description: "b", path: "/" }).robots).toEqual({ index: false, follow: false });
  });
});

describe("metadados por página", () => {
  it("perfil: nome de urna e a candidatura oficial mais recente; descrição com o nome civil", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (String(url).endsWith("/slug/andre-fernandes") ? json(ANDRE) : json({}, 404))));
    const { politicianMetadata } = await loadSeo();
    const m = await politicianMetadata("andre-fernandes");
    expect(titleOf(m)).toBe("André Fernandes — Deputado Federal · Ceará · PL · 2026 · REPBrasil");
    expect(String(m.description)).toContain("(Andre Fernandes de Moura)");
  });

  it("perfil só com cadastro anterior (sem camada eleitoral): cargo, partido e UF do cadastro", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ ...ANDRE, latestCandidacy: null })));
    const { politicianMetadata } = await loadSeo();
    expect(titleOf(await politicianMetadata("andre-fernandes"))).toBe("André Fernandes — Deputado Federal · PL · Ceará · REPBrasil");
  });

  it("perfil inexistente é 404 de verdade; API fora do ar não é 'não existe'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ message: "não existe" }, 404)));
    const { lookupPolitician } = await loadSeo();
    expect((await lookupPolitician("ninguem")).status).toBe(404);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    expect(await lookupPolitician("ninguem")).toEqual({ status: 0, data: null });
  });

  it("perfil inexistente ou API fora do ar: título genérico e sem indexação", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { politicianMetadata } = await loadSeo({ NEXT_PUBLIC_SITE_URL: "https://repbrasil.example", NEXT_PUBLIC_ALLOW_INDEXING: "true" });
    const m = await politicianMetadata("ninguem");
    expect(titleOf(m)).toBe("Perfil de político · REPBrasil");
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("eleição: território pelo nome oficial; zona e seção não são indexadas", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ municipalities: [{ slug: "fortaleza", name: "Fortaleza" }] })));
    const { electionMetadata } = await loadSeo({ NEXT_PUBLIC_SITE_URL: "https://repbrasil.example", NEXT_PUBLIC_ALLOW_INDEXING: "true" });
    const city = await electionMetadata(["2024", "1", "ce", "fortaleza"]);
    expect(titleOf(city)).toBe("Fortaleza (CE) — Eleições 2024 · 1º turno · REPBrasil");
    expect(city.alternates).toEqual({ canonical: "/eleicoes/2024/1/ce/fortaleza" });
    const state = await electionMetadata(["2026", "1", "ce"]);
    expect(titleOf(state)).toBe("Ceará — Eleições 2026 · 1º turno · REPBrasil");
    const section = await electionMetadata(["2026", "1", "ce", "fortaleza", "zona", "1", "secao", "12"]);
    expect(titleOf(section)).toBe("Zona 001 · Seção 0012 — Fortaleza (CE) — Eleições 2026 · 1º turno · REPBrasil");
    expect(section.robots).toEqual({ index: false, follow: true });
    const invalid = await electionMetadata(["abc"]);
    expect(titleOf(invalid)).toBe("Eleição não encontrada · REPBrasil");
  });
});
