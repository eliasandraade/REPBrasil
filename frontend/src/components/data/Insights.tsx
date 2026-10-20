"use client";

import type { CSSProperties } from "react";
import { Reveal } from "@/motion/reveal";

/**
 * Leitura rápida: frases curtas, calculadas dos dados exibidos, para quem não quer ler coeficientes. Entram em
 * sequência quando o recorte muda (texto que se apresenta pronto, sem digitação simulada).
 */
export function Insights({ title = "Leitura rápida", sentences, contextKey }: Readonly<{ title?: string; sentences: string[]; contextKey: string }>) {
  if (sentences.length === 0) return null;
  return (
    <section aria-labelledby="insights-title" className="rounded-xl border border-line bg-surface p-4" data-testid="insights">
      <h2 id="insights-title" className="font-semibold text-fg">{title}</h2>
      <Reveal key={contextKey} as="ul" className="mt-2 space-y-2 text-body-sm leading-6 text-fg-soft">
        {sentences.map((sentence, index) => (
          <li key={sentence} className="reveal-unfold flex gap-2" style={{ "--i": index } as CSSProperties}>
            <span aria-hidden="true" className="mt-2.5 h-1 w-1 flex-shrink-0 rounded-full bg-fg-muted" />
            <span>{sentence}</span>
          </li>
        ))}
      </Reveal>
    </section>
  );
}

/** O que uma associação entre territórios significa e o que ela não prova. Sempre visível junto da correlação. */
export function CausalityNote({ territorial }: Readonly<{ territorial?: boolean }>) {
  return (
    <div className="grid gap-3 rounded-lg border border-line bg-subtle/40 p-3 text-body-sm sm:grid-cols-2" data-testid="causality-caveat">
      <div>
        <p className="font-semibold text-fg">O que isso mostra</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg-soft">
          <li>Como os dois valores variam juntos entre os municípios observados.</li>
          <li>Uma pista para investigar, com fonte e período explícitos.</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold text-fg">Correlação não implica causalidade</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg-soft">
          <li>Não mostra que um valor cause o outro.</li>
          {territorial && <li>É leitura por município, não por pessoa: não diz como cada pessoa votou.</li>}
          {!territorial && <li>Não vale automaticamente para cada pessoa do município.</li>}
          <li>Não vale automaticamente para outros períodos ou UFs.</li>
        </ul>
      </div>
    </div>
  );
}
