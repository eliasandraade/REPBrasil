import type { ReactNode } from "react";

export const FIELD_CONTROL =
  "focus-ring mt-1.5 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-body-sm text-fg disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Campo de formulário: rótulo curto ligado ao controle por `htmlFor` e dica fora do rótulo (via
 * `aria-describedby` no controle), para o nome acessível ser só o rótulo. `hint` é anunciado ao mudar.
 */
export function Field({ id, label, hint, children, className = "" }: Readonly<{ id: string; label: string; hint?: ReactNode; children: ReactNode; className?: string }>) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-body-sm font-medium text-fg">{label}</label>
      {children}
      <p id={`${id}-hint`} className="mt-1 min-h-[1rem] text-micro text-fg-muted" aria-live="polite">{hint}</p>
    </div>
  );
}

export const hintId = (id: string) => `${id}-hint`;
