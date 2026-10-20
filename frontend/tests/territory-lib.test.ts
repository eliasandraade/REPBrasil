import { describe, expect, it } from "vitest";
import type { StateCoverage } from "@/lib/data-intelligence";
import { ORDINAL_5 } from "@/lib/dataviz/palette";
import { insidePoint, inPolygon } from "@/lib/territory/centroid";
import { amendmentYears, availabilityText, hasData, loadedIndicators } from "@/lib/territory/coverage";
import { formatCoefficient, formatShort, formatValue } from "@/lib/territory/format";
import { associationSentence, distribution, extremeGroups, rankOf, strengthOf } from "@/lib/territory/insights";
import { canvasSignature, coverageLayer, valueLayer, viewNote } from "@/lib/territory/layers";
import { inUf, ofUf, ufOfPreposition } from "@/lib/territory/places";
import { classedScale, isExtensive, magnitudes, quantileBreaks } from "@/lib/territory/scale";
import { placeTooltip } from "@/lib/territory/tooltip";
import { explorerHref, explorerQuery, levelOf, parseExplorerState } from "@/lib/territory/url";
import { cameraMotion, paintTransition, pulseMotion } from "@/motion/map";
import { duration } from "@/motion/tokens";

const params = (query: string) => new URLSearchParams(query);

const CEARA: StateCoverage = {
  uf: "CE",
  name: "Ceará",
  ibgeCode: 23,
  municipalities: 184,
  socioeconomic: [
    { indicator: "ibge.population", period: 2022, municipalities: 184 },
    { indicator: "ibge.population", period: 2010, municipalities: 184 },
    { indicator: "ibge.literacy_rate_15_plus", period: 2022, municipalities: 184 },
  ],
  elections: [{ year: 2022, round: 1, municipalities: 184 }],
  amendments: [
    { year: 2024, municipalities: 67, amendments: 117 },
    { year: 2015, municipalities: 0, amendments: 4 },
    { year: 2016, municipalities: 12, amendments: 20 },
  ],
};
const EMPTY: StateCoverage = { uf: "SP", name: "São Paulo", ibgeCode: 35, municipalities: 645, socioeconomic: [], elections: [], amendments: [] };

describe("estado do explorador na URL", () => {
  it("lê território, modo, vista e recorte, descartando o que é inválido", () => {
    const state = parseExplorerState(params("uf=ce&municipio=2304400&modo=emendas&vista=relevo&ano=2024&metrica=pago&antes=2015"));
    expect(state).toMatchObject({ uf: "CE", municipality: "2304400", mode: "emendas", view: "relevo", year: 2024, metric: "pago", before: "2015" });
    expect(parseExplorerState(params("uf=XX&modo=outro&vista=3d&ano=99&turno=3&cargo=0&x=DROP TABLE"))).toMatchObject({
      uf: null,
      mode: "socioeconomico",
      view: "mapa",
      year: null,
      round: null,
      office: null,
      x: null,
    });
  });

  it("município sem UF usa a UF do próprio código IBGE; município de outra UF é descartado", () => {
    expect(parseExplorerState(params("municipio=2304400"))).toMatchObject({ uf: "CE", municipality: "2304400" });
    expect(parseExplorerState(params("uf=SP&municipio=2304400"))).toMatchObject({ uf: "SP", municipality: null });
  });

  it("links antigos (só indicador e período) continuam abrindo o modo socioeconômico", () => {
    expect(parseExplorerState(params("x=ibge.population&periodo=2022"))).toMatchObject({ mode: "socioeconomico", x: "ibge.population", period: 2022, uf: null });
  });

  it("serializa sem valores padrão e volta ao mesmo estado", () => {
    const state = parseExplorerState(params("uf=CE&modo=eleitoral&ano=2022&turno=1&cargo=3"));
    expect(explorerQuery(state)).toBe("uf=CE&modo=eleitoral&ano=2022&turno=1&cargo=3");
    expect(parseExplorerState(params(explorerQuery(state)))).toEqual(state);
    expect(explorerHref(parseExplorerState(params("")))).toBe("/dados");
    expect(levelOf({ uf: null, municipality: null })).toBe("country");
    expect(levelOf({ uf: "CE", municipality: null })).toBe("state");
    expect(levelOf({ uf: "CE", municipality: "2304400" })).toBe("municipality");
  });
});

