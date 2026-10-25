import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ufMesh from "../public/geo/br-uf.json";
import { isBareRoute } from "@/components/layout/AppShell";
import { MATH_DEFINED_TITLE } from "@/components/live-election/Banners";
import { LiveStoreProvider } from "@/components/live-election/LiveContext";
import { PresentationStage } from "@/components/live-election/presentation/PresentationMode";
import type { TerritoryCollection } from "@/lib/elections/geo";
import { projectBrazil } from "@/lib/live-election/map-shapes";
import {
  commandForKey,
  DEFAULT_CONFIG,
  definedLeaderKey,
  parseConfig,
  rotationOrder,
  scoreboardOf,
  stageStatus,
  stepUf,
  tickerItems,
} from "@/lib/live-election/presentation";
import { createLiveStore, initialLiveState, type LiveStore } from "@/lib/live-election/store";
import type { LeadChange, LiveSummary } from "@/lib/live-election/types";
import { UF_NAMES, UFS } from "@/lib/site";
import { envelope, KEY_A, KEY_B, meta, SCENARIOS, statesPayload, territory } from "./fixtures/live-election";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const pct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
const texts = (summary: LiveSummary, changes: LeadChange[] = []) => tickerItems(summary, null, statesPayload().states, changes).map((i) => i.text);

describe("selo do palco (stageStatus)", () => {
  it("ELEIÇÃO DEFINIDA só com o sinal oficial md = e; a validação independente nunca define", () => {
    expect(stageStatus(SCENARIOS.mathDefined)).toEqual({ label: "ELEIÇÃO DEFINIDA", tone: "defined", live: true });
    for (const s of [SCENARIOS.independentReached, SCENARIOS.mdAbsent, SCENARIOS.mdN]) expect(stageStatus(s).label).toBe("AO VIVO");
    expect(definedLeaderKey(SCENARIOS.mathDefined)).toBe(KEY_A);
    expect(definedLeaderKey(SCENARIOS.independentReached)).toBeNull();
  });

  it("AO VIVO só com a apuração andando: final, pré-apuração e fonte parada nunca são ao vivo", () => {
    expect(stageStatus(SCENARIOS.half)).toEqual({ label: "AO VIVO", tone: "live", live: true });
    expect(stageStatus(SCENARIOS.final)).toEqual({ label: "RESULTADO FINAL", tone: "final", live: false });
    expect(stageStatus(SCENARIOS.preElection)).toMatchObject({ label: "PRÉ-APURAÇÃO", live: false });
    expect(stageStatus(SCENARIOS.waitingRelease)).toMatchObject({ label: "AGUARDANDO DIVULGAÇÃO", live: false });
    expect(stageStatus(SCENARIOS.stale)).toMatchObject({ label: "AGUARDANDO ATUALIZAÇÃO", tone: "waiting", live: false });
    // Definida e com a fonte parada: o selo continua "definida", mas sem o ponto ao vivo.
    expect(stageStatus({ phase: "LIVE_STALE", official: SCENARIOS.mathDefined.official })).toMatchObject({ label: "ELEIÇÃO DEFINIDA", live: false });
    // Totalização final encerra a definição matemática (o banner de md some).
    expect(definedLeaderKey(SCENARIOS.final)).toBeNull();
  });
});

