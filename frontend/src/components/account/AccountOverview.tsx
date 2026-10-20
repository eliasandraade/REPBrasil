"use client";

import { useQuery } from "@tanstack/react-query";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { getNotifications } from "@/lib/account";
import { stateProfilePath } from "@/lib/entities";
import { ALERTS_LIMIT, FAVORITES_LIMIT, PLAN_NAME, PLAN_SOURCE_LABEL, WATCHLIST_LIMIT } from "@/lib/plans";
import { ufName } from "@/lib/site";
import { accountKeys, useAccount } from "@/lib/useAccount";
import { UsageMeter } from "./UsageMeter";
import { formatDateTime } from "./format";

/** Visão geral: plano e uso, território do perfil e as notificações mais recentes. */
export function AccountOverview() {
  const { data: me } = useAccount();
  const notifications = useQuery({ queryKey: accountKeys.notifications, queryFn: getNotifications, enabled: !!me });
  if (!me) return null;

  const recent = (notifications.data ?? []).slice(0, 4);
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="overview-plan">
        <h2 id="overview-plan" className="text-label uppercase text-fg-muted">Plano e uso</h2>
        <p className="mt-3 text-heading-sm text-fg">{PLAN_NAME[me.plan]}</p>
        <p className="mt-1 text-body-sm text-fg-muted">{capitalize(PLAN_SOURCE_LABEL[me.planSource])}.</p>
        <div className="mt-6 space-y-5">
          <UsageMeter label="Favoritos" used={me.usage.favorites} max={me.limits[FAVORITES_LIMIT] ?? 0} />
          <UsageMeter label="Watchlist" used={me.usage.watchlist} max={me.limits[WATCHLIST_LIMIT] ?? 0} />
          <UsageMeter label="Alertas" used={me.usage.alerts} max={me.limits[ALERTS_LIMIT] ?? 0} />
        </div>
        <p className="mt-6 text-body-sm">
          <TransitionLink href="/conta/plano" className="focus-ring mi-underline rounded text-accent-text">Detalhes do plano</TransitionLink>
        </p>
      </section>

      <div className="space-y-10">
        <section aria-labelledby="overview-territory">
          <h2 id="overview-territory" className="text-label uppercase text-fg-muted">Seu território</h2>
          {me.profile.stateCode ? (
            <div className="mt-3">
              <p className="text-heading-sm text-fg">
                {me.profile.municipalityName ? `${me.profile.municipalityName}, ` : ""}
                {ufName(me.profile.stateCode)}
              </p>
              <p className="mt-2 text-body-sm">
                <TransitionLink href={stateProfilePath(me.profile.stateCode)} className="focus-ring mi-underline rounded text-accent-text">
                  Abrir {ufName(me.profile.stateCode)}
                </TransitionLink>
              </p>
            </div>
          ) : (
            <p className="mt-3 text-body-sm text-fg-muted">
              Informe sua UF e seu município no{" "}
              <TransitionLink href="/conta/perfil" className="focus-ring mi-underline rounded text-accent-text">perfil</TransitionLink> para
              abrir o REPBrasil direto no seu território. O dado serve só para isso.
            </p>
          )}
        </section>

        <section aria-labelledby="overview-notifications">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="overview-notifications" className="text-label uppercase text-fg-muted">Notificações recentes</h2>
            <TransitionLink href="/conta/notificacoes" className="focus-ring mi-underline rounded text-body-sm text-accent-text">Ver todas</TransitionLink>
          </div>
          <div className="mt-3">
            {notifications.isPending && <DataState kind="loading" title="Carregando notificações" />}
            {notifications.isError && (
              <DataState kind="error" title="Não foi possível carregar as notificações" action={<RetryButton onRetry={() => void notifications.refetch()} />} />
            )}
            {notifications.isSuccess && recent.length === 0 && (
              <p className="text-body-sm text-fg-muted">
                Nenhuma notificação ainda. Crie{" "}
                <TransitionLink href="/conta/alertas" className="focus-ring mi-underline rounded text-accent-text">alertas</TransitionLink> para
                ser avisado quando novas edições oficiais forem carregadas.
              </p>
            )}
            {recent.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {recent.map((notice) => (
                  <li key={notice.id} className="py-3">
                    <p className={`text-body-sm ${notice.readAt ? "text-fg-soft" : "font-semibold text-fg"}`}>
                      {!notice.readAt && <span className="sr-only">Não lida: </span>}
                      {notice.title}
                    </p>
                    <p className="mt-0.5 text-micro text-fg-muted">{formatDateTime(notice.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
