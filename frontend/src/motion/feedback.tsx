"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Retorno de estado sem espetáculo (docs/MOTION_SYSTEM.md §8):
 * - `SwapValue`: um valor oficial que muda de contexto entra pronto, subindo por trás de uma máscara
 *   (`.value-swap` em motion.css). Nunca conta de um número ao outro.
 * - `useActionFeedback`: ação curta (baixar um arquivo) passa por "em andamento" → "concluído" (volta ao repouso
 *   sozinho) ou "erro" (fica até a próxima ação); quem usa mostra o estado no botão e num aviso `aria-live`.
 */

export function SwapValue({ swapKey, className, children }: Readonly<{ swapKey: string; className?: string; children: ReactNode }>) {
  return (
    <span key={swapKey} className={`value-swap inline-block${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}

export type ActionState = "idle" | "busy" | "done" | "error";

const SETTLE_MS = 2400;

export function useActionFeedback() {
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (timer.current) clearTimeout(timer.current);
    setState("busy");
    setError(null);
    try {
      await action();
      setState("done");
      timer.current = setTimeout(() => setState("idle"), SETTLE_MS);
    } catch (e) {
      // o erro fica visível até a próxima ação: a explicação (ex.: plano necessário) precisa ser lida
      setError(e);
      setState("error");
    }
  }, []);

  return { state, error, run };
}
