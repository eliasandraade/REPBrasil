import { ApiError } from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveStore, initialLiveState, isNewerMeta, reduceLive, type LiveAction, type LiveState } from "@/lib/live-election/store";
import { LiveStreamClient } from "@/lib/live-election/stream";
import type { LiveEnvelope, LiveStatesPayload, LiveSummary } from "@/lib/live-election/types";
import { envelope, KEY_B, meta, SCENARIOS, statesPayload } from "./fixtures/live-election";

const T = 1_000;

function state(summary = SCENARIOS.half, version = 10): LiveState {
  return initialLiveState(envelope(summary, version), envelope(statesPayload(), version));
}

function nationalUpdate(summary: LiveSummary, version: number, publishedAt?: string): LiveAction {
  const { election: _e, candidates: _c, events: _ev, ...rest } = summary;
  return { type: "national-update", envelope: { data: rest, meta: meta(version, publishedAt ? { publishedAt } : {}) } };
}

describe("store: atomicidade por versão do snapshot", () => {
  it("aplica versão maior e descarta versão menor (nunca mistura N com N−1)", () => {
    const s0 = state(SCENARIOS.half, 10);
    const s1 = reduceLive(s0, nationalUpdate(SCENARIOS.ninetyNine, 11), T);
    expect(s1.summary?.national.sections.totalizedPct).toBe(99.987654);
    expect(s1.summaryMeta?.snapshotVersion).toBe(11);
    const s2 = reduceLive(s1, nationalUpdate(SCENARIOS.fivePct, 9), T);
    expect(s2).toBe(s1);
    expect(s2.summary?.national.sections.totalizedPct).toBe(99.987654);
  });

  it("na mesma versão vale o mais recente pelo publishedAt", () => {
    const a = meta(5, { publishedAt: "2026-10-25T22:30:10Z" });
    expect(isNewerMeta(meta(5, { publishedAt: "2026-10-25T22:30:11Z" }), a)).toBe(true);
    expect(isNewerMeta(meta(5, { publishedAt: "2026-10-25T22:30:09Z" }), a)).toBe(false);
    expect(isNewerMeta(meta(4), a)).toBe(false);
    expect(isNewerMeta(meta(6), null)).toBe(true);
  });

  it("UFs também respeitam a versão", () => {
    const s0 = state(SCENARIOS.half, 10);
    const older: LiveEnvelope<LiveStatesPayload> = envelope({ ...statesPayload(), states: [] }, 9);
    expect(reduceLive(s0, { type: "states", envelope: older }, T)).toBe(s0);
    const newer = envelope({ ...statesPayload(), states: [] }, 11);
    expect(reduceLive(s0, { type: "states", envelope: newer }, T).states?.states).toEqual([]);
  });

  it("fonte defasada mantém o último snapshot (nunca zera)", () => {
    const s0 = state(SCENARIOS.half, 10);
    const stale = reduceLive(s0, { type: "source", envelope: envelope({ ...SCENARIOS.stale.source }, 10) }, T);
    expect(stale.summary?.source.stale).toBe(true);
    expect(stale.summary?.national).toBe(s0.summary?.national);
  });

  it("md=e liga a bandeira e registra o marco uma vez só", () => {
    const s0 = state(SCENARIOS.mdN, 10);
    const event = { id: 50, type: "mathematically-defined" as const, at: "2026-10-25T19:02:13-03:00", detectedAt: "2026-10-25T22:02:14Z", title: "Resultado matematicamente definido", detail: null, sectionsPct: 92 };
    const defined = SCENARIOS.mathDefined.defined!;
    const action: LiveAction = { type: "mathematically-defined", envelope: envelope({ event, defined }, 10) };
    const s1 = reduceLive(s0, action, T);
    const s2 = reduceLive(s1, action, T);
    expect(s1.summary?.official.mathematicallyDefinedFlag).toBe("e");
    expect(s2.summary?.events.filter((e) => e.id === 50)).toHaveLength(1);
  });

  it("troca de liderança entra uma vez por id", () => {
    const s0 = state();
    const change = { id: 7, at: "2026-10-25T19:07:14-03:00", detectedAt: "2026-10-25T22:07:15Z", previousLeaderKey: null, newLeaderKey: KEY_B, sectionsPct: 35, votes: [], leadVotes: 1_000_000, snapshotVersion: 11 };
    const s1 = reduceLive(s0, { type: "lead-change", envelope: envelope(change, 11) }, T);
    const s2 = reduceLive(s1, { type: "lead-change", envelope: envelope(change, 11) }, T);
    expect(s2.leadChanges).toHaveLength(1);
  });

  it("lote: vários eventos viram UMA notificação", () => {
    let scheduled: (() => void) | null = null;
    const store = createLiveStore(state(), { schedule: (run) => (scheduled = run) });
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(nationalUpdate(SCENARIOS.fivePct, 11));
    store.dispatch(nationalUpdate(SCENARIOS.half, 12));
    store.dispatch({ type: "connection", status: "open" });
    expect(listener).not.toHaveBeenCalled();
    (scheduled as unknown as () => void)();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().summaryMeta?.snapshotVersion).toBe(12);
    expect(store.getState().connection).toBe("open");
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  emit(name: string, data: unknown, lastEventId = "") {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data), lastEventId } as MessageEvent<string>);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail(closed = false) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.();
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.restoreAllMocks();
});