describe("escalas do mapa", () => {
  it("classes por quantil sem classe vazia; o limite superior é o maior valor observado na classe", () => {
    expect(quantileBreaks([1, 1, 1, 1, 9], 5)).toEqual([1, 9]);
    const scale = classedScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "light")!;
    expect(scale.classes.map((c) => [c.from, c.to, c.count])).toEqual([
      [1, 2, 2],
      [3, 4, 2],
      [5, 6, 2],
      [7, 8, 2],
      [9, 10, 2],
    ]);
    expect(scale.classes.map((c) => c.color)).toEqual([...ORDINAL_5.light]);
    expect(scale.classOf(10).index).toBe(4);
    expect(classedScale([], "light")).toBeNull();
  });

  it("altura e calor proporcionais ao valor; com negativos, posição entre mínimo e máximo", () => {
    expect(magnitudes([{ code: "a", value: 0 }, { code: "b", value: 50 }, { code: "c", value: 100 }])).toEqual({ values: { a: 0, b: 0.5, c: 1 }, proportional: true });
    expect(magnitudes([{ code: "a", value: -10 }, { code: "b", value: 10 }])).toEqual({ values: { a: 0, b: 1 }, proportional: false });
  });

  it("só grandezas somáveis aceitam calor e pulso", () => {
    expect(["pessoas", "R$", "R$ mil", "emendas"].every(isExtensive)).toBe(true);
    expect(["%", "índice", "R$/pessoa"].some(isExtensive)).toBe(false);
  });
});

describe("ponto interno, rótulo e textos", () => {
  const square = { type: "Polygon" as const, coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]] as [number, number][]] };
  const cShape = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [6, 0], [6, 1], [1, 1], [1, 5], [6, 5], [6, 6], [0, 6], [0, 0]] as [number, number][]],
  };

  it("o ponto de referência cai sempre dentro do território, inclusive em forma côncava", () => {
    expect(insidePoint(square)).toEqual([2, 2]);
    const point = insidePoint(cShape);
    expect(inPolygon(point, cShape.coordinates)).toBe(true);
    const multi = { type: "MultiPolygon" as const, coordinates: [[[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]] as [number, number][][], square.coordinates] };
    expect(insidePoint(multi)).toEqual([2, 2]);
  });

  it("o rótulo fica dentro do mapa e evita a seleção quando há espaço", () => {
    expect(placeTooltip({ x: 50, y: 50 }, { width: 100, height: 40 }, { width: 400, height: 300 })).toMatchObject({ side: "se", x: 62, y: 62 });
    expect(placeTooltip({ x: 390, y: 290 }, { width: 100, height: 40 }, { width: 400, height: 300 })).toMatchObject({ side: "nw" });
    const avoid = { x: 60, y: 60, width: 120, height: 60 };
    expect(placeTooltip({ x: 50, y: 50 }, { width: 40, height: 20 }, { width: 400, height: 300 }, avoid).side).not.toBe("se");
    const clamped = placeTooltip({ x: 5, y: 5 }, { width: 500, height: 400 }, { width: 400, height: 300 });
    expect(clamped.x).toBeGreaterThanOrEqual(8);
    expect(clamped.y).toBeGreaterThanOrEqual(8);
  });

  it("valores pela unidade do catálogo, sem inventar unidade", () => {
    expect(formatValue(12.345, "%")).toBe("12,3%");
    expect(formatValue(1, "pessoas")).toBe("1 pessoa");
    expect(formatValue(2428708, "pessoas")).toBe("2.428.708 pessoas");
    expect(formatValue(0.712, "índice")).toBe("0,712");
    expect(formatValue(3.5, "km²")).toBe("3,5 km²");
    // notação compacta do Intl: espaço não separável entre o número e "mi" (não quebra a linha no meio do valor)
    expect(formatShort(2428708, "pessoas")).toBe("2,4 mi pessoas");
    expect(formatCoefficient(-0.823)).toBe("−0,82");
    expect(formatCoefficient(null)).toBe("—");
  });

  it("nome da UF com a contração certa", () => {
    expect(ofUf("CE", "Ceará")).toBe("do Ceará");
    expect(ofUf("BA", "Bahia")).toBe("da Bahia");
    expect(ofUf("SP", "São Paulo")).toBe("de São Paulo");
    expect(inUf("MT", "Mato Grosso")).toBe("em Mato Grosso");
    expect(inUf("PB", "Paraíba")).toBe("na Paraíba");
    expect(ufOfPreposition("RN")).toBe("do");
  });
});

