import { describe, expect, it } from "vitest";
import { displayName, formatCount, formatPercent, outcomeLabel, pad3, sourceDate, UNAVAILABLE } from "@/lib/elections/format";
import { buildElectionsPath, levelOf, parentRoute, parseElectionsPath, shouldAutoSelectZone } from "@/lib/elections/route";
import { buildZoneModel, searchPlaces } from "@/lib/elections/zone-model";
import { zoneDetail } from "./fixtures";

describe("rota do explorador (URL = território)", () => {
  it("lê e reconstrói todos os níveis", () => {
    const full = "/eleicoes/2026/1/ce/fortaleza/zona/94/secao/381";
    const r = parseElectionsPath(full)!;
    expect(r).toEqual({ year: 2026, round: 1, state: "ce", municipality: "fortaleza", zone: 94, section: 381 });
    expect(buildElectionsPath(r)).toBe(full);
    expect(levelOf(r)).toBe("section");
    expect(buildElectionsPath(parentRoute(r))).toBe("/eleicoes/2026/1/ce/fortaleza/zona/94");
    expect(buildElectionsPath(parentRoute(parentRoute(r)))).toBe("/eleicoes/2026/1/ce/fortaleza");
    expect(levelOf(parseElectionsPath("/eleicoes/2026/1")!)).toBe("country");
  });

  it("rejeita rotas que não são território", () => {
    for (const bad of ["/eleicoes", "/eleicoes/x/1", "/eleicoes/2026/1/ceara", "/eleicoes/2026/1/ce/fortaleza/zona/x", "/eleicoes/2026/1/ce/fortaleza/zona/94/urna/1"]) {
      expect(parseElectionsPath(bad)).toBeNull();
    }
  });

  it("zona única ⇒ automática; várias ⇒ usuário escolhe; voltando da zona nunca", () => {
    const m = parseElectionsPath("/eleicoes/2026/1/ce/general-sampaio")!;
    expect(shouldAutoSelectZone(m, 1, false)).toBe(true);
    expect(shouldAutoSelectZone(m, 3, false)).toBe(false);
    expect(shouldAutoSelectZone(m, 1, true)).toBe(false);
  });
});

describe("formatação: ausente nunca vira zero", () => {
  it("null/undefined ⇒ —", () => {
    expect(formatCount(null)).toBe(UNAVAILABLE);
    expect(formatCount(undefined)).toBe(UNAVAILABLE);
    expect(formatPercent(null)).toBe(UNAVAILABLE);
    expect(formatCount(0)).toBe("0");
    expect(formatCount(35438081)).toBe("35.438.081");
    expect(formatPercent(54.06)).toBe("54,06%");
  });

  it("apresentação não muda identidade", () => {
    expect(displayName("LUIZ GASTÃO DA SILVA")).toBe("Luiz Gastão da Silva");
    expect(displayName("Já Formatado")).toBe("Já Formatado");
    // resultado oficial: caixa de frase com a sigla preservada (nunca "Eleito Por Qp")
    expect(outcomeLabel("ELEITO POR QP")).toBe("Eleito por QP");
    expect(outcomeLabel("NÃO ELEITO")).toBe("Não eleito");
    expect(outcomeLabel("2º TURNO")).toBe("2º turno");
    expect(outcomeLabel(null)).toBe(UNAVAILABLE);
    expect(pad3(29)).toBe("029");
    expect(sourceDate("05/10/2026 14:03:00")).toBe("05/10/2026 14:03");
  });
});

describe("modelo da zona", () => {
  const zone = buildZoneModel(zoneDetail("fortaleza", 94))!;

  it("indexa seções e conta locais sem coordenada oficial", () => {
    expect(zone.getSection(79)).toMatchObject({ isAggregated: true, principalNumber: 58, eligible: null });
    expect(zone.getSection(29)!.eligible).toEqual({ federal: null, state: null });
    expect(zone.awaitingLocation).toBe(1);
  });

  it("busca por número de seção, nome e bairro sem acento", () => {
    expect(searchPlaces(zone.places, "029").flatMap((p) => p.sections.map((s) => s.number))).toEqual([29]);
    expect(searchPlaces(zone.places, "seção 38").flatMap((p) => p.sections.map((s) => s.number))).toEqual([381]);
    expect(searchPlaces(zone.places, "ficticia b").map((p) => p.code)).toEqual(["1023"]);
    expect(searchPlaces(zone.places, "inexistente")).toEqual([]);
  });
});