function setup(initial = state()) {
  const store = createLiveStore(initial, { schedule: (run) => run() });
  const loadSummary = vi.fn(async () => envelope(SCENARIOS.ninetyNine, 20));
  const loadStates = vi.fn(async () => envelope(statesPayload(), 20));
  let now = 0;
  const timers: (() => void)[] = [];
  const client = new LiveStreamClient(store, {
    url: "http://api.test/stream",
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    loadSummary,
    loadStates,
    now: () => now,
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { store, client, loadSummary, loadStates, timers, advance: (ms: number) => (now += ms) };
}

describe("stream SSE", () => {
  it("aplica eventos do stream e ignora versão antiga", () => {
    const { store, client } = setup();
    client.start();
    const es = FakeEventSource.instances[0];
    es.open();
    const { election: _e, candidates: _c, events: _ev, ...rest } = SCENARIOS.ninetyNine;
    es.emit("national-update", { data: rest, meta: meta(11) });
    expect(store.getState().summary?.national.sections.totalizedPct).toBe(99.987654);
    const { election: _e2, candidates: _c2, events: _ev2, ...old } = SCENARIOS.fivePct;
    es.emit("national-update", { data: old, meta: meta(3) });
    expect(store.getState().summary?.national.sections.totalizedPct).toBe(99.987654);
    client.stop();
  });

  it("servidor reiniciado (outro boot no id): o snapshot novo vale mesmo com versão menor", () => {
    const { store, client } = setup();
    client.start();
    const es = FakeEventSource.instances[0];
    es.open();
    es.emit("snapshot", envelope(SCENARIOS.ninetyNine, 500), "b1:10");
    expect(store.getState().summaryMeta?.snapshotVersion).toBe(500);
    es.emit("snapshot", envelope(SCENARIOS.fivePct, 400), "b1:11");
    expect(store.getState().summaryMeta?.snapshotVersion).toBe(500);
    es.emit("snapshot", envelope(SCENARIOS.fivePct, 3), "b2:1");
    expect(store.getState().summaryMeta?.snapshotVersion).toBe(3);
    expect(store.getState().summary?.national.sections.totalizedPct).toBe(5);
    client.stop();
  });

  it("ao reconectar, relê o snapshot completo antes de confiar no stream", async () => {
    const { store, client, loadSummary, loadStates } = setup();
    client.start();
    const es = FakeEventSource.instances[0];
    es.open();
    expect(loadSummary).not.toHaveBeenCalled();
    es.fail();
    expect(store.getState().connection).toBe("reconnecting");
    es.open();
    await vi.waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1));
    expect(loadStates).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(store.getState().summaryMeta?.snapshotVersion).toBe(20));
    expect(store.getState().lastSyncAt).not.toBeNull();
    client.stop();
  });

  it("conexão fechada pelo navegador: reabre com recuo e ressincroniza", async () => {
    const { client, timers, loadSummary } = setup();
    client.start();
    FakeEventSource.instances[0].open();
    FakeEventSource.instances[0].fail(true);
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1].open();
    await vi.waitFor(() => expect(loadSummary).toHaveBeenCalled());
    client.stop();
  });

  it("stream recusado seguidamente (limite de conexões): os dados seguem pelo REST a cada tentativa", async () => {
    const { client, timers, loadSummary, loadStates } = setup();
    client.start();
    FakeEventSource.instances[0].fail(true); // 1ª recusa: só reagenda
    expect(loadSummary).not.toHaveBeenCalled();
    timers[0]();
    FakeEventSource.instances[1].fail(true); // 2ª recusa seguida: relê pelo REST
    await vi.waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1));
    expect(loadStates).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0)); // a releitura anterior termina antes da próxima falha
    timers[1]();
    FakeEventSource.instances[2].fail(true);
    await vi.waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2));
    client.stop();
  });

  it("apuração desligada (404) e sem snapshot: marca indisponível e tenta de novo sozinha", async () => {
    const { store, client, loadSummary, timers } = setup(initialLiveState(null, null));
    loadSummary.mockRejectedValue(new ApiError(404, "API error 404: /summary"));
    client.start({ resync: true });
    await vi.waitFor(() => expect(store.getState().syncStatus).toBe(404));
    expect(store.getState().summary).toBeNull();
    // Uma releitura agendada (o stream também responde 404 e não abre).
    const retry = timers.at(-1)!;
    loadSummary.mockResolvedValue(envelope(SCENARIOS.ninetyNine, 21));
    retry();
    await vi.waitFor(() => expect(store.getState().summary).not.toBeNull());
    expect(store.getState().syncStatus).toBeNull();
    client.stop();
  });

  it("volta do segundo plano após mais de 20 s: ressincroniza", async () => {
    const { client, loadSummary, advance } = setup();
    client.start();
    FakeEventSource.instances[0].open();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    advance(25_000);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(1));
    client.stop();
  });

  it("volta rápida do segundo plano não refaz a leitura", () => {
    const { client, loadSummary, advance } = setup();
    client.start();
    FakeEventSource.instances[0].open();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    advance(3_000);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(loadSummary).not.toHaveBeenCalled();
    client.stop();
  });

  it("primeira releitura substitui o HTML em cache (mesmo com versão menor), se o stream ainda não entregou nada", async () => {
    const { store, client, loadSummary } = setup(state(SCENARIOS.half, 900));
    loadSummary.mockResolvedValueOnce(envelope(SCENARIOS.ninetyNine, 7));
    client.start({ resync: true });
    await vi.waitFor(() => expect(store.getState().summaryMeta?.snapshotVersion).toBe(7));
    // releituras seguintes voltam a respeitar a versão
    loadSummary.mockResolvedValueOnce(envelope(SCENARIOS.fivePct, 5));
    await client.resync();
    expect(store.getState().summaryMeta?.snapshotVersion).toBe(7);
    client.stop();
  });

  it("primeira releitura não volta atrás se o stream já entregou um snapshot mais novo", async () => {
    const { store, client, loadSummary } = setup(state(SCENARIOS.half, 10));
    let release: (v: ReturnType<typeof envelope<LiveSummary>>) => void = () => undefined;
    loadSummary.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    client.start({ resync: true });
    const es = FakeEventSource.instances[0];
    es.open();
    es.emit("snapshot", envelope(SCENARIOS.ninetyNine, 30), "b1:1");
    release(envelope(SCENARIOS.fivePct, 20));
    await vi.waitFor(() => expect(store.getState().lastSyncAt).not.toBeNull());
    expect(store.getState().summaryMeta?.snapshotVersion).toBe(30);
    client.stop();
  });

  it("falha na releitura mantém a última atualização e avisa", async () => {
    const { store, client, loadSummary } = setup();
    loadSummary.mockRejectedValueOnce(new Error("timeout"));
    client.start({ resync: true });
    await vi.waitFor(() => expect(store.getState().syncError).not.toBeNull());
    expect(store.getState().summary?.national.sections.totalizedPct).toBe(50);
    client.stop();
  });
});
