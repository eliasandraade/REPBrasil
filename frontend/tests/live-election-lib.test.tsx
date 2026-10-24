import { describe, expect, it, vi } from "vitest";
import ufMesh from "../public/geo/br-uf.json";
import type { TerritoryCollection } from "@/lib/elections/geo";
import { compareNullable, completenessOf, lastToTotalize, leadClass, leadRatio, matchesSearch, safetyMarginOf, standingOf } from "@/lib/live-election/derive";
import {
  formatDuration,
  formatElectionDate,
  formatIntegerCompact,
  formatPercent,
  formatPercentagePoints,
  formatPercentExact,
  formatRelativeTime,
  formatSections,
  formatSectionsPct,
  formatSignedVotes,
  formatTimestamp,
  formatVotes,
  NA,
  sectionsPrecision,
} from "@/lib/live-election/format";
import { projectBrazil } from "@/lib/live-election/map-shapes";
import { isFinal, PHASE_UI, showsDistanceCard, showsMathematicalDefinition, showsResults } from "@/lib/live-election/phase";
import { filterMunicipalities } from "@/components/live-election/MunicipalityExplorer";
import { filterAndSortStates } from "@/components/live-election/StateTable";
import { CANDIDATES, KEY_A, KEY_B, municipality, SCENARIOS, statesPayload, territory } from "./fixtures/live-election";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe("formatadores (pt-BR, Brasília, null → —)", () => {
  it("votos, seções e percentuais", () => {
    expect(formatVotes(12_345_678)).toBe("12.345.678");
    expect(formatSections(499_248)).toBe("499.248");
    expect(formatPercent(51.234567)).toBe("51,23%");
    expect(formatPercent(99.987654, 6)).toBe("99,987654%");
    expect(formatPercentagePoints(2.41)).toBe("+2,41 p.p.");
    expect(formatPercentagePoints(-2.41)).toBe("−2,41 p.p.");
    expect(formatPercentagePoints(0)).toBe("0,00 p.p.");
    expect(formatSignedVotes(-1234)).toBe("−1.234");
    expect(formatSignedVotes(1234)).toBe("+1.234");
    expect(formatIntegerCompact(12_300_000)).toMatch(/12,3\s?mi/);
  });

  it("ausência nunca vira zero", () => {
    for (const f of [formatVotes, formatSections, formatPercent, formatPercentagePoints, formatSectionsPct, formatPercentExact, formatSignedVotes]) {
      expect(f(null)).toBe(NA);
      expect(f(undefined)).toBe(NA);
    }
    expect(formatTimestamp(null)).toBe(NA);
    expect(formatRelativeTime(null)).toBe(NA);
    expect(formatDuration(null)).toBe(NA);
  });

  it("precisão adaptativa perto de 100% das seções", () => {
    expect(sectionsPrecision(42.5)).toBe(2);
    expect(sectionsPrecision(99.5)).toBe(4);
    expect(sectionsPrecision(99.995)).toBe(6);
    expect(sectionsPrecision(100)).toBe(2);
    expect(formatSectionsPct(99.987654)).toBe("99,9877%");
    expect(formatSectionsPct(99.9987654)).toBe("99,998765%");
    expect(formatSectionsPct(100)).toBe("100,00%");
    expect(formatPercentExact(47.027772356)).toBe("47,027772356%");
  });

  it("horário oficial em Brasília, nunca o fuso do navegador", () => {
    expect(formatTimestamp("2026-10-25T22:32:41Z")).toBe("19:32:41");
    expect(formatTimestamp("2026-10-25T19:32:41-03:00", "time")).toBe("19:32");
    expect(formatElectionDate("2026-10-25")).toBe("25 de outubro de 2026");
  });

  it("tempo relativo e duração", () => {
    const now = Date.parse("2026-10-25T22:30:00Z");
    expect(formatRelativeTime("2026-10-25T22:29:58Z", now)).toBe("agora");
    expect(formatRelativeTime("2026-10-25T22:29:48Z", now)).toMatch(/12 s/);
    expect(formatRelativeTime("2026-10-25T22:27:00Z", now)).toMatch(/3 min/);
    expect(formatDuration(1.2)).toBe("1,2 s");
    expect(formatDuration(200)).toBe("3 min 20 s");
  });
});

describe("fase → interface", () => {
  it("AO VIVO só nas fases ao vivo; nunca em resultado final", () => {
    expect(PHASE_UI.LIVE.live).toBe(true);
    expect(PHASE_UI.MATHEMATICALLY_DEFINED.live).toBe(true);
    expect(PHASE_UI.FINAL.live).toBe(false);
    expect(PHASE_UI.FINAL.label).toBe("RESULTADO FINAL");
    expect(PHASE_UI.LIVE_STALE.live).toBe(false);
  });

  it("banner de definição matemática só com md=e antes da totalização final", () => {
    expect(showsMathematicalDefinition(SCENARIOS.mdAbsent)).toBe(false);
    expect(showsMathematicalDefinition(SCENARIOS.mdN)).toBe(false);
    expect(showsMathematicalDefinition(SCENARIOS.independentReached)).toBe(false);
    expect(showsMathematicalDefinition(SCENARIOS.mathDefined)).toBe(true);
    expect(showsMathematicalDefinition({ ...SCENARIOS.mathDefined, official: { ...SCENARIOS.mathDefined.official, finalTotalization: true } })).toBe(false);
    expect(showsMathematicalDefinition(SCENARIOS.final)).toBe(false);
    expect(isFinal(SCENARIOS.final)).toBe(true);
  });

  it("antes do início e com dv=n o placar não mostra números", () => {
    expect(showsResults(SCENARIOS.preElection)).toBe(false);
    expect(showsResults(SCENARIOS.waitingRelease)).toBe(false);
    expect(showsResults(SCENARIOS.half)).toBe(true);
    expect(showsResults(SCENARIOS.stale)).toBe(true);
  });

  it("card de distância só enquanto não definida nem final", () => {
    expect(showsDistanceCard(SCENARIOS.half)).toBe(true);
    expect(showsDistanceCard(SCENARIOS.mathDefined)).toBe(false);
    expect(showsDistanceCard(SCENARIOS.final)).toBe(false);
  });
});