describe("placar nacional (scoreboardOf)", () => {
  it("antes da votação oficial: nenhum percentual, voto, líder ou vantagem (zeros não são resultado)", () => {
    for (const s of [SCENARIOS.preElection, SCENARIOS.waitingRelease, SCENARIOS.zero]) {
      const board = scoreboardOf(s);
      expect(board.results).toBe(false);
      expect(board.sides.map((side) => [side.pct, side.votes, side.leading])).toEqual([
        [null, null, false],
        [null, null, false],
      ]);
      expect([board.leaderKey, board.tie, board.leadVotes, board.leadPp]).toEqual([null, false, null, null]);
    }
  });

  it("A sempre à esquerda; a liderança muda o destaque, nunca o lado", () => {
    const before = scoreboardOf(SCENARIOS.leadBefore);
    const after = scoreboardOf(SCENARIOS.leadAfter);
    expect(before.sides.map((s) => s.candidate.slot)).toEqual(["a", "b"]);
    expect(after.sides.map((s) => s.candidate.slot)).toEqual(["a", "b"]);
    expect([before.leaderSlot, after.leaderSlot]).toEqual(["a", "b"]);
    expect(after.sides.map((s) => s.leading)).toEqual([false, true]);
    expect(after.leadVotes).toBe(1_000_000);
    expect(after.sides[1].pct).toBeCloseTo((23 / 45) * 100, 6);
  });

  it("empate: ninguém à frente", () => {
    const board = scoreboardOf(SCENARIOS.tie);
    expect(board.tie).toBe(true);
    expect(board.leaderKey).toBeNull();
    expect(board.sides.every((s) => !s.leading)).toBe(true);
  });
});

describe("rotação editorial (rotationOrder, stepUf)", () => {
  const now = Date.parse("2026-10-25T22:40:00Z");

  it("primeiro as UFs com atualização recente, depois as disputas mais apertadas, depois a sequência — sem repetir", () => {
    const states = statesPayload().states.map((s) => {
      if (s.code === "BA") return { ...s, ingestedAt: new Date(now - 10_000).toISOString() };
      if (s.code === "SP") return { ...s, ingestedAt: new Date(now - 30_000).toISOString() };
      return { ...s, ingestedAt: new Date(now - 10 * 60_000).toISOString() };
    });
    const { picks } = rotationOrder(states, { now, count: 6, cursor: 0 });
    expect(picks.slice(0, 2)).toEqual([
      { uf: "BA", reason: "recent" },
      { uf: "SP", reason: "recent" },
    ]);
    // DF está empatado (0 p.p.): é a disputa mais apertada.
    expect(picks[2]).toEqual({ uf: "DF", reason: "close" });
    expect(picks[3].reason).toBe("close");
    expect(picks.slice(4).every((p) => p.reason === "sequence")).toBe(true);
    expect(new Set(picks.map((p) => p.uf)).size).toBe(picks.length);
    // RR não tem votos: nunca entra como "recente" nem como "apertada".
    expect(picks.filter((p) => p.reason !== "sequence").some((p) => p.uf === "RR")).toBe(false);
  });

  it("a sequência circular mostra as 27 UFs ao longo dos ciclos (e nunca o Exterior)", () => {
    const states = [...UFS.map((uf) => territory(uf, UF_NAMES[uf], 0, 0, 0)), territory("ZZ", "Exterior", 0, 0, 0)];
    const seen = new Set<string>();
    let cursor = 0;
    for (let cycle = 0; cycle < 6; cycle++) {
      const result = rotationOrder(states, { now, count: 5, cursor });
      for (const pick of result.picks) {
        expect(pick.reason).toBe("sequence");
        seen.add(pick.uf);
      }
      cursor = result.cursor;
    }
    expect(seen.size).toBe(27);
    expect(seen.has("ZZ")).toBe(false);
  });

  it("respeita as UFs excluídas", () => {
    const { picks } = rotationOrder(statesPayload().states, { now, count: 27, cursor: 0, exclude: ["SP", "RJ"] });
    expect(picks.some((p) => p.uf === "SP" || p.uf === "RJ")).toBe(false);
    expect(picks).toHaveLength(25);
  });

  it("← e → percorrem as siglas em ordem alfabética, com volta", () => {
    const ufs = ["SP", "AC", "BA"];
    expect(stepUf(ufs, null, 1)).toBe("AC");
    expect(stepUf(ufs, null, -1)).toBe("SP");
    expect(stepUf(ufs, "AC", 1)).toBe("BA");
    expect(stepUf(ufs, "AC", -1)).toBe("SP");
    expect(stepUf(ufs, "SP", 1)).toBe("AC");
    expect(stepUf([], null, 1)).toBeNull();
  });
});

