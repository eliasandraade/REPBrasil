"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { type CandidateColor, slotColors } from "@/lib/live-election/candidate-colors";
import type { LiveState, LiveStore } from "@/lib/live-election/store";

const LiveStoreContext = createContext<LiveStore | null>(null);

export function LiveStoreProvider({ store, children }: Readonly<{ store: LiveStore; children: ReactNode }>) {
  return <LiveStoreContext.Provider value={store}>{children}</LiveStoreContext.Provider>;
}

export function useLiveStore(): LiveStore {
  const store = useContext(LiveStoreContext);
  if (!store) throw new Error("useLiveStore fora de LiveStoreProvider");
  return store;
}

/**
 * Lê uma fatia do estado. O seletor deve devolver uma referência que já existe no estado (ou um primitivo):
 * o componente só renderiza de novo quando ESSA fatia muda.
 */
export function useLive<T>(selector: (state: LiveState) => T): T {
  const store = useLiveStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getInitialState()),
  );
}

/**
 * Cor que o slot A veste (o B veste a outra), pelo NÚMERO da candidatura: vai em `data-live-slot-a` na raiz
 * da página e do Modo Apresentação, e o CSS troca --live-a/--live-b quando o 22 estiver no slot A.
 */
export function useSlotAColor(): CandidateColor {
  return useLive((s) => slotColors(s.summary?.candidates ?? []).a);
}

/**
 * Relógio da página para tempos relativos ("há 12 s"), atualizado em intervalo fixo. `null` até a montagem:
 * servidor e primeira renderização do cliente mostram o mesmo texto (sem divergência de hidratação).
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Realce temporário de um valor que mudou (classe `live-flash` por ~1,2 s). Não dispara na montagem: só quando
 * um valor oficial novo substitui o anterior. O valor aparece pronto — nada conta de um número ao outro.
 */
export function useChangeFlash(value: unknown, durationMs = 1200): boolean {
  const previous = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), durationMs);
    return () => clearTimeout(id);
  }, [value, durationMs]);
  return flash;
}
