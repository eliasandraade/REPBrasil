"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { commandForKey, rotationOrder, stepUf, type PresentationCommand, type PresentationConfig, type RotationPick, type RotationReason } from "@/lib/live-election/presentation";
import type { TerritoryResult } from "@/lib/live-election/types";

/** Tela cheia (Fullscreen API). Negada ou sem suporte: a apresentação segue no viewport, nunca trava. */
export function useFullscreen() {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof document.documentElement.requestFullscreen === "function");
    const sync = () => setActive(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const enter = useCallback(async () => {
    const el = document.documentElement;
    if (typeof el.requestFullscreen !== "function" || document.fullscreenElement) return;
    try {
      await el.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // sem gesto, política do navegador ou recusa: continua no viewport
    }
  }, []);
  const exit = useCallback(async () => {
    if (!document.fullscreenElement || typeof document.exitFullscreen !== "function") return;
    try {
      await document.exitFullscreen();
    } catch {
      // já saiu
    }
  }, []);
  const toggle = useCallback(() => (document.fullscreenElement ? exit() : enter()), [enter, exit]);
  return { active, supported, enter, exit, toggle };
}

type WakeLockStatus = "idle" | "active" | "released" | "unsupported";

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

/**
 * Tela sempre ligada (Screen Wake Lock) depois do gesto inicial. O navegador solta o bloqueio quando a aba sai
 * de vista; ao voltar a ficar visível, ele é pedido de novo (o que a API permite). Sem suporte: segue normal.
 */
export function useWakeLock(enabled: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>("idle");
  useEffect(() => {
    if (!enabled) return;
    const api = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!api) {
      setStatus("unsupported");
      return;
    }
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await api.request("screen");
        if (disposed) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        setStatus("active");
        sentinel.addEventListener("release", () => {
          if (!disposed) setStatus("released");
        });
      } catch {
        setStatus("released");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [enabled]);
  return status;
}

/** Ociosidade (cursor e controles somem). Qualquer movimento, toque ou tecla devolve; sem render por movimento. */
export function useIdle(timeoutMs: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setIdle(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), timeoutMs);
    };
    wake();
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, timeoutMs]);
  return idle;
}

/**
 * Paralaxe de alguns pixels pelo mouse: grava --pm-px/--pm-py (−1…1) no palco, no máximo uma vez por quadro e
 * sem estado React. Os números quase não se mexem (o CSS limita cada plano).
 */
export function useParallax(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reset = () => {
      el.style.setProperty("--pm-px", "0");
      el.style.setProperty("--pm-py", "0");
    };
    if (!enabled) {
      reset();
      return;
    }
    let frame = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = (e.clientX / window.innerWidth) * 2 - 1;
      y = (e.clientY / window.innerHeight) * 2 - 1;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty("--pm-px", x.toFixed(3));
        el.style.setProperty("--pm-py", y.toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      reset();
    };
  }, [ref, enabled]);
}

/**
 * Aparelho lento? Mede os quadros por 4 s logo após a entrada; abaixo de 32 fps a apresentação passa a efeitos
 * reduzidos (perspectiva, paralaxe, luz e cenas saem; dados, mapa e hierarquia ficam). Mede uma vez só.
 */
export function useFrameBudget(enabled: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let start = 0;
    let frames = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      frames += 1;
      if (t - start >= 4000) {
        if ((frames * 1000) / (t - start) < 32) setSlow(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const delay = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, 1500);
    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return slow;
}

/** Atalhos globais (F, Esc, Espaço, ←, →, A, R, M), só depois da entrada. */
export function usePresentationKeys(enabled: boolean, onCommand: (command: PresentationCommand) => void) {
  const handler = useRef(onCommand);
  useEffect(() => {
    handler.current = onCommand;
  }, [onCommand]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const command = commandForKey(e);
      if (!command) return;
      e.preventDefault();
      handler.current(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export type PresentationView = { kind: "national" } | { kind: "state"; uf: string; reason: RotationReason | "manual" };

/**
 * Rotação editorial: visão nacional → algumas UFs → nacional. A ordem vem de `rotationOrder` (mudança recente,
 * disputa apertada, sequência por eleitorado). Pausar congela a vista; retomar recomeça o tempo dela.
 */
export function useRotation({
  states,
  ufs,
  config,
  enabled,
  paused,
}: Readonly<{ states: readonly TerritoryResult[]; ufs: readonly string[]; config: PresentationConfig; enabled: boolean; paused: boolean }>) {
  const [view, setView] = useState<PresentationView>({ kind: "national" });
  const [startedAt, setStartedAt] = useState(0);
  const statesRef = useRef(states);
  const queue = useRef<RotationPick[]>([]);
  const cursor = useRef(0);
  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const show = useCallback((next: PresentationView) => {
    setView(next);
    setStartedAt(Date.now());
  }, []);
  const dwellMs = (view.kind === "national" ? config.nationalSeconds : config.stateSeconds) * 1000;

  // Retomar (ou ligar a rotação) recomeça o tempo da vista atual.
  useEffect(() => {
    if (enabled && !paused) setStartedAt(Date.now());
  }, [enabled, paused]);

  useEffect(() => {
    if (!enabled || paused || startedAt === 0) return;
    const id = setTimeout(() => {
      if (view.kind === "national") {
        const { picks, cursor: next } = rotationOrder(statesRef.current, { now: Date.now(), count: config.statesPerCycle, cursor: cursor.current });
        cursor.current = next;
        queue.current = picks;
      }
      const pick = queue.current.shift();
      show(pick ? { kind: "state", uf: pick.uf, reason: pick.reason } : { kind: "national" });
    }, Math.max(0, startedAt + dwellMs - Date.now()));
    return () => clearTimeout(id);
  }, [enabled, paused, view, startedAt, dwellMs, config.statesPerCycle, show]);

  const goNational = useCallback(() => {
    queue.current = [];
    show({ kind: "national" });
  }, [show]);
  const select = useCallback((uf: string) => show({ kind: "state", uf: uf.toUpperCase(), reason: "manual" }), [show]);
  const step = useCallback(
    (delta: number) => {
      const current = view.kind === "state" ? view.uf : null;
      const next = stepUf(ufs, current, delta);
      if (next) show({ kind: "state", uf: next, reason: "manual" });
    },
    [view, ufs, show],
  );
  return { view, startedAt, dwellMs, goNational, select, step };
}
