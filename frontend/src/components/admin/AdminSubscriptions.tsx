"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDate } from "@/components/account/format";
import { Field, FIELD_CONTROL } from "@/components/account/Field";
import { TransitionLink } from "@/motion/navigation";
import { adminApi } from "@/lib/admin";
import { PLAN_NAME, SUBSCRIPTION_STATUS_LABEL } from "@/lib/plans";

const TH = "border-b border-line py-2 pr-4 text-left text-micro font-semibold uppercase tracking-wide text-fg-muted";
const TD = "border-b border-line py-2.5 pr-4 align-top text-body-sm";

/** Assinaturas (manuais enquanto não há provedor), com o que vale agora e o que precisa de atenção. */
export function AdminSubscriptions() {
  const [status, setStatus] = useState("");
  const rows = useQuery({ queryKey: ["admin", "subscriptions", status], queryFn: () => adminApi.subscriptions(status) });
  const now = Date.now();
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-body-sm text-fg-muted">
        Sem provedor de pagamento, toda assinatura é registro manual feito no detalhe da conta. Período vencido com status ativo aparece
        destacado: a conta já não tem o plano.
      </p>
      <Field id="admin-subs-status" label="Status" className="max-w-xs">
        <select id="admin-subs-status" className={FIELD_CONTROL} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(SUBSCRIPTION_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {rows.isPending && <DataState kind="loading" title="Carregando assinaturas" height="h-48" />}
      {rows.isError && !rows.data && <DataState kind="error" title="Não foi possível carregar as assinaturas" action={<RetryButton onRetry={() => void rows.refetch()} />} />}
      {rows.data && rows.data.length === 0 && <p className="text-body-sm text-fg-muted">Nenhuma assinatura{status ? " com esse status" : ""}.</p>}
      {rows.data && rows.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <caption className="sr-only">Assinaturas</caption>
            <thead><tr><th className={TH}>Conta</th><th className={TH}>Plano</th><th className={TH}>Status</th><th className={TH}>Fim do período</th><th className={TH}>Vale agora</th><th className={TH}>Observação</th></tr></thead>
            <tbody>
              {rows.data.map((s) => {
                const lapsed = (s.status === "active" || s.status === "past_due") && s.currentPeriodEnd !== null && Date.parse(s.currentPeriodEnd) <= now;
                return (
                  <tr key={s.id}>
                    <td className={TD}><TransitionLink href={`/admin/contas/${s.userId}`} className="focus-ring mi-underline rounded text-fg">{s.email}</TransitionLink></td>
                    <td className={TD}>{PLAN_NAME[s.plan]}</td>
                    <td className={TD}>{SUBSCRIPTION_STATUS_LABEL[s.status]}</td>
                    <td className={`${TD} ${lapsed ? "text-warn" : ""}`}>{s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}{lapsed && " (vencido)"}</td>
                    <td className={TD}>{s.countsNow ? "Sim" : "Não"}</td>
                    <td className={`${TD} text-fg-muted`}>{s.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
