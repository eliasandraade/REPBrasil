import type {
  DefinedSnapshot,
  LeadChange,
  LiveCandidate,
  LiveEnvelope,
  LiveMeta,
  LiveStatesPayload,
  LiveStreamEvents,
  LiveSummary,
  LiveTimelineEvent,
  SourceStatus,
} from "./types";

/**
 * Estado da apuração no cliente: um store externo, imutável por fatia, lido com `useSyncExternalStore` e
 * seletores. Cada componente assina só o que usa; uma rajada de eventos SSE vira UMA notificação por quadro
 * (requestAnimationFrame), nunca uma renderização da página inteira por evento.
 *
 * Atomicidade: um snapshot é uma unidade. Envelope com versão menor que a vigente é descartado (nunca se mistura
 * candidato A da versão N com candidato B da N−1); na mesma versão vale o mais recente pelo `publishedAt`.
 */

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "offline";

export interface LiveState {
  summary: LiveSummary | null;
  summaryMeta: LiveMeta | null;
  states: LiveStatesPayload | null;
  statesMeta: LiveMeta | null;
  /** Mudanças de liderança recebidas pelo stream (o histórico completo vem de /timeline). */
  leadChanges: LeadChange[];
  connection: ConnectionStatus;
  /** Relógio do navegador: último evento aplicado e última ressincronização completa. */
  lastEventAt: number | null;
  lastSyncAt: number | null;
  syncError: string | null;
  /** Cresce a cada snapshot nacional aplicado (invalida leituras dependentes, como a linha do tempo). */
  nationalRevision: number;
  /** Cresce a cada atualização de UFs aplicada. */
  statesRevision: number;
}

export type LiveAction =
  /** `force`: snapshot de uma nova inicialização do servidor (outro `boot` no id SSE) — a versão recomeça a valer. */
  | { type: "summary"; envelope: LiveEnvelope<LiveSummary>; force?: boolean }
  | { type: "national-update"; envelope: LiveStreamEvents["national-update"] }
  | { type: "states"; envelope: LiveEnvelope<LiveStatesPayload>; force?: boolean }
  | { type: "candidates"; envelope: LiveEnvelope<{ candidates: LiveCandidate[] }> }
  | { type: "lead-change"; envelope: LiveEnvelope<LeadChange> }
  | { type: "mathematically-defined"; envelope: LiveEnvelope<{ event: LiveTimelineEvent; defined: DefinedSnapshot }> }
  | { type: "finalized"; envelope: LiveEnvelope<{ event: LiveTimelineEvent }> }
  | { type: "source"; envelope: LiveEnvelope<SourceStatus> }
  | { type: "timeline-event"; envelope: LiveEnvelope<LiveTimelineEvent> }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "synced"; at: number }
  | { type: "sync-error"; message: string | null };

const MAX_EVENTS = 200;
const MAX_LEAD_CHANGES = 200;

