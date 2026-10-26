import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ufMesh from "../public/geo/br-uf.json";
import { LiveStoreProvider } from "@/components/live-election/LiveContext";
import { PresentationStage } from "@/components/live-election/presentation/PresentationMode";
import type { TerritoryCollection } from "@/lib/elections/geo";
import { CANDIDATE_COLOR_BY_NUMBER, type CandidateColor, slotColors } from "@/lib/live-election/candidate-colors";
import { projectBrazil } from "@/lib/live-election/map-shapes";
import { createLiveStore, initialLiveState } from "@/lib/live-election/store";
import type { LiveSummary } from "@/lib/live-election/types";
import { envelope, SCENARIOS, statesPayload } from "./fixtures/live-election";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

// Regra editorial do 2º turno de 2026: 13 (LULA, PT) = vermelho; 22 (FLAVIO BOLSONARO, PL) = azul — pelo número,
// nunca pelo slot. Ordem real da API em 25/10/2026: 13 no slot "a" (position 1), 22 no slot "b" (position 2).
const LULA = 13;
const FLAVIO = 22;
const other = (c: CandidateColor): CandidateColor => (c === "red" ? "blue" : "red");

describe("cor por candidatura (slotColors)", () => {
  it("a regra é 13 = vermelho e 22 = azul", () => {
    expect(CANDIDATE_COLOR_BY_NUMBER.get(LULA)).toBe("red");
    expect(CANDIDATE_COLOR_BY_NUMBER.get(FLAVIO)).toBe("blue");
  });

  it("ordem atual da API (13 em A, 22 em B): A vermelho, B azul", () => {
    expect(slotColors([{ slot: "a", number: LULA }, { slot: "b", number: FLAVIO }])).toEqual({ a: "red", b: "blue" });
  });

  it("se o TSE inverter a ordem (22 em A, 13 em B), a cor acompanha a candidatura", () => {
    expect(slotColors([{ slot: "a", number: FLAVIO }, { slot: "b", number: LULA }])).toEqual({ a: "blue", b: "red" });
    // a ordem do array também não importa
    expect(slotColors([{ slot: "b", number: LULA }, { slot: "a", number: FLAVIO }])).toEqual({ a: "blue", b: "red" });
  });

  it("basta conhecer um dos dois números", () => {
    expect(slotColors([{ slot: "b", number: LULA }])).toEqual({ a: "blue", b: "red" });
    expect(slotColors([{ slot: "b", number: FLAVIO }])).toEqual({ a: "red", b: "blue" });
    expect(slotColors([{ slot: "a", number: FLAVIO }, { slot: "b", number: 99 }])).toEqual({ a: "blue", b: "red" });
  });

  it("sem 13 nem 22 (cenários sintéticos) ou sem candidaturas: A vermelho, B azul", () => {
    expect(slotColors([{ slot: "a", number: 10 }, { slot: "b", number: 20 }])).toEqual({ a: "red", b: "blue" });
    expect(slotColors([])).toEqual({ a: "red", b: "blue" });
  });
});

// ------------------------------------------------------------------ contrato do CSS

const css = (path: string) => readFileSync(join(process.cwd(), "src/components/live-election", path), "utf8");
const LIVE_CSS = css("live-election.css");
const PM_CSS = css("presentation/presentation.css");

