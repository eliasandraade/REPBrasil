"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDateTime } from "@/components/account/format";
import { Field, FIELD_CONTROL } from "@/components/account/Field";
import { TransitionLink } from "@/motion/navigation";
import { adminApi, AUDIT_ACTION_LABEL, type AuditEntry } from "@/lib/admin";

/** Valor de antes/depois em texto curto e estável (as chaves vêm do servidor, sem segredo). */
function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ") || "—";
}

/** Linhas da auditoria: quem, o quê, sobre quem, antes → depois, quando. */
export function AuditList({ entries, empty }: Readonly<{ entries: AuditEntry[]; empty: string }>) {
  if (entries.length === 0) return <p className="text-body-sm text-fg-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-line border-y border-line">
      {entries.map((entry) => (
        <li key={entry.id} className="grid gap-1 py-3 text-body-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <time dateTime={entry.createdAt} className="text-micro text-fg-muted">{formatDateTime(entry.createdAt)}</time>
          <div className="min-w-0">
            <p className="text-fg">
              <strong className="font-semibold">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</strong>
              {entry.targetLabel && (
                <> · {entry.targetUserId ? (
                  <TransitionLink href={`/admin/contas/${entry.targetUserId}`} className="focus-ring mi-underline rounded">{entry.targetLabel}</TransitionLink>
                ) : entry.targetLabel}</>
              )}
            </p>
            <p className="mt-0.5 break-words text-micro text-fg-muted">
              <span className="text-fg-soft">antes</span> {show(entry.before)} <span aria-hidden="true">→</span>{" "}
              <span className="text-fg-soft">depois</span> {show(entry.after)}
            </p>
            <p className="mt-0.5 text-micro text-fg-muted">por {entry.actorEmail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Trilha de auditoria administrativa (só inserção no banco), filtrável por ação, paginada. */
export function AdminAudit() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/admin/auditoria";
  const query = new URLSearchParams(search.toString());
  const audit = useQuery({ queryKey: ["admin", "audit", query.toString()], queryFn: () => adminApi.audit(query), placeholderData: keepPreviousData });
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const page = audit.data?.page ?? 1;
  const pages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <Field id="admin-audit-action" label="Ação" className="max-w-xs">
        <select id="admin-audit-action" className={FIELD_CONTROL} value={search.get("action") ?? ""} onChange={(e) => set("action", e.target.value || null)}>
          <option value="">Todas</option>
          {Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {audit.isPending && <DataState kind="loading" title="Carregando a auditoria" height="h-64" />}
      {audit.isError && !audit.data && <DataState kind="error" title="Não foi possível carregar a auditoria" action={<RetryButton onRetry={() => void audit.refetch()} />} />}
      {audit.data && (
        <>
          <p className="text-body-sm text-fg-muted">{audit.data.total.toLocaleString("pt-BR")} {audit.data.total === 1 ? "registro" : "registros"}. A trilha não aceita edição nem exclusão.</p>
          <AuditList entries={audit.data.items} empty="Nenhum registro com esse filtro." />
          {pages > 1 && (
            <nav aria-label="Páginas da auditoria" className="flex items-center gap-3 text-body-sm">
              <button type="button" disabled={page <= 1} onClick={() => set("page", String(page - 1))} className="focus-ring rounded-md border border-line px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <span className="tabular-nums text-fg-muted">Página {page} de {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => set("page", String(page + 1))} className="focus-ring rounded-md border border-line px-3 py-1.5 disabled:opacity-40">Próxima</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
