"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { getPlans, type PlansCatalog } from "@/lib/plans";
import { useAccount } from "@/lib/useAccount";
import { TransitionLink } from "@/motion/navigation";

/** Menor plano que inclui o recurso, lido do catálogo da API (nunca uma regra própria da interface). */
export function minimumPlanWith(catalog: PlansCatalog | undefined, capability: string) {
  return catalog?.plans.filter((plan) => plan.features[capability]).sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/**
 * Estado de um recurso pago para a conta atual. `allowed` é `undefined` enquanto a conta carrega. A interface só
 * esconde o controle; quem decide é a API (403 com o plano mínimo).
 */
export function useEntitlement(capability: string) {
  const { data: me } = useAccount();
  const catalog = useQuery({ queryKey: ["plans"], queryFn: getPlans, staleTime: 5 * 60_000 });
  const plan = minimumPlanWith(catalog.data, capability);
  const definition = catalog.data?.capabilities.find((c) => c.key === capability) ?? null;
  return {
    allowed: me === undefined ? undefined : me?.capabilities[capability] === true,
    signedIn: !!me,
    planName: plan?.name ?? null,
    label: definition?.label ?? null,
    description: definition?.description ?? null,
  };
}

/**
 * Explica, sem esconder dado, o que uma ferramenta paga faz e qual plano a libera. Para quem não entrou, o
 * caminho é entrar e voltar ao mesmo recorte.
 */
export function PlanGateNote({ capability, className = "" }: Readonly<{ capability: string; className?: string }>) {
  const gate = useEntitlement(capability);
  const pathname = usePathname() ?? "/";
  const query = useSearchParams()?.toString() ?? "";
  const returnTo = query ? `${pathname}?${query}` : pathname;
  if (gate.allowed !== false) return null;
  return (
    <div className={`rounded-lg border border-line bg-subtle/40 px-3 py-2.5 text-body-sm ${className}`} data-testid={`plan-gate-${capability}`}>
      <p className="text-fg">
        <span className="font-semibold">{gate.label ?? "Recurso de plano pago"}</span>
        {gate.planName && <span className="text-fg-muted"> · plano {gate.planName}</span>}
      </p>
      {gate.description && <p className="mt-0.5 text-fg-muted">{gate.description}</p>}
      <p className="mt-1.5">
        {gate.signedIn ? (
          <TransitionLink href="/planos" className="focus-ring mi-underline rounded font-medium text-accent-text">Ver planos</TransitionLink>
        ) : (
          <TransitionLink href={`/entrar?returnTo=${encodeURIComponent(returnTo)}`} className="focus-ring mi-underline rounded font-medium text-accent-text">
            Entrar para usar
          </TransitionLink>
        )}
      </p>
    </div>
  );
}
