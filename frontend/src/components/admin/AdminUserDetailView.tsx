"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDate, formatDateTime, USAGE_TYPE_LABEL } from "@/components/account/format";
import { Field, FIELD_CONTROL } from "@/components/account/Field";
import { TransitionLink } from "@/motion/navigation";
import { accountErrorMessage, type PlanCode, type SubscriptionStatus } from "@/lib/account";
import { adminApi, type AdminUserDetail } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { getPlans, PLAN_NAME, PLAN_SOURCE_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@/lib/plans";
import { ufName } from "@/lib/site";
import { useAccount } from "@/lib/useAccount";
import { AuditList } from "./AdminAudit";
import { ConfirmDialog } from "./ConfirmDialog";

type Action =
  | { kind: "suspend" }
  | { kind: "reactivate" }
  | { kind: "role"; role: "user" | "superadmin" }
  | { kind: "plan" }
  | { kind: "grant" }
  | { kind: "revoke"; key: string }
  | { kind: "subscription" };

const toIso = (date: string) => (date ? new Date(`${date}T23:59:59-03:00`).toISOString() : null);

/** Detalhe da conta e ações administrativas, cada uma confirmada e auditada no servidor. */
export function AdminUserDetailView({ id }: Readonly<{ id: string }>) {
  const { data: me } = useAccount();
  const client = useQueryClient();
  const user = useQuery({ queryKey: ["admin", "user", id], queryFn: () => adminApi.user(id) });
  const catalog = useQuery({ queryKey: ["plans"], queryFn: getPlans, staleTime: 5 * 60_000 });
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "status"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<PlanCode>("ADVANCED");
  const [until, setUntil] = useState("");
  const [grantKey, setGrantKey] = useState("");
  const [grantValue, setGrantValue] = useState("");
  const [subscription, setSubscription] = useState<{ plan: PlanCode; status: SubscriptionStatus; end: string; notes: string }>({
    plan: "ADVANCED", status: "active", end: "", notes: "",
  });

  if (!user.data) {
    if (!user.isError) return <DataState kind="loading" title="Carregando a conta" height="h-96" />;
    if (user.error instanceof ApiError && user.error.status === 404) return <DataState kind="empty" title="Conta não encontrada" />;
    return <DataState kind="error" title="Não foi possível carregar a conta" action={<RetryButton onRetry={() => void user.refetch()} />} />;
  }
  const data = user.data;
  const self = me?.id === data.id;

  async function confirm() {
    if (!me || !action) return;
    setBusy(true);
    setMessage(null);
    try {
      const run: Record<Action["kind"], () => Promise<AdminUserDetail>> = {
        suspend: () => adminApi.suspend(me, id, reason.trim() || null),
        reactivate: () => adminApi.reactivate(me, id),
        role: () => adminApi.role(me, id, (action as Extract<Action, { kind: "role" }>).role),
        plan: () => adminApi.plan(me, id, plan, plan === "FREE" ? null : toIso(until)),
        grant: () => adminApi.grant(me, id, grantKey, grantValue, toIso(until)),
        revoke: () => adminApi.revoke(me, id, (action as Extract<Action, { kind: "revoke" }>).key),
        subscription: () => adminApi.subscription(me, id, {
          plan: subscription.plan, status: subscription.status, currentPeriodEnd: toIso(subscription.end), notes: subscription.notes.trim() || null,
        }),
      };
      const updated = await run[action.kind]();
      client.setQueryData(["admin", "user", id], updated);
      await client.invalidateQueries({ queryKey: ["admin", "users"] });
      setMessage({ tone: "status", text: "Alteração aplicada e registrada na auditoria." });
      setAction(null);
    } catch (error) {
      setMessage({ tone: "error", text: accountErrorMessage(error) ?? "Não foi possível aplicar a alteração." });
      setAction(null);
    } finally {
      setBusy(false);
    }
  }

  const open = (next: Action) => {
    setUntil("");
    setMessage(null);
    setAction(next);
  };
  const grantable = catalog.data?.capabilities ?? [];
  const selectedCapability = grantable.find((c) => c.key === grantKey);
  return (
    <div className="space-y-10">
      <p className="text-body-sm">
        <TransitionLink href="/admin/contas" className="focus-ring mi-underline rounded text-accent-text">← Contas</TransitionLink>
      </p>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-heading-md text-fg">{data.email}</h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {data.displayName ?? data.fullName ?? "Sem nome"} · criada em {formatDate(data.createdAt)} · último acesso{" "}
            {data.lastSeenAt ? formatDateTime(data.lastSeenAt) : "—"} · {data.activeSessions} {data.activeSessions === 1 ? "sessão aberta" : "sessões abertas"}
          </p>
          <p className="mt-1 text-body-sm text-fg-muted">Login: {data.providers.length ? data.providers.map((p) => (p === "google" ? "Google" : "link por e-mail")).join(", ") : "—"}</p>
        </div>
        <p className={`text-body-sm font-semibold ${data.status === "suspended" ? "text-danger" : "text-positive"}`}>
          {data.status === "suspended" ? `Suspensa${data.disabledAt ? ` desde ${formatDate(data.disabledAt)}` : ""}` : "Ativa"}
        </p>
      </header>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-body-sm ${message.tone === "error" ? "text-danger" : "text-fg-soft"}`}>{message.text}</p>
      )}
      {data.status === "suspended" && data.disabledReason && <p className="border-l-2 border-danger pl-3 text-body-sm text-fg-soft">Motivo: {data.disabledReason}</p>}

      <section className="grid gap-8 border-t border-line pt-5 lg:grid-cols-3">
        <div>
          <h3 className="text-label uppercase text-fg-muted">Acesso efetivo</h3>
          <p className="mt-2 text-heading-sm text-fg">{PLAN_NAME[data.access.plan]}</p>
          <p className="text-body-sm text-fg-muted">Vale {PLAN_SOURCE_LABEL[data.access.planSource]}.</p>
          <p className="mt-2 text-body-sm text-fg-soft">Papel: {data.access.role === "superadmin" ? `Super Admin${data.configuredSuperadmin ? " (configuração do servidor)" : ""}` : "conta comum"}</p>
        </div>
        <div>
          <h3 className="text-label uppercase text-fg-muted">Perfil</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
            <dt className="text-fg-muted">Território</dt>
            <dd className="text-fg">{data.stateCode ? `${data.municipalityName ? `${data.municipalityName}, ` : ""}${ufName(data.stateCode)}` : "—"}</dd>
            <dt className="text-fg-muted">Uso</dt>
            <dd className="text-fg">{data.usageType ? USAGE_TYPE_LABEL[data.usageType] ?? data.usageType : "—"}</dd>
          </dl>
        </div>
        <div>
          <h3 className="text-label uppercase text-fg-muted">Uso</h3>
          <p className="mt-2 text-body-sm text-fg-soft">
            {data.usage.favorites} favoritos · {data.usage.watchlist} na watchlist · {data.usage.alerts} alertas · {data.usage.unreadNotifications} notificações não lidas
          </p>
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="text-label uppercase text-fg-muted">Ações</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.status === "active" ? (
            <button type="button" disabled={self} onClick={() => open({ kind: "suspend" })} className="focus-ring rounded-lg border border-danger px-3 py-2 text-body-sm font-medium text-danger disabled:opacity-40">Suspender</button>
          ) : (
            <button type="button" onClick={() => open({ kind: "reactivate" })} className="focus-ring rounded-lg border border-line px-3 py-2 text-body-sm font-medium text-fg">Reativar</button>
          )}
          {data.access.role === "superadmin" ? (
            <button type="button" disabled={self || data.configuredSuperadmin} onClick={() => open({ kind: "role", role: "user" })} className="focus-ring rounded-lg border border-line px-3 py-2 text-body-sm font-medium text-fg disabled:opacity-40">Remover Super Admin</button>
          ) : (
            <button type="button" onClick={() => open({ kind: "role", role: "superadmin" })} className="focus-ring rounded-lg border border-line px-3 py-2 text-body-sm font-medium text-fg">Tornar Super Admin</button>
          )}
          <button type="button" onClick={() => open({ kind: "plan" })} className="focus-ring rounded-lg border border-line px-3 py-2 text-body-sm font-medium text-fg">Plano manual</button>
          <button type="button" onClick={() => open({ kind: "grant" })} className="focus-ring rounded-lg border border-line px-3 py-2 text-body-sm font-medium text-fg">Conceder recurso ou limite</button>
          <button type="button" onClick={() => open({ kind: "subscription" })} className="focus-ring rounded-lg border border-line px-3 py-2 text-body-sm font-medium text-fg">Assinatura manual</button>
        </div>
        {self && <p className="mt-2 text-micro text-fg-muted">Ações de suspensão e papel não valem para a sua própria conta.</p>}
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="text-label uppercase text-fg-muted">Concessões em vigor</h3>
        {data.entitlements.length === 0 ? <p className="mt-2 text-body-sm text-fg-muted">Nenhuma.</p> : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {data.entitlements.map((grant) => (
              <li key={`${grant.key}:${grant.source}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm">
                <span><code className="text-micro">{grant.key}</code> = {grant.value} <span className="text-micro text-fg-muted">· fonte {grant.source}{grant.expiresAt ? ` · até ${formatDate(grant.expiresAt)}` : ""}</span></span>
                {grant.source === "admin" && grant.key !== "account.role" && grant.key !== "plan" && (
                  <button type="button" onClick={() => open({ kind: "revoke", key: grant.key })} className="focus-ring rounded-md px-2 py-1 text-micro text-fg-muted hover:text-fg">Revogar</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="text-label uppercase text-fg-muted">Assinaturas</h3>
        {data.subscriptions.length === 0 ? <p className="mt-2 text-body-sm text-fg-muted">Nenhuma.</p> : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="py-2 text-body-sm">
                {PLAN_NAME[s.plan]} · {SUBSCRIPTION_STATUS_LABEL[s.status]} · {s.provider}
                {s.currentPeriodEnd && ` · período até ${formatDate(s.currentPeriodEnd)}`}
                {s.countsNow ? " · vale agora" : " · não vale agora"}
                {s.notes && <span className="block text-micro text-fg-muted">{s.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="text-label uppercase text-fg-muted">Histórico administrativo</h3>
        <div className="mt-2"><AuditList entries={data.audit} empty="Nenhuma ação administrativa sobre esta conta." /></div>
      </section>

      <ConfirmDialog open={action?.kind === "suspend"} title="Suspender esta conta?" confirmLabel="Suspender" tone="danger" busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <p>As sessões abertas são encerradas e novos logins são recusados, por qualquer provedor. Os dados da conta ficam preservados.</p>
        <Field id="admin-suspend-reason" label="Motivo (registrado na auditoria)">
          <input id="admin-suspend-reason" className={FIELD_CONTROL} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={action?.kind === "reactivate"} title="Reativar esta conta?" confirmLabel="Reativar" busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <p>A pessoa volta a poder entrar. Sessões encerradas na suspensão não voltam.</p>
      </ConfirmDialog>
      <ConfirmDialog open={action?.kind === "role"} title={action?.kind === "role" && action.role === "superadmin" ? "Tornar esta conta Super Admin?" : "Remover o papel de Super Admin?"}
        confirmLabel="Confirmar" tone={action?.kind === "role" && action.role === "superadmin" ? "danger" : "default"} busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <p>{action?.kind === "role" && action.role === "superadmin"
          ? "Super Admin vê todas as contas, a auditoria e o diagnóstico, e pode alterar planos e papéis."
          : "A conta perde o acesso à administração. O servidor recusa se ela for o último Super Admin."}</p>
      </ConfirmDialog>
      <ConfirmDialog open={action?.kind === "plan"} title="Plano manual" confirmLabel="Aplicar plano" busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <p>Concessão da administração, sem cobrança. O plano efetivo é o maior entre esta concessão e uma assinatura viva.</p>
        <Field id="admin-plan" label="Plano">
          <select id="admin-plan" className={FIELD_CONTROL} value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
            {Object.entries(PLAN_NAME).map(([code, name]) => <option key={code} value={code}>{code === "FREE" ? "Gratuito (remove a concessão)" : name}</option>)}
          </select>
        </Field>
        {plan !== "FREE" && (
          <Field id="admin-plan-until" label="Válido até (opcional)">
            <input id="admin-plan-until" type="date" className={FIELD_CONTROL} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={action?.kind === "grant"} title="Conceder recurso ou limite" confirmLabel="Conceder" busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <Field id="admin-grant-key" label="Capability do catálogo">
          <select id="admin-grant-key" className={FIELD_CONTROL} value={grantKey} onChange={(e) => { setGrantKey(e.target.value); setGrantValue(""); }}>
            <option value="">Escolha</option>
            {grantable.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
            <option value="api.daily_quota">Quota diária da API legada (api.daily_quota)</option>
          </select>
        </Field>
        <Field id="admin-grant-value" label={selectedCapability?.kind === "feature" ? "Valor (true libera, false bloqueia)" : "Valor (inteiro)"}>
          {selectedCapability?.kind === "feature" ? (
            <select id="admin-grant-value" className={FIELD_CONTROL} value={grantValue} onChange={(e) => setGrantValue(e.target.value)}>
              <option value="">Escolha</option><option value="true">true</option><option value="false">false</option>
            </select>
          ) : (
            <input id="admin-grant-value" inputMode="numeric" className={FIELD_CONTROL} value={grantValue} onChange={(e) => setGrantValue(e.target.value)} />
          )}
        </Field>
        <Field id="admin-grant-until" label="Válido até (opcional)">
          <input id="admin-grant-until" type="date" className={FIELD_CONTROL} value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={action?.kind === "revoke"} title="Revogar esta concessão?" confirmLabel="Revogar" busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <p>A concessão <code>{action?.kind === "revoke" ? action.key : ""}</code> expira agora; o histórico fica na auditoria.</p>
      </ConfirmDialog>
      <ConfirmDialog open={action?.kind === "subscription"} title="Assinatura manual" confirmLabel="Salvar assinatura" busy={busy} onConfirm={() => void confirm()} onClose={() => setAction(null)}>
        <p>Registro manual (sem provedor de pagamento). Corrige a assinatura viva da conta ou cria uma nova.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field id="admin-sub-plan" label="Plano">
            <select id="admin-sub-plan" className={FIELD_CONTROL} value={subscription.plan} onChange={(e) => setSubscription((s) => ({ ...s, plan: e.target.value as PlanCode }))}>
              <option value="ADVANCED">{PLAN_NAME.ADVANCED}</option><option value="PROFESSIONAL">{PLAN_NAME.PROFESSIONAL}</option>
            </select>
          </Field>
          <Field id="admin-sub-status" label="Status">
            <select id="admin-sub-status" className={FIELD_CONTROL} value={subscription.status} onChange={(e) => setSubscription((s) => ({ ...s, status: e.target.value as SubscriptionStatus }))}>
              {Object.entries(SUBSCRIPTION_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
        <Field id="admin-sub-end" label="Fim do período (opcional)">
          <input id="admin-sub-end" type="date" className={FIELD_CONTROL} value={subscription.end} onChange={(e) => setSubscription((s) => ({ ...s, end: e.target.value }))} />
        </Field>
        <Field id="admin-sub-notes" label="Observação (opcional)">
          <input id="admin-sub-notes" className={FIELD_CONTROL} maxLength={500} value={subscription.notes} onChange={(e) => setSubscription((s) => ({ ...s, notes: e.target.value }))} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
