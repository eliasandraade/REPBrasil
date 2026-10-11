"use client";

import { useEffect } from "react";
import { TransitionLink } from "@/motion/navigation";

/**
 * Falha inesperada ao renderizar uma página. Diz o que aconteceu sem jargão, permite tentar de novo e oferece
 * saída — o detalhe técnico fica no console (para diagnóstico), nunca na tela.
 */
export default function RouteError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="min-h-screen bg-canvas px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-xl" role="alert">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Algo deu errado</p>
        <h1 className="mt-2 text-2xl font-bold text-fg">Não foi possível exibir esta página</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Um erro inesperado interrompeu a página. Os dados não foram alterados. Tente de novo; se continuar, volte ao
          início e informe pela Central de Suporte.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="mi-press focus-ring rounded-lg bg-action px-4 py-2 text-sm font-semibold text-action-fg hover:bg-action/90"
          >
            Tentar de novo
          </button>
          <TransitionLink
            href="/"
            className="mi-press focus-ring rounded-lg border border-line-strong bg-fg/5 px-4 py-2 text-sm font-semibold text-fg-soft hover:border-line-strong"
          >
            Ir para o início
          </TransitionLink>
          <TransitionLink
            href="/suporte"
            className="focus-ring rounded-lg px-4 py-2 text-sm text-fg-muted hover:text-fg-soft"
          >
            Central de Suporte
          </TransitionLink>
        </div>
      </div>
    </main>
  );
}
