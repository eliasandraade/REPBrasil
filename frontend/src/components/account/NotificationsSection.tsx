"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { getNotifications, markAllNotificationsRead, markNotificationRead, type AccountNotification } from "@/lib/account";
import { accountKeys, useAccount, useRefreshAccount } from "@/lib/useAccount";
import { formatDateTime } from "./format";

/** Caixa de notificações (últimas 100): não lidas em destaque por peso e por texto, nunca só por cor. */
export function NotificationsSection() {
  const { data: me } = useAccount();
  const refreshAccount = useRefreshAccount();
  const notifications = useQuery({ queryKey: accountKeys.notifications, queryFn: getNotifications, enabled: !!me });
  const [failed, setFailed] = useState(false);
  if (!me) return null;

  async function run(action: () => Promise<unknown>) {
    setFailed(false);
    try {
      await action();
      await refreshAccount();
    } catch {
      setFailed(true);
    }
  }

  const unread = (notifications.data ?? []).filter((n) => !n.readAt).length;
  return (
    <section aria-labelledby="notifications-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="notifications-title" className="text-label uppercase text-fg-muted">
          Notificações <span className="tabular-nums">({unread} não {unread === 1 ? "lida" : "lidas"})</span>
        </h2>
        {unread > 0 && (
          <button type="button" onClick={() => void run(() => markAllNotificationsRead(me))}
            className="focus-ring rounded-md px-2 py-1 text-body-sm font-medium text-accent-text hover:bg-fg/[0.05]">
            Marcar todas como lidas
          </button>
        )}
      </div>
      {failed && <p role="alert" className="mt-3 text-body-sm text-danger">Não foi possível atualizar agora. Tente de novo.</p>}

      <div className="mt-4">
        {notifications.isPending && <DataState kind="loading" title="Carregando notificações" height="h-48" />}
        {notifications.isError && !notifications.data && <DataState kind="error" title="Não foi possível carregar as notificações" action={<RetryButton onRetry={() => void notifications.refetch()} />} />}
        {notifications.data && notifications.data.length === 0 && (
          <p className="text-body-sm text-fg-muted">
            Nenhuma notificação. Elas aparecem aqui quando um{" "}
            <TransitionLink href="/conta/alertas" className="focus-ring mi-underline rounded text-accent-text">alerta</TransitionLink> seu é disparado
            por uma nova edição oficial.
          </p>
        )}
        {notifications.data && notifications.data.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {notifications.data.map((notice) => (
              <NotificationRow key={notice.id} notice={notice} onRead={() => run(() => markNotificationRead(me, notice.id))} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NotificationRow({ notice, onRead }: Readonly<{ notice: AccountNotification; onRead: () => Promise<void> }>) {
  const unread = !notice.readAt;
  const sourceUrl = typeof notice.payload?.sourceUrl === "string" ? notice.payload.sourceUrl : null;
  return (
    <li className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4 ${unread ? "border-l-2 border-accent pl-3" : "pl-[14px]"}`}>
      <div className="min-w-0 max-w-3xl">
        <p className={`text-body-sm ${unread ? "font-semibold text-fg" : "text-fg-soft"}`}>
          {unread && <span className="mr-2 text-label uppercase text-accent-text">Nova</span>}
          {notice.href ? (
            <TransitionLink href={notice.href} className="focus-ring mi-underline rounded" onClick={() => { if (unread) void onRead(); }}>
              {notice.title}
            </TransitionLink>
          ) : (
            notice.title
          )}
        </p>
        {notice.body && <p className="mt-1 text-body-sm text-fg-muted">{notice.body}</p>}
        <p className="mt-1 text-micro text-fg-muted">
          {formatDateTime(notice.createdAt)}
          {sourceUrl && (
            <>
              {" · "}
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="focus-ring rounded underline underline-offset-2">fonte oficial</a>
            </>
          )}
        </p>
      </div>
      {unread && (
        <button type="button" onClick={() => void onRead()} className="focus-ring shrink-0 rounded-md px-2 py-1 text-micro font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg">
          Marcar como lida
        </button>
      )}
    </li>
  );
}
