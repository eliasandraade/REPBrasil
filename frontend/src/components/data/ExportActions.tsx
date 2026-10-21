"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEntitlement } from "@/components/account/PlanGate";
import { accountErrorMessage } from "@/lib/account";
import { useActionFeedback } from "@/motion/feedback";
import { TransitionLink } from "@/motion/navigation";

const LABEL = { idle: "", busy: "Preparando…", done: "Arquivo baixado", error: "" } as const;

/**
 * Botão de exportação que a API autoriza. Sem o plano, o mesmo lugar mostra qual plano libera (ou o caminho para
 * entrar), sem esconder que a exportação existe. A recusa da API (403) também é explicada.
 */
export function ExportAction({ capability, label, run }: Readonly<{ capability: string; label: string; run: () => Promise<void> }>) {
  const gate = useEntitlement(capability);
  const feedback = useActionFeedback();
  const pathname = usePathname() ?? "/";
  const query = useSearchParams()?.toString() ?? "";
  const base = "focus-ring mi-press rounded-md border border-line px-2.5 py-1.5 text-micro font-medium";
  if (gate.allowed === undefined) return null;
  if (!gate.allowed) {
    const here = query ? `${pathname}?${query}` : pathname;
    const href = gate.signedIn ? "/planos" : `/entrar?returnTo=${encodeURIComponent(here)}`;
    return (
      <TransitionLink href={href} className={`${base} text-fg-muted hover:text-fg`} title={gate.description ?? undefined}>
        {label} · {gate.signedIn ? `plano ${gate.planName ?? "pago"}` : "entrar"}
      </TransitionLink>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={() => void feedback.run(run)} disabled={feedback.state === "busy"} className={`${base} text-fg hover:bg-fg/5 disabled:opacity-60`}>
        {LABEL[feedback.state] || label}
      </button>
      <output className="text-micro text-fg-muted">
        {feedback.state === "error" ? (accountErrorMessage(feedback.error) ?? "Não foi possível exportar agora. Tente de novo.") : ""}
      </output>
    </span>
  );
}
