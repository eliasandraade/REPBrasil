"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDateTime } from "@/components/account/format";
import { adminApi, type ComponentHealth } from "@/lib/admin";
import { PLAN_NAME } from "@/lib/plans";

const STATUS_LABEL: Record<ComponentHealth["status"], string> = { ok: "Operando", down: "Sem resposta", not_configured: "Não configurado" };
const STATUS_TONE: Record<ComponentHealth["status"], string> = { ok: "text-positive", down: "text-danger", not_configured: "text-fg-muted" };
const RUN_TONE: Record<string, string> = { succeeded: "text-positive", failed: "text-danger" };

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days} d ${hours} h` : `${hours} h ${minutes} min`;
}

function Section({ title, children, note }: Readonly<{ title: string; children: ReactNode; note?: ReactNode }>) {
  return (
    <section className="border-t border-line pt-5">
      <h2 className="text-label uppercase text-fg-muted">{title}</h2>
      <div className="mt-3">{children}</div>
      {note && <p className="mt-2 text-micro text-fg-muted">{note}</p>}
    </section>
  );
}

function Figure({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div>
      <dt className="text-micro text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-heading-sm tabular-nums text-fg">{value}</dd>
    </div>
  );
}

const TH = "border-b border-line py-2 pr-4 text-left text-micro font-semibold uppercase tracking-wide text-fg-muted";
const TD = "border-b border-line py-2 pr-4 align-top text-body-sm";

/** Visão geral do sistema, só com componentes que existem e números lidos da API. */
export function AdminOverviewView() {
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: adminApi.overview, refetchInterval: 60_000 });
  if (!overview.data) {
    return overview.isError
      ? <DataState kind="error" title="Diagnóstico indisponível" action={<RetryButton onRetry={() => void overview.refetch()} />} />
      : <DataState kind="loading" title="Carregando o diagnóstico" height="h-96" />;
  }
  const data = overview.data;

  return (
    <div className="space-y-10">
      <p className="text-micro text-fg-muted">
        Gerado em {formatDateTime(data.generatedAt)} · atualiza a cada minuto · ambiente <strong className="text-fg-soft">{data.api.environment}</strong>
        {data.api.revision && <> · revisão <code>{data.api.revision.slice(0, 7)}</code></>} · no ar há {uptime(data.api.uptimeSeconds)}
      </p>

      <Section title="Componentes" note="Latência medida agora, a partir da API. Lake e frontend só são medidos quando estão configurados no servidor.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead><tr><th className={TH}>Componente</th><th className={TH}>Estado</th><th className={TH}>Latência</th><th className={TH}>Detalhe</th></tr></thead>
            <tbody>
              <tr>
                <td className={TD}>API (.NET {data.api.runtime})</td>
                <td className={`${TD} text-positive`}>Operando</td>
                <td className={TD}>—</td>
                <td className={TD}>Última migration: <code className="text-micro">{data.api.latestMigration ?? "—"}</code></td>
              </tr>
              {data.components.map((c) => (
                <tr key={c.name}>
                  <td className={TD}>{c.name}</td>
                  <td className={`${TD} ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</td>
                  <td className={`${TD} tabular-nums`}>{c.latencyMs === null ? "—" : `${c.latencyMs.toLocaleString("pt-BR")} ms`}</td>
                  <td className={`${TD} text-fg-muted`}>{c.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.pendingMigrations.length > 0 && (
          <p role="alert" className="mt-3 text-body-sm text-warn">Migrations pendentes no banco: {data.pendingMigrations.join(", ")}.</p>
        )}
      </Section>

      <Section title="Contas">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
          <Figure label="Total" value={data.users.total.toLocaleString("pt-BR")} />
          <Figure label="Ativas" value={data.users.active.toLocaleString("pt-BR")} />
          <Figure label="Suspensas" value={data.users.suspended.toLocaleString("pt-BR")} />
          <Figure label="Novas em 7 dias" value={data.users.new7d.toLocaleString("pt-BR")} />
          <Figure label="Novas em 30 dias" value={data.users.new30d.toLocaleString("pt-BR")} />
          <Figure label="Usaram em 30 dias" value={data.users.seen30d.toLocaleString("pt-BR")} />
          <Figure label="Sessões abertas" value={data.users.activeSessions.toLocaleString("pt-BR")} />
        </dl>
        <p className="mt-4 text-body-sm text-fg-soft">
          Por plano (contas ativas):{" "}
          {Object.entries(data.users.byPlan).map(([code, count], index) => (
            <span key={code}>{index > 0 && " · "}{PLAN_NAME[code as keyof typeof PLAN_NAME] ?? code} <strong className="tabular-nums text-fg">{count}</strong></span>
          ))}
          {" "}· Super Admin <strong className="tabular-nums text-fg">{data.users.byRole.superadmin}</strong>
        </p>
      </Section>

      <div className="grid gap-10 lg:grid-cols-3">
        <Section title="Assinaturas" note={data.subscriptions.billingProvider ? null : "Sem provedor de pagamento: assinaturas só manuais."}>
          <dl className="grid grid-cols-2 gap-4">
            <Figure label="Ativas" value={data.subscriptions.active} />
            <Figure label="Pagamento pendente" value={data.subscriptions.pastDue} />
            <Figure label="Período vencido e ainda ativas" value={data.subscriptions.lapsedButActive} />
            <Figure label="Planos manuais" value={data.subscriptions.manualPlanGrants} />
          </dl>
        </Section>
        <Section title="Alertas">
          <dl className="grid grid-cols-2 gap-4">
            <Figure label="Assinaturas ativas" value={data.alerts.enabledSubscriptions} />
            <Figure label="Notificações entregues" value={data.alerts.notifications} />
            <Figure label="Edições na fila" value={data.alerts.pendingEditions} />
            <Figure label="Última edição vista" value={data.alerts.latestEditionAt ? formatDateTime(data.alerts.latestEditionAt) : "—"} />
          </dl>
        </Section>
        <Section title="Suporte">
          <dl className="grid grid-cols-2 gap-4">
            <Figure label="Novos" value={data.support.open} />
            <Figure label="Em análise" value={data.support.inReview} />
          </dl>
        </Section>
      </div>

      <Section title="Frescor dos dados oficiais" note="Última coleta gravada por base. Sem linhas, a base não foi carregada neste ambiente.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead><tr><th className={TH}>Base</th><th className={TH}>Registros</th><th className={TH}>Última coleta</th></tr></thead>
            <tbody>
              {data.freshness.map((row) => (
                <tr key={row.source}>
                  <td className={TD}>{row.source}</td>
                  <td className={`${TD} tabular-nums`}>{row.rows.toLocaleString("pt-BR")}</td>
                  <td className={TD}>{row.latestAt ? formatDateTime(row.latestAt) : <span className="text-fg-muted">Sem coleta</span>}</td>
                </tr>
              ))}
              {data.derivedViews.map((view) => (
                <tr key={view.view}>
                  <td className={TD}>Visão derivada <code className="text-micro">{view.view}</code></td>
                  <td className={`${TD} tabular-nums`}>{view.buRuns.toLocaleString("pt-BR")} cargas de BU</td>
                  <td className={TD}>{formatDateTime(view.refreshedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Ingestões recentes">
        {data.recentIngestions.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhuma ingestão registrada neste ambiente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr><th className={TH}>Fonte</th><th className={TH}>Status</th><th className={TH}>Início</th><th className={TH}>Fim</th><th className={TH}>Erro</th></tr></thead>
              <tbody>
                {data.recentIngestions.map((run) => (
                  <tr key={`${run.source}-${run.startedAt}`}>
                    <td className={TD}><code className="text-micro">{run.source}</code></td>
                    <td className={`${TD} ${RUN_TONE[run.status] ?? "text-fg-soft"}`}>{run.status}</td>
                    <td className={TD}>{formatDateTime(run.startedAt)}</td>
                    <td className={TD}>{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</td>
                    <td className={`${TD} text-fg-muted`}>{run.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="HTTP" note={`Desde ${formatDateTime(data.http.since)}, nesta réplica da API: zera a cada deploy.`}>
        <p className="text-body-sm text-fg-soft">
          <strong className="tabular-nums text-fg">{data.http.calls.toLocaleString("pt-BR")}</strong> chamadas ·{" "}
          <strong className={`tabular-nums ${data.http.serverErrors > 0 ? "text-danger" : "text-fg"}`}>{data.http.serverErrors.toLocaleString("pt-BR")}</strong> respostas 5xx
        </p>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full min-w-[640px]">
            <thead className="sticky top-0 bg-canvas"><tr><th className={TH}>Rota</th><th className={TH}>Chamadas</th><th className={TH}>4xx</th><th className={TH}>5xx</th><th className={TH}>p95</th></tr></thead>
            <tbody>
              {data.http.routes.map((r) => (
                <tr key={`${r.method} ${r.route}`}>
                  <td className={TD}><code className="text-micro">{r.method} {r.route}</code></td>
                  <td className={`${TD} tabular-nums`}>{r.calls.toLocaleString("pt-BR")}</td>
                  <td className={`${TD} tabular-nums`}>{r.clientErrors.toLocaleString("pt-BR")}</td>
                  <td className={`${TD} tabular-nums ${r.serverErrors > 0 ? "text-danger" : ""}`}>{r.serverErrors.toLocaleString("pt-BR")}</td>
                  <td className={`${TD} tabular-nums`}>{r.p95Ms === null ? "—" : `${r.p95Ms.toLocaleString("pt-BR")} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
