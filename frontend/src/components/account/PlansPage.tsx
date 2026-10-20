"use client";

import { useQuery } from "@tanstack/react-query";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { getPlans } from "@/lib/plans";
import { useAccount } from "@/lib/useAccount";
import { BillingNote } from "./PlanSection";
import { PlanComparison, PublicBaseline } from "./PlanComparison";

/** /planos: princípio (o dado público é de todos), comparação lida do catálogo da API e estado real da cobrança. */
export function PlansPage() {
  const catalog = useQuery({ queryKey: ["plans"], queryFn: getPlans, staleTime: 5 * 60_000 });
  const { data: me } = useAccount();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8">
      <header className="max-w-3xl">
        <p className="text-label uppercase text-fg-muted">Planos</p>
        <h1 className="mt-2 text-heading-lg text-fg">O dado público é de todos. Os planos acrescentam profundidade.</h1>
        <p className="mt-4 text-body-md leading-relaxed text-fg-soft">
          Consultar, comparar e conferir a fonte de qualquer dado continua gratuito. Os planos pagos acrescentam espaço para acompanhar
          mais coisas, alertas de novas edições oficiais e ferramentas de uso profissional, e sustentam o projeto.
        </p>
      </header>

      <div className="mt-10">
        {catalog.isPending && <DataState kind="loading" title="Carregando os planos" height="h-96" />}
        {catalog.isError && <DataState kind="error" title="Não foi possível carregar os planos" action={<RetryButton onRetry={() => void catalog.refetch()} />} />}
        {catalog.isSuccess && (
          <>
            <PlanComparison catalog={catalog.data} currentPlan={me?.plan ?? null} />
            <BillingNote available={catalog.data.billing.available} message={catalog.data.billing.message} />
            <div className="mt-12 border-t border-line pt-8">
              <PublicBaseline items={catalog.data.baseline} />
            </div>
          </>
        )}
      </div>

      <p className="mt-12 text-body-sm text-fg-muted">
        {me ? (
          <TransitionLink href="/conta/plano" className="focus-ring mi-underline rounded text-accent-text">Ver o plano da sua conta</TransitionLink>
        ) : (
          <>
            Sem conta, tudo o que é público continua aberto.{" "}
            <TransitionLink href="/entrar?returnTo=/planos" className="focus-ring mi-underline rounded text-accent-text">Entrar</TransitionLink> cria a
            conta gratuita na hora, sem senha.
          </>
        )}
      </p>
    </main>
  );
}
