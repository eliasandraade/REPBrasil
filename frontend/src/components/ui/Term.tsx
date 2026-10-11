"use client";

import { useId, useRef, type ReactNode } from "react";
import { GLOSSARY, type GlossaryId } from "@/lib/glossary";

/**
 * Termo com explicação: botão (alcançável por teclado e toque) com dica ligada por aria-describedby.
 * Aparece com hover ou foco (padrão .mi-hint do sistema de motion); Esc fecha. Não usar dentro de outro botão/link.
 */
export function Term({ id, children }: Readonly<{ id: GlossaryId; children?: ReactNode }>) {
  const entry = GLOSSARY[id];
  const tipId = useId();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="mi-hint-host relative inline-block">
      <button
        ref={ref}
        type="button"
        aria-describedby={tipId}
        onKeyDown={(e) => e.key === "Escape" && ref.current?.blur()}
        data-term={id}
        className="focus-ring cursor-help rounded underline decoration-fg-muted decoration-dotted underline-offset-2"
      >
        {children ?? entry.term}
      </button>
      <span
        role="tooltip"
        id={tipId}
        className="mi-hint pointer-events-none absolute bottom-full left-0 z-40 mb-1.5 w-64 max-w-[80vw] rounded-md border border-line bg-subtle px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-fg-soft shadow-card"
      >
        <span className="block font-semibold text-fg">{entry.term}</span>
        {entry.short}
      </span>
    </span>
  );
}
