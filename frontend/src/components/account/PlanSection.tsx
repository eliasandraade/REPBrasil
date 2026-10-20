"use client";

import { useQuery } from "@tanstack/react-query";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { getEntitlements } from "@/lib/account";
import {
  ALERTS_LIMIT,
  FAVORITES_LIMIT,
  getPlans,
  PLAN_NAME,
  PLAN_SOURCE_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  WATCHLIST_LIMIT,
} from "@/lib/plans";
import { accountKeys, useAccount } from "@/lib/useAccount";
import { PlanComparison } from "./PlanComparison";
import { UsageMeter } from "./UsageMeter";
import { formatDate } from "./format";

/** Plano da conta: o que vale agora, de onde vem, uso dos limites e a comparação com os outros planos. */
export function PlanSection() {
  const { data: me } = useAccount();
  const catalog = useQuery({ queryKey: ["plans"], queryFn: getPlans, staleTime: 5 * 60_000 });
  const grants = useQuery({ queryKey: accountKeys.entitlements, queryFn: getEntitlements, enabled: !!me });
  if (!me) return null;

  const subscription = me.subscription;
  const manual = (grants.data ?? []).filter((grant) => grant.key !== "api.daily_quota");
  return (
    <div className="space-y-12">
      <section aria-labelledby="plan-current" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 id="plan-current" className="text-label uppercase text-fg-muted">Plano atual</h2>
          <p className="mt-3 text-heading-md text-fg">{PLAN_NAME[me.plan]}</p>
          <p className="mt-1 text-body-sm text-fg-muted">Vale {PLAN_SOURCE_LABEL[me.planSource]}.</p>
          {subscription && (
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-body-sm">
              <dt className="text-fg-muted">Assinatura</dt>
              <dd className="text-fg">{PLAN_NAME[subscription.plan]} · {SUBSCRIPTION_STATUS_LABEL[subscription.status]}</dd>
              {subscription.currentPeriodEnd && (
                <>
                  <dt className="text-fg-muted">{subscription.active ? "Vale até" : "Terminou em"}</dt>
                  <dd className="text-fg">{formatDate(subscription.currentPeriodEnd)}</dd>
                </>
              )}
              {subscription.status === "past_due" && (
                <dd className="col-span-2 text-warn">O pagamento está pendente; o plano continua valendo até o fim do período.</dd>
              )}
            </dl>
          )}
          {manual.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-body-sm text-fg-muted">Concessões da administração em vigor:</p>
              <ul className="mt-2 space-y-1 text-body-sm text-fg-soft">
                {manual.map((grant) => (
                  <li key={`${grant.key}:${grant.source}`}>
                    <code className="text-micro">{grant.key}</code> = {grant.value}
                    {grant.expiresAt && <span className="text-fg-muted"> · até {formatDate(grant.expiresAt)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-5">
          <h3 className="text-label uppercase text-fg-muted">Uso dos limites</h3>
          <UsageMeter label="Favoritos" used={me.usage.favorites} max={me.limits[FAVORITES_LIMIT] ?? 0} />
          <UsageMeter label="Watchlist" used={me.usage.watchlist} max={me.limits[WATCHLIST_LIMIT] ?? 0} />
          <UsageMeter label="Alertas" used={me.usage.alerts} max={me.limits[ALERTS_LIMIT] ?? 0} />
          <p className="text-micro text-fg-muted">Se um limite diminuir, nada do que você salvou é apagado; só novos itens param de entrar.</p>
        </div>
      </section>

      <section aria-labelledby="plan-compare">
        <h2 id="plan-compare" className="text-label uppercase text-fg-muted">Comparação</h2>
        <div className="mt-4">
          {catalog.isPending && <DataState kind="loading" title="Carregando os planos" height="h-64" />}
          {catalog.isError && !catalog.data && <DataState kind="error" title="Não foi possível carregar os planos" action={<RetryButton onRetry={() => void catalog.refetch()} />} />}
          {catalog.data && (
            <>
              <PlanComparison catalog={catalog.data} currentPlan={me.plan} />
              <BillingNote available={catalog.data.billing.available} message={catalog.data.billing.message} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** Estado real da cobrança: sem provedor, diz isso e oferece o canal humano; nunca um botão que não cobra. */
export function BillingNote({ available, message }: Readonly<{ available: boolean; message: string | null }>) {
  if (available) return null;
  return (
    <p className="mt-6 border-l-2 border-warn pl-3 text-body-sm text-fg-soft" role="note">
      {message ?? "Pagamento online ainda não disponível."} Para acesso antecipado ou uso institucional, fale com a equipe pelo{" "}
      <TransitionLink href="/suporte" className="focus-ring mi-underline rounded text-accent-text">suporte</TransitionLink>.
    </p>
  );
}