/** `next` substitui `current`? Versão maior vence; na mesma versão, o mais recente pelo publishedAt. */
export function isNewerMeta(next: LiveMeta, current: LiveMeta | null): boolean {
  if (!current) return true;
  if (next.snapshotVersion !== current.snapshotVersion) return next.snapshotVersion > current.snapshotVersion;
  const a = Date.parse(next.publishedAt);
  const b = Date.parse(current.publishedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return a >= b;
}

/** Evento auxiliar (fonte, marco, candidatos) não pode vir de uma versão anterior à do placar vigente. */
function notOlder(next: LiveMeta, current: LiveMeta | null): boolean {
  return !current || next.snapshotVersion >= current.snapshotVersion;
}

function mergeEvents(list: readonly LiveTimelineEvent[], incoming: LiveTimelineEvent): LiveTimelineEvent[] {
  if (list.some((e) => e.id === incoming.id)) return list as LiveTimelineEvent[];
  const next = [...list, incoming].sort((a, b) => a.id - b.id);
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

export function initialLiveState(summary?: LiveEnvelope<LiveSummary> | null, states?: LiveEnvelope<LiveStatesPayload> | null): LiveState {
  return {
    summary: summary?.data ?? null,
    summaryMeta: summary?.meta ?? null,
    states: states?.data ?? null,
    statesMeta: states?.meta ?? null,
    leadChanges: [],
    connection: "idle",
    lastEventAt: null,
    lastSyncAt: null,
    syncError: null,
    nationalRevision: summary ? 1 : 0,
    statesRevision: states ? 1 : 0,
  };
}

/** Redutor puro (testável sem DOM). */
export function reduceLive(state: LiveState, action: LiveAction, now: number): LiveState {
  switch (action.type) {
    case "summary": {
      if (!action.force && !isNewerMeta(action.envelope.meta, state.summaryMeta)) return state;
      return {
        ...state,
        summary: action.envelope.data,
        summaryMeta: action.envelope.meta,
        nationalRevision: state.nationalRevision + 1,
      };
    }
    case "national-update": {
      const { data, meta } = action.envelope;
      if (!state.summary || !isNewerMeta(meta, state.summaryMeta)) return state;
      return {
        ...state,
        summary: {
          ...state.summary,
          phase: data.phase,
          official: data.official,
          national: data.national,
          math: data.math,
          source: data.source,
          velocity: data.velocity,
          defined: data.defined ?? state.summary.defined,
        },
        summaryMeta: meta,
        lastEventAt: now,
        nationalRevision: state.nationalRevision + 1,
      };
    }
    case "states": {
      if (!action.force && !isNewerMeta(action.envelope.meta, state.statesMeta)) return state;
      return {
        ...state,
        states: action.envelope.data,
        statesMeta: action.envelope.meta,
        lastEventAt: now,
        statesRevision: state.statesRevision + 1,
      };
    }
    case "candidates": {
      if (!state.summary || !notOlder(action.envelope.meta, state.summaryMeta)) return state;
      return { ...state, summary: { ...state.summary, candidates: action.envelope.data.candidates }, lastEventAt: now };
    }
    case "lead-change": {
      const change = action.envelope.data;
      if (state.leadChanges.some((c) => c.id === change.id)) return state;
      const leadChanges = [...state.leadChanges, change].sort((a, b) => a.id - b.id).slice(-MAX_LEAD_CHANGES);
      return { ...state, leadChanges, lastEventAt: now };
    }
    case "mathematically-defined": {
      if (!state.summary) return state;
      const { event, defined } = action.envelope.data;
      const official = state.summary.official.finalTotalization
        ? state.summary.official
        : { ...state.summary.official, mathematicallyDefinedFlag: "e" as const };
      return {
        ...state,
        summary: { ...state.summary, defined, official, events: mergeEvents(state.summary.events, event) },
        lastEventAt: now,
      };
    }
    case "finalized": {
      if (!state.summary) return state;
      return {
        ...state,
        summary: {
          ...state.summary,
          official: { ...state.summary.official, finalTotalization: true },
          events: mergeEvents(state.summary.events, action.envelope.data.event),
        },
        lastEventAt: now,
      };
    }
    case "source": {
      if (!state.summary || !notOlder(action.envelope.meta, state.summaryMeta)) return state;
      return { ...state, summary: { ...state.summary, source: action.envelope.data }, lastEventAt: now };
    }
    case "timeline-event": {
      if (!state.summary) return state;
      const events = mergeEvents(state.summary.events, action.envelope.data);
      if (events === state.summary.events) return state;
      return { ...state, summary: { ...state.summary, events }, lastEventAt: now };
    }
    case "connection":
      return state.connection === action.status ? state : { ...state, connection: action.status };
    case "synced":
      return { ...state, lastSyncAt: action.at, syncError: null };
    case "sync-error":
      return state.syncError === action.message ? state : { ...state, syncError: action.message };
  }
}

export interface LiveStore {
  getState(): LiveState;
  /** Estado inicial (servidor e hidratação). */
  getInitialState(): LiveState;
  subscribe(listener: () => void): () => void;
  /** Enfileira; aplica tudo no próximo quadro e notifica uma vez. */
  dispatch(action: LiveAction): void;
  /** Aplica a fila agora (testes e ressincronização). */
  flush(): void;
}

export type Scheduler = (run: () => void) => void;

const defaultScheduler: Scheduler = (run) => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" && document.visibilityState === "visible") {
    window.requestAnimationFrame(() => run());
    return;
  }
  // Em segundo plano o rAF pausa; os eventos ainda são aplicados (em lote) para a volta não começar defasada.
  setTimeout(run, 50);
};

export function createLiveStore(
  initial: LiveState,
  options?: { schedule?: Scheduler; now?: () => number },
): LiveStore {
  const schedule = options?.schedule ?? defaultScheduler;
  const now = options?.now ?? (() => Date.now());
  let state = initial;
  let queue: LiveAction[] = [];
  let scheduled = false;
  const listeners = new Set<() => void>();

  const flush = () => {
    scheduled = false;
    if (queue.length === 0) return;
    const pending = queue;
    queue = [];
    const t = now();
    let next = state;
    for (const action of pending) next = reduceLive(next, action, t);
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    getState: () => state,
    getInitialState: () => initial,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      queue.push(action);
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    flush,
  };
}
