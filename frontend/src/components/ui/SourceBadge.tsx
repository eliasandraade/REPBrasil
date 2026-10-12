"use client";

import { useId, useState } from "react";

export interface SourceDetail {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
  /** Texto completo (ex.: hash) quando o valor exibido é abreviado. */
  title?: string;
}

/**
 * Selo de fonte, igual em todas as telas: "Fonte: TSE · Boletim de Urna (Dados Abertos)" e, sob demanda, a
 * proveniência (arquivo, impressão digital SHA-256, data, linha). Quem publica e o que é vêm sempre visíveis.
 */
export function SourceBadge({
  publisher,
  dataset,
  details = [],
  testId,
}: Readonly<{ publisher: string; dataset: string; details?: SourceDetail[]; testId?: string }>) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="rounded-lg border border-white/[0.08] bg-card/60 px-3 py-2 text-[11px] text-slate-500" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span>
          Fonte: <span className="text-slate-300">{publisher}</span> · {dataset}
        </span>
        {details.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className="focus-ring rounded text-brand underline-offset-2 hover:underline"
          >
            {open ? "ocultar" : "proveniência"}
          </button>
        )}
      </div>
      {open && (
        <dl id={panelId} className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {details.map((d) => (
            <div key={d.label} className="contents">
              <dt>{d.label}</dt>
              <dd className={`min-w-0 break-all text-slate-300 ${d.mono ? "font-mono" : ""}`} title={d.title}>
                {d.href ? (
                  <a href={d.href} className="hover:text-brand" rel="noopener noreferrer" target="_blank">
                    {d.value}
                  </a>
                ) : (
                  d.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
