"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { candidateByKey } from "@/lib/live-election/derive";
import { isOptedIn, notificationsSupported, notifyMathematicallyDefined, optIn, optOut } from "@/lib/live-election/notify";
import { isFinal, showsMathematicalDefinition } from "@/lib/live-election/phase";
import { useLive } from "./LiveContext";

/**
 * Monta o conteúdo só quando chega perto da tela (IntersectionObserver), reservando a altura para não haver
 * salto de layout. Abaixo da dobra, gráficos, tabelas e explorador não custam nada até serem lidos.
 */
export function LazySection({ children, minHeight, rootMargin = "600px 0px", testId }: Readonly<{ children: ReactNode; minHeight: number; rootMargin?: string; testId?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return (
    <div ref={ref} data-testid={testId} style={visible ? undefined : { minHeight }}>
      {visible ? children : <div className="skeleton rounded-2xl" style={{ height: minHeight }} aria-hidden="true" />}
    </div>
  );
}

/** Anúncios para leitor de tela das mudanças de estado relevantes (definição matemática, resultado final). */
export function LiveAnnouncer() {
  const phase = useLive((s) => s.summary?.phase ?? null);
  const summary = useLive((s) => s.summary);
  const [message, setMessage] = useState("");
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!summary) return;
    let next: string | null = null;
    if (isFinal(summary)) next = "Resultado final registrado pelo TSE.";
    else if (showsMathematicalDefinition(summary)) next = "Eleição matematicamente definida segundo os dados oficiais do TSE.";
    if (next && next !== last.current) {
      last.current = next;
      setMessage(next);
    }
  }, [phase, summary]);
  return (
    <p className="sr-only" aria-live="polite" role="status">
      {message}
    </p>
  );
}

/**
 * Alerta opcional quando houver definição matemática (seção 86): a permissão só é pedida após o clique; uma
 * notificação por eleição.
 */
export function NotifyButton() {
  const summary = useLive((s) => s.summary);
  const electionCode = summary?.election.electionCode ?? 0;
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    setSupported(notificationsSupported());
    if (electionCode) setActive(isOptedIn(electionCode));
  }, [electionCode]);

  const defined = summary ? showsMathematicalDefinition(summary) : false;
  useEffect(() => {
    if (!summary || !defined || !active) return;
    const leader = candidateByKey(summary.candidates, summary.defined?.leaderKey ?? summary.national.leaderKey);
    notifyMathematicallyDefined(
      electionCode,
      leader
        ? `Segundo os dados oficiais do TSE, a eleição está matematicamente definida (${leader.ballotName}). Abra o REPBrasil para os números.`
        : "Segundo os dados oficiais do TSE, a eleição está matematicamente definida. Abra o REPBrasil para os números.",
    );
  }, [summary, defined, active, electionCode]);

  if (!summary || !supported || isFinal(summary) || defined) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-body-sm">
      <button
        type="button"
        aria-pressed={active}
        onClick={async () => {
          if (active) {
            optOut(electionCode);
            setActive(false);
            return;
          }
          const permission = await optIn(electionCode);
          setActive(permission === "granted");
          setDenied(permission === "denied");
        }}
        className="focus-ring rounded-lg border border-line bg-surface px-3 py-1.5 font-medium text-fg-soft hover:bg-subtle"
      >
        {active ? "Alerta de definição matemática ativado" : "Receber alerta quando houver definição matemática"}
      </button>
      {denied ? <span className="text-micro text-fg-muted">As notificações estão bloqueadas neste navegador.</span> : null}
    </div>
  );
}