describe("ticker (tickerItems)", () => {
  it("pré-apuração: espera e data da eleição; nenhum percentual (nem de seções por UF)", () => {
    const items = texts(SCENARIOS.preElection);
    expect(items).toContain("AGUARDANDO INÍCIO DA TOTALIZAÇÃO");
    expect(items).toContain("ELEIÇÃO • 25 DE OUTUBRO DE 2026");
    expect(items.some((t) => /%/.test(t))).toBe(false);
    expect(items.at(-1)).toBe("FONTE • TSE");
  });

  it("ao vivo: seções totalizadas e as 27 UFs por eleitorado (sem o Exterior)", () => {
    const items = texts(SCENARIOS.half);
    expect(items).toContain("50,00% DAS SEÇÕES TOTALIZADAS");
    const ufItems = items.filter((t) => /^[A-Z]{2} • /.test(t));
    expect(ufItems).toHaveLength(27);
    expect(ufItems.some((t) => t.startsWith("ZZ"))).toBe(false);
    const byElectorate = [...statesPayload().states].sort((x, y) => (y.electorate.total ?? 0) - (x.electorate.total ?? 0)).map((s) => s.code);
    expect(ufItems.map((t) => t.slice(0, 2))).toEqual(byElectorate);
  });

  it("definição matemática só com md = e; final e fonte parada têm o próprio aviso", () => {
    expect(texts(SCENARIOS.mathDefined)[0]).toMatch(/^ELEIÇÃO MATEMATICAMENTE DEFINIDA • SINAL OFICIAL ÀS \d{2}:\d{2}:\d{2}$/);
    expect(texts(SCENARIOS.independentReached).some((t) => t.includes("MATEMATICAMENTE"))).toBe(false);
    expect(texts(SCENARIOS.final)[0]).toBe("RESULTADO FINAL • TOTALIZAÇÃO ENCERRADA PELO TSE");
    expect(texts(SCENARIOS.final).some((t) => t.includes("MATEMATICAMENTE"))).toBe(false);
    expect(tickerItems(SCENARIOS.stale, null, [], []).find((i) => i.id === "stale")).toMatchObject({ text: "AGUARDANDO NOVA ATUALIZAÇÃO OFICIAL", tone: "warn" });
  });

  it("mudanças de liderança: as três últimas, a mais recente primeiro", () => {
    const change = (id: number, leader: string): LeadChange => ({
      id,
      at: `2026-10-25T19:0${id}:00-03:00`,
      detectedAt: `2026-10-25T22:0${id}:01Z`,
      previousLeaderKey: leader === KEY_A ? KEY_B : KEY_A,
      newLeaderKey: leader,
      sectionsPct: 30 + id,
      votes: [],
      leadVotes: 1,
      snapshotVersion: id,
    });
    const items = texts(SCENARIOS.leadAfter, [change(1, KEY_B), change(2, KEY_A), change(3, KEY_B), change(4, KEY_A)]).filter((t) => t.startsWith("MUDANÇA"));
    expect(items).toEqual(["MUDANÇA DE LIDERANÇA • 19:04:00 • CANDIDATO A À FRENTE", "MUDANÇA DE LIDERANÇA • 19:03:00 • CANDIDATO B À FRENTE", "MUDANÇA DE LIDERANÇA • 19:02:00 • CANDIDATO A À FRENTE"]);
  });
});

describe("atalhos (commandForKey)", () => {
  it("F, Esc, Espaço, ←, →, A, R e M", () => {
    const keys: Record<string, string> = {
      f: "toggle-fullscreen",
      F: "toggle-fullscreen",
      Escape: "exit-fullscreen",
      " ": "toggle-pause",
      ArrowLeft: "prev",
      ArrowRight: "next",
      a: "toggle-rotation",
      A: "toggle-rotation",
      r: "national",
      R: "national",
      m: "toggle-controls",
      M: "toggle-controls",
    };
    for (const [key, command] of Object.entries(keys)) expect(commandForKey({ key })).toBe(command);
    expect(commandForKey({ key: "x" })).toBeNull();
  });

  it("nunca sequestra atalho do navegador nem tecla de campo", () => {
    expect(commandForKey({ key: "f", ctrlKey: true })).toBeNull();
    expect(commandForKey({ key: "r", metaKey: true })).toBeNull();
    expect(commandForKey({ key: "ArrowLeft", altKey: true })).toBeNull();
    for (const tag of ["input", "textarea", "select"]) expect(commandForKey({ key: "f", target: document.createElement(tag) })).toBeNull();
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(commandForKey({ key: "r", target: editable })).toBeNull();
    // Num botão, Espaço/Enter ativam o botão; as outras teclas continuam valendo.
    const button = document.createElement("button");
    expect(commandForKey({ key: " ", target: button })).toBeNull();
    expect(commandForKey({ key: "Enter", target: button })).toBeNull();
    expect(commandForKey({ key: "f", target: button })).toBe("toggle-fullscreen");
  });
});

