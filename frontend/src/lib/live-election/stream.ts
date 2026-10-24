import { fetchStates, fetchSummary, LIVE_STREAM_URL } from "./api";
import type { LiveAction, LiveStore } from "./store";
import type { LiveEnvelope, LiveStatesPayload, LiveStreamEventName, LiveSummary } from "./types";

/**
 * Conexão SSE com o REPBrasil (nunca com o TSE). Regras:
 * - O stream é um acelerador, não a fonte de verdade: ao reconectar, ao voltar do segundo plano (> 20 s) ou ao
 *   voltar a rede, o cliente relê /summary e /states ANTES de confiar nos eventos (nunca depende só dos perdidos).
 * - O EventSource reconecta sozinho (enviando Last-Event-ID); se o navegador desistir (CLOSED), o cliente
 *   reabre com recuo exponencial e jitter.
 * - Evento com versão anterior à vigente é descartado pelo store (atomicidade).
 */

type EventSourceCtor = new (url: string, init?: EventSourceInit) => EventSource;

export interface LiveStreamOptions {
  url?: string;
  EventSourceImpl?: EventSourceCtor;
  loadSummary?: () => Promise<LiveEnvelope<LiveSummary>>;
  loadStates?: () => Promise<LiveEnvelope<LiveStatesPayload>>;
  /** Tempo em segundo plano a partir do qual a volta exige ressincronização. */
  resyncAfterHiddenMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const STREAM_EVENTS: Record<LiveStreamEventName, (envelope: never, force: boolean) => LiveAction> = {
  snapshot: (envelope, force) => ({ type: "summary", envelope, force }),
  "national-update": (envelope) => ({ type: "national-update", envelope }),
  "state-update": (envelope, force) => ({ type: "states", envelope, force }),
  "candidate-update": (envelope) => ({ type: "candidates", envelope }),
  "lead-change": (envelope) => ({ type: "lead-change", envelope }),
  "mathematically-defined": (envelope) => ({ type: "mathematically-defined", envelope }),
  finalized: (envelope) => ({ type: "finalized", envelope }),
  "source-stale": (envelope) => ({ type: "source", envelope }),
  "source-recovered": (envelope) => ({ type: "source", envelope }),
  "timeline-event": (envelope) => ({ type: "timeline-event", envelope }),
};

/** Nomes dos eventos que o cliente escuta (útil para testes e documentação). */
export const LIVE_STREAM_EVENT_NAMES = Object.keys(STREAM_EVENTS) as LiveStreamEventName[];

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export class LiveStreamClient {
  private source: EventSource | null = null;
  /** Prefixo `boot` do último id SSE ("boot:seq"): muda quando o servidor reinicia. */
  private boot: string | null = null;
  /**
   * A primeira releitura substitui o snapshot que veio no HTML (que pode ter saído de um cache de outra época do
   * servidor) — desde que o stream ainda não tenha entregado nada mais novo.
   */
  private firstSync = true;
  private liveApplied = false;
  private forceNext = new Set<LiveStreamEventName>();
  private opened = false;
  private needsResync = false;
  private hiddenAt: number | null = null;
  private attempts = 0;
  private reconnectTimer: unknown = null;
  private syncing: Promise<void> | null = null;
  private stopped = true;
  private readonly opts: Required<Omit<LiveStreamOptions, "EventSourceImpl">> & { EventSourceImpl: EventSourceCtor | undefined };

  constructor(
    private readonly store: LiveStore,
    options: LiveStreamOptions = {},
  ) {
    this.opts = {
      url: options.url ?? LIVE_STREAM_URL,
      EventSourceImpl: options.EventSourceImpl ?? (typeof EventSource === "undefined" ? undefined : EventSource),
      loadSummary: options.loadSummary ?? (() => fetchSummary()),
      loadStates: options.loadStates ?? (() => fetchStates()),
      resyncAfterHiddenMs: options.resyncAfterHiddenMs ?? 20_000,
      now: options.now ?? (() => Date.now()),
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
  }

  start(options?: { resync?: boolean }): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    if (options?.resync) void this.resync();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
    if (this.reconnectTimer !== null) this.opts.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close();
    this.source = null;
  }

  /** Relê o snapshot completo (nacional + UFs). Chamadas simultâneas compartilham a mesma leitura. */
  resync(): Promise<void> {
    this.syncing ??= (async () => {
      try {
        const [summary, states] = await Promise.allSettled([this.opts.loadSummary(), this.opts.loadStates()]);
        const force = this.firstSync && !this.liveApplied;
        if (summary.status === "fulfilled") this.store.dispatch({ type: "summary", envelope: summary.value, force });
        if (states.status === "fulfilled") this.store.dispatch({ type: "states", envelope: states.value, force });
        if (summary.status === "fulfilled") this.firstSync = false;
        if (summary.status === "fulfilled") {
          this.store.dispatch({ type: "synced", at: this.opts.now() });
        } else {
          this.store.dispatch({ type: "sync-error", message: "Não foi possível atualizar agora. Mantendo a última atualização recebida." });
        }
        this.store.flush();
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  private connect(): void {
    if (this.stopped) return;
    const Impl = this.opts.EventSourceImpl;
    if (!Impl) {
      // Sem EventSource (navegador muito antigo): o snapshot inicial continua e a ressincronização periódica
      // fica a cargo da volta do segundo plano.
      this.store.dispatch({ type: "connection", status: "offline" });
      return;
    }
    this.store.dispatch({ type: "connection", status: this.opened ? "reconnecting" : "connecting" });
    const source = new Impl(this.opts.url);
    this.source = source;
    source.onopen = () => {
      const wasReconnect = this.opened || this.needsResync;
      this.opened = true;
      this.needsResync = false;
      this.attempts = 0;
      this.store.dispatch({ type: "connection", status: "open" });
      if (wasReconnect) void this.resync();
    };
    source.onerror = () => {
      this.needsResync = true;
      if (source.readyState === 2 /* CLOSED */) {
        this.scheduleReconnect();
      } else {
        this.store.dispatch({ type: "connection", status: "reconnecting" });
      }
    };
    for (const name of LIVE_STREAM_EVENT_NAMES) {
      source.addEventListener(name, (ev) => this.onStreamEvent(name, ev as MessageEvent<string>));
    }
  }

  private onStreamEvent(name: LiveStreamEventName, ev: MessageEvent<string>): void {
    let envelope: unknown;
    try {
      envelope = JSON.parse(ev.data);
    } catch {
      return; // evento malformado: ignorado; a próxima ressincronização corrige
    }
    if (!envelope || typeof envelope !== "object" || !("meta" in envelope) || !("data" in envelope)) return;
    this.trackBoot(ev.lastEventId);
    if (name === "snapshot" || name === "national-update" || name === "state-update") this.liveApplied = true;
    const force = this.forceNext.delete(name);
    this.store.dispatch(STREAM_EVENTS[name](envelope as never, force));
  }

  /**
   * Servidor reiniciado (outro `boot` no id "boot:seq"): o primeiro snapshot e o primeiro estado das UFs dessa
   * inicialização substituem o vigente mesmo que a versão não seja maior — o servidor novo é a referência.
   */
  private trackBoot(lastEventId: string | undefined): void {
    if (!lastEventId) return;
    const sep = lastEventId.indexOf(":");
    const boot = sep > 0 ? lastEventId.slice(0, sep) : null;
    if (!boot) return;
    if (this.boot !== null && this.boot !== boot) {
      this.forceNext.add("snapshot");
      this.forceNext.add("state-update");
    }
    this.boot = boot;
  }

  private scheduleReconnect(): void {
    this.source?.close();
    this.source = null;
    if (this.stopped) return;
    this.store.dispatch({ type: "connection", status: "reconnecting" });
    const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** this.attempts);
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    this.attempts += 1;
    if (this.reconnectTimer !== null) this.opts.clearTimer(this.reconnectTimer);
    this.reconnectTimer = this.opts.setTimer(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = this.opts.now();
      return;
    }
    const hiddenFor = this.hiddenAt === null ? 0 : this.opts.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (hiddenFor >= this.opts.resyncAfterHiddenMs) {
      void this.resync();
      if (!this.source || this.source.readyState === 2) this.connect();
    }
  };

  private readonly onOnline = () => {
    void this.resync();
    if (!this.source || this.source.readyState === 2) {
      this.attempts = 0;
      this.connect();
    }
  };

  private readonly onOffline = () => {
    this.store.dispatch({ type: "connection", status: "offline" });
  };
}

