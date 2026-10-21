"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDateTime } from "@/components/account/format";
import { Field, FIELD_CONTROL } from "@/components/account/Field";
import { adminApi, SUPPORT_CATEGORY_LABEL, SUPPORT_STATUS_LABEL, type SupportRequestRow } from "@/lib/admin";
import { useAccount } from "@/lib/useAccount";

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** Caixa de suporte: pedidos reais enviados por /suporte, com troca de status auditada. */
export function AdminSupport() {
  const { data: me } = useAccount();
  const client = useQueryClient();
  const [status, setStatus] = useState("novo");
  const [failed, setFailed] = useState(false);
  const rows = useQuery({ queryKey: ["admin", "support", status], queryFn: () => adminApi.support(status) });

  async function change(id: string, next: SupportRequestRow["status"]) {
    if (!me) return;
    setFailed(false);
    try {
      await adminApi.supportStatus(me, id, next);
      await client.invalidateQueries({ queryKey: ["admin", "support"] });
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-5">
      <Field id="admin-support-status" label="Status" className="max-w-xs">
        <select id="admin-support-status" className={FIELD_CONTROL} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(SUPPORT_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {failed && <p role="alert" className="text-body-sm text-danger">Não foi possível mudar o status agora.</p>}
      {rows.isPending && <DataState kind="loading" title="Carregando pedidos" height="h-48" />}
      {rows.isError && !rows.data && <DataState kind="error" title="Não foi possível carregar os pedidos" action={<RetryButton onRetry={() => void rows.refetch()} />} />}
      {rows.data && rows.data.length === 0 && <p className="text-body-sm text-fg-muted">Nenhum pedido{status ? ` ${SUPPORT_STATUS_LABEL[status as SupportRequestRow["status"]]?.toLowerCase()}` : ""}.</p>}
      {rows.data && rows.data.length > 0 && (
        <ol className="divide-y divide-line border-y border-line">
          {rows.data.map((row) => (
            <li key={row.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <article aria-labelledby={`support-${row.id}`}>
                <h3 id={`support-${row.id}`} className="text-body-sm font-semibold text-fg">
                  {SUPPORT_CATEGORY_LABEL[row.category] ?? row.category} · {row.name ?? "Sem nome"} &lt;{row.email}&gt;
                </h3>
                <p className="mt-0.5 text-micro text-fg-muted">
                  {formatDateTime(row.createdAt)} · protocolo {row.id.slice(0, 8)}{row.userId && " · enviado com conta"}
                  {row.organization && ` · ${row.organization}`}
                </p>
                {row.relatedSubject && <p className="mt-2 text-body-sm text-fg-soft">Assunto: {row.relatedSubject}</p>}
                <p className="mt-2 whitespace-pre-line text-body-sm text-fg">{row.message}</p>
                {row.sourceReference && (
                  <p className="mt-2 break-words text-body-sm text-fg-soft">
                    Fonte:{" "}
                    {isHttpUrl(row.sourceReference) ? (
                      <a href={row.sourceReference} target="_blank" rel="noopener noreferrer nofollow" className="focus-ring rounded underline underline-offset-2">{row.sourceReference}</a>
                    ) : row.sourceReference}
                  </p>
                )}
              </article>
              <Field id={`support-status-${row.id}`} label="Status">
                <select id={`support-status-${row.id}`} className={FIELD_CONTROL} value={row.status}
                  onChange={(e) => void change(row.id, e.target.value as SupportRequestRow["status"])}>
                  {Object.entries(SUPPORT_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