describe("leituras derivadas", () => {
  it("classes de intensidade e situação no mapa", () => {
    expect(leadClass(2)).toBe(0);
    expect(leadClass(7)).toBe(1);
    expect(leadClass(15)).toBe(2);
    expect(leadClass(30)).toBe(3);
    expect(standingOf(territory("SP", "São Paulo", 10, 5, 50), CANDIDATES)).toMatchObject({ kind: "lead", slot: "a" });
    expect(standingOf(territory("SP", "São Paulo", 5, 5, 50), CANDIDATES)).toEqual({ kind: "tie" });
    expect(standingOf(territory("SP", "São Paulo", 0, 0, 0), CANDIDATES)).toEqual({ kind: "none" });
    expect(standingOf(undefined, CANDIDATES)).toEqual({ kind: "none" });
  });

  it("busca sem acento e sem caixa", () => {
    expect(matchesSearch("SÃO PAULO", "sao paulo")).toBe(true);
    expect(matchesSearch("Itaguaí", "ITAGUAI")).toBe(true);
    expect(matchesSearch("Belém", "recife")).toBe(false);
    const items = [municipality("71072", "SÃO PAULO"), municipality("62510", "SÃO JOSÉ DOS CAMPOS"), municipality("61000", "CAMPINAS")];
    expect(filterMunicipalities(items, "sao jose").map((m) => m.code)).toEqual(["62510"]);
    expect(filterMunicipalities(items, "  ").length).toBe(3);
  });

  it("razão de vantagem, margem e completude", () => {
    expect(leadRatio(108, 100)).toBeCloseTo(1.08);
    expect(leadRatio(10, 0)).toBeNull();
    expect(safetyMarginOf({ leadVotes: 4_321_987, remainingElectorateUpperBound: 6_038_221, distanceToIrreversibility: 1_716_235 })).toBe(-1_716_234);
    expect(safetyMarginOf({ leadVotes: 9, remainingElectorateUpperBound: 5, distanceToIrreversibility: null })).toBeNull();
    const indicators = completenessOf(SCENARIOS.half.national);
    expect(indicators.map((i) => i.id)).toEqual(["sections", "electorate-totalized", "electorate-counted"]);
  });

  it("últimas UFs a totalizar e comparador com null no fim", () => {
    const rows = lastToTotalize(statesPayload().remaining, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0].totalizedPct).toBeLessThanOrEqual(rows[1].totalizedPct ?? 0);
    expect([3, null, 1].sort((a, b) => compareNullable(a, b, "asc"))).toEqual([1, 3, null]);
    expect([3, null, 1].sort((a, b) => compareNullable(a, b, "desc"))).toEqual([3, 1, null]);
  });
});

describe("tabela das UFs: filtros e ordenação", () => {
  const states = statesPayload().states;
  const base = { query: "", region: "all" as const, leader: "all" as const, progress: "all" as const, sort: "uf" as const, dir: "asc" as const };

  it("ordena por nome e por diferença", () => {
    expect(filterAndSortStates(states, CANDIDATES, base)[0].name).toBe("Acre");
    const byLead = filterAndSortStates(states, CANDIDATES, { ...base, sort: "leadPp", dir: "desc" });
    expect(byLead[0].leadPp).toBeGreaterThanOrEqual(byLead[1].leadPp ?? 0);
  });

  it("filtra por região, líder, totalização e busca sem acento", () => {
    expect(filterAndSortStates(states, CANDIDATES, { ...base, region: "S" }).map((s) => s.code).sort()).toEqual(["PR", "RS", "SC"]);
    expect(filterAndSortStates(states, CANDIDATES, { ...base, leader: "tie" }).map((s) => s.code)).toEqual(["DF"]);
    const a = filterAndSortStates(states, CANDIDATES, { ...base, leader: "a" });
    expect(a.every((s) => s.leaderKey === KEY_A)).toBe(true);
    const b = filterAndSortStates(states, CANDIDATES, { ...base, leader: "b" });
    expect(b.every((s) => s.leaderKey === KEY_B)).toBe(true);
    expect(filterAndSortStates(states, CANDIDATES, { ...base, query: "sao paulo" }).map((s) => s.code)).toEqual(["SP"]);
    const incomplete = filterAndSortStates(states, CANDIDATES, { ...base, progress: "incomplete" });
    expect(incomplete.every((s) => (s.sections.totalizedPct ?? 0) < 100)).toBe(true);
  });
});

describe("malha do mapa", () => {
  it("projeta as 27 UFs com traçado compacto e rótulos dentro da viewBox", () => {
    const shapes = projectBrazil(ufMesh as unknown as TerritoryCollection);
    expect(shapes.shapes).toHaveLength(27);
    const bytes = shapes.shapes.reduce((n, s) => n + s.d.length, 0);
    expect(bytes).toBeLessThan(70_000);
    for (const s of shapes.shapes) {
      expect(s.d.startsWith("M")).toBe(true);
      expect(s.labelX).toBeGreaterThan(0);
      expect(s.labelX).toBeLessThan(shapes.width + 80);
      expect(s.labelY).toBeGreaterThan(0);
      expect(s.labelY).toBeLessThan(shapes.height + 40);
    }
  });
});