describe("configuração pela URL (parseConfig)", () => {
  const parse = (query: string) => parseConfig(new URLSearchParams(query));

  it("padrão: nacional 25 s, UF 10 s, 5 UFs por ciclo, rotação ligada", () => {
    expect(parse("")).toEqual(DEFAULT_CONFIG);
  });

  it("lê e limita os valores (telão montado sem teclado)", () => {
    expect(parse("nacional=40&estado=8&estados=3&rotacao=0&iniciar=1&efeitos=reduzidos")).toEqual({
      nationalSeconds: 40,
      stateSeconds: 8,
      statesPerCycle: 3,
      rotation: false,
      autostart: true,
      reducedEffects: true,
    });
    expect(parse("nacional=5&estado=1&estados=99")).toMatchObject({ nationalSeconds: 10, stateSeconds: 5, statesPerCycle: 27 });
    expect(parse("nacional=999&estado=abc")).toMatchObject({ nationalSeconds: 120, stateSeconds: DEFAULT_CONFIG.stateSeconds });
  });
});

describe("rota sem a moldura do site (isBareRoute)", () => {
  it("só o modo apresentação abre sem barra lateral, topo e busca global", () => {
    expect(isBareRoute("/apuracao/2026/presidente/segundo-turno/apresentacao")).toBe(true);
    expect(isBareRoute("/apuracao/2026/presidente/segundo-turno")).toBe(false);
    expect(isBareRoute("/apuracao/2026/presidente/segundo-turno/apresentacaoX")).toBe(false);
    expect(isBareRoute(null)).toBe(false);
  });
});

