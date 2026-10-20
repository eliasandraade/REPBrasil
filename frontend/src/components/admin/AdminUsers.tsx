"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDate, formatDateTime } from "@/components/account/format";
import { Field, FIELD_CONTROL } from "@/components/account/Field";
import { TransitionLink } from "@/motion/navigation";
import { adminApi } from "@/lib/admin";
import { PLAN_NAME } from "@/lib/plans";

const TH = "border-b border-line py-2 pr-4 text-left text-micro font-semibold uppercase tracking-wide text-fg-muted";
const TD = "border-b border-line py-2.5 pr-4 align-top text-body-sm";
const SORTS = [
  { value: "created", label: "Criação" },
  { value: "lastSeen", label: "Último acesso" },
  { value: "email", label: "E-mail" },
  { value: "plan", label: "Plano" },
] as const;

/** Lista de contas: busca, filtros e ordenação na URL (link direto), paginação servida pela API. */
export function AdminUsers() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/admin/contas";
  const query = new URLSearchParams(search.toString());
  if (!query.get("pageSize")) query.set("pageSize", "25");
  const users = useQuery({ queryKey: ["admin", "users", query.toString()], queryFn: () => adminApi.users(query), placeholderData: keepPreviousData });
  const [text, setText] = useState(search.get("q") ?? "");

  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in updates)) next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    set({ q: text.trim() || null });
  }

  const page = users.data?.page ?? 1;
  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.pageSize)) : 1;
  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex flex-wrap items-start gap-4" role="search" aria-label="Buscar contas">
        <Field id="admin-users-q" label="E-mail ou nome" className="min-w-[16rem] flex-1">
          <div className="flex gap-2">
            <input id="admin-users-q" type="search" className={FIELD_CONTROL} value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="focus-ring mt-1.5 rounded-lg border border-line px-3 text-body-sm font-medium text-fg hover:bg-fg/[0.04]">Buscar</button>
          </div>
        </Field>
        <Field id="admin-users-plan" className="w-40" label="Plano">
          <select id="admin-users-plan" className={FIELD_CONTROL} value={search.get("plan") ?? ""} onChange={(e) => set({ plan: e.target.value || null })}>
            <option value="">Todos</option>
            {Object.entries(PLAN_NAME).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Field>
        <Field id="admin-users-role" className="w-40" label="Papel">
          <select id="admin-users-role" className={FIELD_CONTROL} value={search.get("role") ?? ""} onChange={(e) => set({ role: e.target.value || null })}>
            <option value="">Todos</option>
            <option value="user">Conta comum</option>
            <option value="superadmin">Super Admin</option>
          </select>
        </Field>
        <Field id="admin-users-status" className="w-40" label="Status">
          <select id="admin-users-status" className={FIELD_CONTROL} value={search.get("status") ?? ""} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">Todos</option>
            <option value="active">Ativa</option>
            <option value="suspended">Suspensa</option>
          </select>
        </Field>
        <Field id="admin-users-sort" className="w-56" label="Ordenar por">
          <div className="flex gap-2">
            <select id="admin-users-sort" className={FIELD_CONTROL} value={search.get("sort") ?? "created"} onChange={(e) => set({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button type="button" onClick={() => set({ dir: search.get("dir") === "asc" ? "desc" : "asc" })}
              className="focus-ring mt-1.5 rounded-lg border border-line px-3 text-body-sm text-fg hover:bg-fg/[0.04]"
              aria-label={search.get("dir") === "asc" ? "Ordem crescente; mudar para decrescente" : "Ordem decrescente; mudar para crescente"}>
              {search.get("dir") === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </Field>
      </form>

      {users.isPending && <DataState kind="loading" title="Carregando contas" height="h-64" />}
      {users.isError && !users.data && <DataState kind="error" title="Não foi possível carregar as contas" action={<RetryButton onRetry={() => void users.refetch()} />} />}
      {users.data && (
        <>
          <p className="text-body-sm text-fg-muted" aria-live="polite">
            {users.data.total.toLocaleString("pt-BR")} {users.data.total === 1 ? "conta" : "contas"}
            {users.data.truncated && " (consulta limitada às 5.000 mais recentes; refine a busca)"}
          </p>
          {users.data.items.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhuma conta com esses filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <caption className="sr-only">Contas do REPBrasil</caption>
                <thead>
                  <tr><th className={TH}>Conta</th><th className={TH}>Status</th><th className={TH}>Plano</th><th className={TH}>Papel</th><th className={TH}>Criada</th><th className={TH}>Último acesso</th></tr>
                </thead>
                <tbody>
                  {users.data.items.map((user) => (
                    <tr key={user.id}>
                      <td className={TD}>
                        <TransitionLink href={`/admin/contas/${user.id}`} className="focus-ring mi-underline rounded font-medium text-fg">{user.email}</TransitionLink>
                        {user.displayName && <span className="block text-micro text-fg-muted">{user.displayName}</span>}
                      </td>
                      <td className={`${TD} ${user.status === "suspended" ? "text-danger" : "text-fg-soft"}`}>{user.status === "suspended" ? "Suspensa" : "Ativa"}</td>
                      <td className={TD}>{PLAN_NAME[user.plan]}</td>
                      <td className={TD}>{user.role === "superadmin" ? `Super Admin${user.configuredSuperadmin ? " (configuração)" : ""}` : "Conta comum"}</td>
                      <td className={TD}>{formatDate(user.createdAt)}</td>
                      <td className={TD}>{user.lastSeenAt ? formatDateTime(user.lastSeenAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav aria-label="Páginas de contas" className="flex items-center gap-3 text-body-sm">
              <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}
                className="focus-ring rounded-md border border-line px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <span className="tabular-nums text-fg-muted">Página {page} de {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}
                className="focus-ring rounded-md border border-line px-3 py-1.5 disabled:opacity-40">Próxima</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