describe("leituras em linguagem simples", () => {
  const rows = [
    { code: "1", name: "A", value: 10 },
    { code: "2", name: "B", value: 30 },
    { code: "3", name: "C", value: 30 },
    { code: "4", name: "D", value: 50 },
  ];

  it("faixa, mediana e posição (empate divide a posição)", () => {
    expect(distribution(rows)).toMatchObject({ n: 4, median: 30, min: { name: "A" }, max: { name: "D" } });
    expect(rankOf(rows, "2")).toEqual({ rank: 2, n: 4 });
    expect(rankOf(rows, "3")).toEqual({ rank: 2, n: 4 });
    expect(rankOf(rows, "x")).toBeNull();
  });

  it("a associação vira frase neutra; perfeita é sinalizada como construção", () => {
    expect(strengthOf(0.05)).toBe("sem_associacao");
    expect(strengthOf(-0.45)).toBe("moderada");
    expect(strengthOf(0.999)).toBe("perfeita");
    expect(associationSentence("População", "Taxa de alfabetização", 0.45, 184)).toBe(
      "Nos 184 municípios com os dois dados, os que têm maior População tendem a ter maior Taxa de alfabetização (associação moderada, ρ = 0,45).",
    );
    expect(associationSentence("A", "B", -0.82, 10)).toContain("tendem a ter menor B");
    expect(associationSentence("A", "B", -1, 10)).toContain("calculado a partir do outro");
    expect(associationSentence("A", "B", null, 10)).toContain("Não há variação suficiente");
    // abaixo de 10 municípios a força não é rotulada: um ou dois mudam o coeficiente inteiro
    expect(associationSentence("A", "B", 1, 3)).toBe("Só 3 municípios têm os dois dados: poucos para descrever uma associação entre A e B.");
    expect(associationSentence("A", "B", 1, 1)).toBe("Só 1 município tem os dois dados: poucos para descrever uma associação entre A e B.");
  });

  it("compara os municípios das duas pontas de X pela média de Y", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ municipalityIbgeCode: String(i), x: i, y: i * 10 }));
    expect(extremeGroups(points)).toEqual({ low: { n: 2, xFrom: 0, xTo: 1, meanY: 5 }, high: { n: 2, xFrom: 8, xTo: 9, meanY: 85 } });
    expect(extremeGroups(points.slice(0, 5))).toBeNull();
  });
});

describe("cobertura e camadas", () => {
  it("disponibilidade vem só da cobertura da API", () => {
    expect([hasData(CEARA, "socioeconomico"), hasData(CEARA, "eleitoral"), hasData(CEARA, "emendas")]).toEqual([true, true, true]);
    expect(["socioeconomico", "eleitoral", "emendas"].some((m) => hasData(EMPTY, m as "emendas"))).toBe(false);
    expect([...loadedIndicators(CEARA)]).toEqual([
      ["ibge.population", [2022, 2010]],
      ["ibge.literacy_rate_15_plus", [2022]],
    ]);
    // ano sem município identificado por código IBGE não vira ano disponível no mapa
    expect(amendmentYears(CEARA)).toEqual([2024, 2016]);
    expect(availabilityText(CEARA, "socioeconomico")).toBe("2 indicadores · 2022, 2010");
    expect(availabilityText(EMPTY, "eleitoral")).toBe("sem dados carregados");
  });

  it("mapa do Brasil pinta só as UFs com dado; o resto fica na cor da terra", () => {
    const layer = coverageLayer([CEARA, EMPTY], "socioeconomico", "light", "Socioeconômico");
    expect(Object.keys(layer.colors)).toEqual(["23"]);
    expect(layer.texts["35"]).toBe("sem dados carregados");
    expect(layer.legend?.kind).toBe("categories");
  });

  it("camada de valor: cor só onde há valor finito, texto com unidade, legenda com os limites reais", () => {
    const layer = valueLayer({
      key: "k",
      level: "state",
      rows: [
        { code: "1", value: 10 },
        { code: "2", value: Number.NaN },
        { code: "3", value: 90 },
      ],
      unit: "pessoas",
      title: "População",
      caption: "População · 2022",
      theme: "light",
      extensive: true,
    });
    expect(Object.keys(layer.colors).sort()).toEqual(["1", "3"]);
    expect(layer.texts["3"]).toBe("90 pessoas");
    expect(layer.maxText).toBe("90 pessoas");
    expect(layer.legend?.kind === "classes" && layer.legend.items.map((i) => i.label)).toEqual(["10 pessoas", "90 pessoas"]);
    expect(viewNote("relevo", layer)).toContain("o mais alto é 90 pessoas");
    expect(viewNote("intensidade", layer)).toContain("Mapa de calor");
    expect(viewNote("mapa", layer)).toBeNull();
    expect(canvasSignature(layer)).not.toBe(canvasSignature({ ...layer, colors: { ...layer.colors, "1": "#000000" } }));
  });
});

describe("movimento do mapa", () => {
  it("câmera e camadas usam os tokens; Reduced Motion vira corte seco e sem pulso", () => {
    expect(cameraMotion("survey", false).duration).toBe(duration.survey);
    expect(cameraMotion("traverse", true).duration).toBe(0);
    expect(paintTransition("reveal", false, 40)).toEqual({ duration: duration.reveal, delay: 40 });
    expect(paintTransition("reveal", true, 40)).toEqual({ duration: 0, delay: 0 });
    expect(pulseMotion(true)).toBeNull();
    expect(pulseMotion(false)?.duration).toBe(duration.reveal * 2);
  });
});