describe("palco", () => {
  const shapes = projectBrazil(ufMesh as unknown as TerritoryCollection);
  const requestFullscreen = vi.fn(async () => undefined);
  const wakeRequest = vi.fn(async () => ({ released: false, release: vi.fn(async () => undefined), addEventListener: vi.fn() }));

  beforeEach(() => {
    requestFullscreen.mockClear();
    wakeRequest.mockClear();
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: requestFullscreen, configurable: true });
    Object.defineProperty(navigator, "wakeLock", { value: { request: wakeRequest }, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(navigator, "wakeLock");
    Reflect.deleteProperty(document, "visibilityState");
  });

  function stage(summary: LiveSummary): LiveStore {
    const store = createLiveStore(initialLiveState(envelope(summary, 10, { phase: summary.phase }), envelope(statesPayload(), 10)), { schedule: (run) => run() });
    render(
      <LiveStoreProvider store={store}>
        <PresentationStage mapShapes={shapes} />
      </LiveStoreProvider>,
    );
    return store;
  }
  const start = () => fireEvent.click(screen.getByTestId("presentation-start"));
  const focusedUf = () => screen.getByTestId("presentation-spotlight").getAttribute("data-uf");

  it("a entrada pede tela cheia e tela sempre ligada; o palco já está com o dado por trás dela", async () => {
    stage(SCENARIOS.half);
    expect(screen.getByTestId("presentation-intro")).toBeTruthy();
    expect(screen.getByTestId("presentation-pct-a").textContent).toBe(pct((40 / 78) * 100));
    start();
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    await waitFor(() => expect(wakeRequest).toHaveBeenCalledWith("screen"));
    await waitFor(() => expect(screen.queryByTestId("presentation-intro")).toBeNull(), { timeout: 2_000 });
  });

  it("atualização do stream entra no commit seguinte: troca de líder sem trocar de lado", () => {
    const store = stage(SCENARIOS.leadBefore);
    expect(screen.getByTestId("presentation-candidate-a").getAttribute("data-lead")).toBe("true");
    const s = SCENARIOS.leadAfter;
    const data = { phase: s.phase, official: s.official, national: s.national, math: s.math, source: s.source, velocity: s.velocity, defined: s.defined };
    act(() => store.dispatch({ type: "national-update", envelope: { data, meta: meta(11) } }));
    expect(screen.getByTestId("presentation-pct-b").textContent).toBe(pct((23 / 45) * 100));
    expect(screen.getByTestId("presentation-candidate-b").getAttribute("data-lead")).toBe("true");
    expect(screen.getByTestId("presentation-candidate-a").getAttribute("data-lead")).toBe("false");
    expect(screen.getByTestId("presentation-advantage").textContent).toContain("CANDIDATO B");
  });

  it("pré-apuração: percentuais ocultos e fora da árvore de acessibilidade, espera oficial, nada ao vivo", () => {
    stage(SCENARIOS.preElection);
    for (const slot of ["a", "b"]) {
      const value = screen.getByTestId(`presentation-pct-${slot}`);
      expect(value.getAttribute("data-empty")).toBe("true");
      expect(value.getAttribute("aria-hidden")).toBe("true");
    }
    expect(screen.getByTestId("presentation-advantage").textContent).toContain("Aguardando início da totalização");
    expect(screen.getByTestId("presentation-status").textContent).toContain("PRÉ-APURAÇÃO");
    expect(screen.getByTestId("presentation-ticker-tag").textContent).not.toContain("AO VIVO");
  });

  it("md = e: banner e selo; a validação independente sozinha não aciona nada", () => {
    stage(SCENARIOS.independentReached);
    expect(screen.queryByTestId("presentation-md-banner")).toBeNull();
    expect(screen.getByTestId("presentation-status").textContent).toContain("AO VIVO");
  });

  it("md = e oficial: banner com o título oficial e o selo ELEIÇÃO DEFINIDA", () => {
    stage(SCENARIOS.mathDefined);
    expect(screen.getByTestId("presentation-md-banner").textContent).toContain(MATH_DEFINED_TITLE);
    expect(screen.getByTestId("presentation-status").textContent).toContain("ELEIÇÃO DEFINIDA");
  });

  it("resultado final: sem AO VIVO no cabeçalho nem no ticker, situação oficial e diferença final", () => {
    stage(SCENARIOS.final);
    expect(screen.getByTestId("presentation-status").textContent).toContain("RESULTADO FINAL");
    expect(screen.getByTestId("presentation-ticker-tag").textContent).toBe("RESULTADO FINAL · TSE");
    expect(screen.getByTestId("presentation-ticker").textContent).not.toContain("AO VIVO");
    expect(screen.getByTestId("presentation-candidate-a").textContent).toContain("ELEITO");
    expect(screen.getByTestId("presentation-advantage").textContent).toContain("DIFERENÇA FINAL");
  });

  it("teclado: → foca a primeira UF, R volta ao nacional; dentro de um campo as teclas são do campo", () => {
    stage(SCENARIOS.half);
    start();
    expect(focusedUf()).toBe("BR");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(focusedUf()).toBe("AC");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(focusedUf()).toBe("AL");
    fireEvent.keyDown(window, { key: "r" });
    expect(focusedUf()).toBe("BR");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(focusedUf()).toBe("BR");
    input.remove();
  });

  it("clique numa UF da faixa põe a UF em foco no painel e no mapa", () => {
    stage(SCENARIOS.half);
    start();
    fireEvent.click(screen.getByTestId("presentation-strip").querySelector('[data-uf="SP"]') as Element);
    expect(focusedUf()).toBe("SP");
    expect(screen.getByTestId("presentation-map").querySelector('[data-uf="SP"][data-selected="true"]')).not.toBeNull();
  });
});