function block(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(`${selector} {`);
  expect(start, `bloco ${selector}`).toBeGreaterThanOrEqual(0);
  const body = source.slice(start + selector.length + 2, source.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const isRed = (hex: string) => hue(hex) < 30 || hue(hex) > 340;
const isBlue = (hex: string) => hue(hex) > 190 && hue(hex) < 240;

describe("tokens de cor da apuração (CSS)", () => {
  it("página: as cores validadas, sem tom novo — vermelho #eb6834/#d95926, azul #2a78d6/#3987e5", () => {
    const light = block(LIVE_CSS, ":root");
    expect(light["--live-red"]).toBe("#eb6834");
    expect(light["--live-blue"]).toBe("#2a78d6");
    for (const dark of [block(LIVE_CSS, ':root[data-theme="dark"]'), block(LIVE_CSS, ':root:where(:not([data-theme="light"]))')]) {
      expect(dark["--live-red"]).toBe("#d95926");
      expect(dark["--live-blue"]).toBe("#3987e5");
    }
    expect(block(PM_CSS, ".pm-root")["--live-red"]).toBe("#d95926");
    expect(block(PM_CSS, ".pm-root")["--live-blue"]).toBe("#3987e5");
    for (const hex of ["#eb6834", "#d95926"]) expect(isRed(hex), hex).toBe(true);
    for (const hex of ["#2a78d6", "#3987e5"]) expect(isBlue(hex), hex).toBe(true);
  });

  it("slot A veste vermelho por padrão e troca com o B só por data-live-slot-a=blue (página e palco)", () => {
    for (const [source, root, swap] of [
      [LIVE_CSS, ":root", '[data-live-slot-a="blue"]'],
      [PM_CSS, ".pm-root", '.pm-root[data-live-slot-a="blue"]'],
    ] as const) {
      expect(block(source, root)).toMatchObject({ "--live-a": "var(--live-red)", "--live-b": "var(--live-blue)" });
      expect(block(source, swap)).toEqual({ "--live-a": "var(--live-blue)", "--live-b": "var(--live-red)" });
    }
  });

  it("nenhuma cor fixa nos slots: --live-a/--live-b só apontam para --live-red/--live-blue", () => {
    for (const source of [LIVE_CSS, PM_CSS]) {
      const decls = [...source.matchAll(/(--live-[ab])\s*:\s*([^;]+);/g)].map((m) => m[2].trim());
      expect(decls.length).toBeGreaterThan(0);
      for (const value of decls) expect(["var(--live-red)", "var(--live-blue)"]).toContain(value);
    }
  });
});

// ------------------------------------------------------------------ palco renderizado

describe("palco: a cor segue a candidatura nos dois sentidos da ordem do TSE", () => {
  const shapes = projectBrazil(ufMesh as unknown as TerritoryCollection);

  /** Mesmo placar sintético, com os números e nomes de urna trocados para identificar cada candidatura. */
  const numbered = (s: LiveSummary, a: number, b: number): LiveSummary => ({
    ...s,
    candidates: s.candidates.map((c) => {
      const number = c.slot === "a" ? a : b;
      return { ...c, number, ballotName: `CANDIDATURA ${number}` };
    }),
  });

  /** Cor que o card da candidatura veste: a do slot em que ele está, conforme o atributo da raiz. */
  function rendered(summary: LiveSummary) {
    const store = createLiveStore(initialLiveState(envelope(summary, 10, { phase: summary.phase }), envelope(statesPayload(), 10)), { schedule: (run) => run() });
    const view = render(
      <LiveStoreProvider store={store}>
        <PresentationStage mapShapes={shapes} />
      </LiveStoreProvider>,
    );
    const slotA = screen.getByTestId("presentation-root").getAttribute("data-live-slot-a") as CandidateColor;
    const card = (n: number) =>
      [...document.querySelectorAll<HTMLElement>(".pm-candidate")].find((el) => el.querySelector(".pm-name")?.textContent === `CANDIDATURA ${n}`)?.getAttribute("data-slot");
    const colorOf = (n: number) => (card(n) === "a" ? slotA : other(slotA));
    return { slotA, card, colorOf, unmount: view.unmount };
  }

  it("13 em A e 22 em B (ordem atual): 13 vermelho, 22 azul", () => {
    const r = rendered(numbered(SCENARIOS.half, LULA, FLAVIO));
    expect(r.card(LULA)).toBe("a");
    expect(r.slotA).toBe("red");
    expect(r.colorOf(LULA)).toBe("red");
    expect(r.colorOf(FLAVIO)).toBe("blue");
    r.unmount();
  });

  it("22 em A e 13 em B (ordem invertida): 13 continua vermelho, 22 continua azul", () => {
    const r = rendered(numbered(SCENARIOS.half, FLAVIO, LULA));
    expect(r.card(LULA)).toBe("b");
    expect(r.slotA).toBe("blue");
    expect(r.colorOf(LULA)).toBe("red");
    expect(r.colorOf(FLAVIO)).toBe("blue");
    r.unmount();
  });

  it("a troca chega pelo stream (candidate-update) sem recarregar: o atributo acompanha", () => {
    const summary = numbered(SCENARIOS.half, LULA, FLAVIO);
    const store = createLiveStore(initialLiveState(envelope(summary, 10, { phase: summary.phase }), envelope(statesPayload(), 10)), { schedule: (run) => run() });
    render(
      <LiveStoreProvider store={store}>
        <PresentationStage mapShapes={shapes} />
      </LiveStoreProvider>,
    );
    const root = screen.getByTestId("presentation-root");
    expect(root.getAttribute("data-live-slot-a")).toBe("red");
    const swapped = numbered(SCENARIOS.half, FLAVIO, LULA).candidates;
    act(() => store.dispatch({ type: "candidates", envelope: envelope({ candidates: swapped }, 11, { phase: summary.phase }) }));
    expect(root.getAttribute("data-live-slot-a")).toBe("blue");
  });
});
