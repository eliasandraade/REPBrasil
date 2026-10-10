"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

/** Leitura direta (fora de React): usada antes de iniciar uma transição. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

/**
 * prefers-reduced-motion como cidadão de primeira classe. No servidor assume
 * `false` (nenhum conteúdo depende de movimento para aparecer: os estados
 * iniciais escondidos só existem no CSS sob `prefers-reduced-motion: no-preference`).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
