"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type AccountEntitlement,
  type AccountMe,
  type AccountNotification,
  type AlertSubscription,
  type ApiKeyInfo,
  type CreatedApiKey,
  type SavedItem,
  createApiKey,
  getAccount,
  getAlerts,
  getApiKeys,
  getEntitlements,
  getNotifications,
  getSavedItems,
  logout,
  removeSavedItem,
  revokeApiKey,
} from "@/lib/account";
import { TransitionLink } from "@/motion/navigation";

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<AccountMe | null>(null);
  const [favorites, setFavorites] = useState<SavedItem[]>([]);
  const [watchlist, setWatchlist] = useState<SavedItem[]>([]);
  const [alerts, setAlerts] = useState<AlertSubscription[]>([]);
  const [notifications, setNotifications] = useState<AccountNotification[]>([]);
  const [entitlements, setEntitlements] = useState<AccountEntitlement[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [keyName, setKeyName] = useState("Minha integração");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const account = await getAccount();
      if (!account) {
        router.replace("/entrar?returnTo=/conta");
        return;
      }
      setMe(account);
      const [fav, watch, alertsData, notice, grants, keys] = await Promise.all([
        getSavedItems("favorite"),
        getSavedItems("watchlist"),
        getAlerts(),
        getNotifications(),
        getEntitlements(),
        getApiKeys(),
      ]);
      setFavorites(fav);
      setWatchlist(watch);
      setAlerts(alertsData);
      setNotifications(notice);
      setEntitlements(grants);
      setApiKeys(keys);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  if (status === "loading") return <main className="mx-auto max-w-5xl px-5 py-10 text-sm text-fg-muted">Carregando sua conta…</main>;
  if (status === "error" || !me) return <main className="mx-auto max-w-5xl px-5 py-10 text-sm text-danger">Não foi possível carregar sua conta.</main>;

  async function remove(item: SavedItem) {
    await removeSavedItem(me!, item.collection, item.resourceType, item.resourceKey);
    await load();
  }

  async function createKey() {
    const result = await createApiKey(me!, keyName);
    setCreatedKey(result);
    await load();
  }

  async function revoke(id: string) {
    await revokeApiKey(me!, id);
    await load();
  }

  async function signOut() {
    await logout(me!.csrfToken);
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-text">Sua conta</p>
          <h1 className="mt-1 text-2xl font-semibold text-fg">{me.displayName || me.email}</h1>
          <p className="mt-1 text-sm text-fg-muted">{me.email}</p>
        </div>
        <button onClick={signOut} className="focus-ring rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-fg/[0.04]">Sair</button>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <SavedSection title="Favoritos" items={favorites} empty="Você ainda não favoritou nenhum item." onRemove={remove} />
        <SavedSection title="Watchlist" items={watchlist} empty="Sua watchlist está vazia." onRemove={remove} />
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Alertas</h2>
            <p className="mt-1 text-sm text-fg-muted">Assinaturas ativas por entidade e tipo de evento.</p>
          </div>
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-text">{alerts.filter((x) => x.enabled).length} ativos</span>
        </div>
        {alerts.length === 0 ? <p className="mt-4 text-sm text-fg-muted">Nenhum alerta configurado.</p> : (
          <div className="mt-4 divide-y divide-line">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div><strong className="font-medium text-fg">{alert.resourceKey}</strong><p className="text-fg-muted">{alert.eventKind} · {alert.delivery}</p></div>
                <span className={alert.enabled ? "text-accent-text" : "text-fg-muted"}>{alert.enabled ? "Ativo" : "Pausado"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">Notificações</h2>
        {notifications.length === 0 ? <p className="mt-3 text-sm text-fg-muted">Nenhuma notificação recebida.</p> : (
          <div className="mt-3 divide-y divide-line">
            {notifications.slice(0, 10).map((notice) => (
              <div key={notice.id} className="py-3">
                {notice.href ? <TransitionLink href={notice.href} className="focus-ring text-sm font-medium text-fg hover:text-accent-text">{notice.title}</TransitionLink> : <p className="text-sm font-medium text-fg">{notice.title}</p>}
                {notice.body && <p className="mt-1 text-sm text-fg-muted">{notice.body}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-fg">API comercial</h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">Crie credenciais revogáveis. O segredo aparece uma única vez; o servidor armazena somente o hash.</p>
          </div>
          <div className="flex gap-2">
            <input value={keyName} onChange={(e) => setKeyName(e.target.value)} className="focus-ring min-w-0 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg" aria-label="Nome da chave" />
            <button onClick={createKey} className="focus-ring whitespace-nowrap rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Criar chave</button>
          </div>
        </div>

        {createdKey && (
          <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">Copie agora</p>
            <code className="mt-2 block break-all text-sm text-fg">{createdKey.secret}</code>
            <p className="mt-2 text-xs text-fg-muted">Depois de sair desta tela, esta chave completa não poderá ser recuperada.</p>
          </div>
        )}

        <div className="mt-5 divide-y divide-line">
          {apiKeys.length === 0 && <p className="py-2 text-sm text-fg-muted">Nenhuma chave criada.</p>}
          {apiKeys.map((key) => (
            <div key={key.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-fg">{key.name} <code className="ml-2 text-xs text-fg-muted">{key.prefix}…</code></p>
                <p className="mt-1 text-xs text-fg-muted">Quota: {key.dailyQuota.toLocaleString("pt-BR")} req/dia · {key.revoked ? "revogada" : "ativa"}</p>
              </div>
              {!key.revoked && <button onClick={() => revoke(key.id)} className="focus-ring self-start rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg sm:self-auto">Revogar</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">Entitlements</h2>
        <p className="mt-1 text-sm text-fg-muted">Capacidades concedidas à sua conta. Preços e planos não são inferidos pela aplicação.</p>
        {entitlements.length === 0 ? <p className="mt-3 text-sm text-fg-muted">Nenhum entitlement adicional ativo.</p> : (
          <div className="mt-3 flex flex-wrap gap-2">
            {entitlements.map((grant) => <span key={`${grant.key}:${grant.source}`} className="rounded-full border border-line bg-canvas px-3 py-1 text-xs text-fg-soft">{grant.key}: {grant.value}</span>)}
          </div>
        )}
      </section>
    </main>
  );
}

function SavedSection({ title, items, empty, onRemove }: { title: string; items: SavedItem[]; empty: string; onRemove: (item: SavedItem) => Promise<void> }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {items.length === 0 ? <p className="mt-3 text-sm text-fg-muted">{empty}</p> : (
        <div className="mt-3 divide-y divide-line">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                {item.href ? <TransitionLink href={item.href} className="focus-ring block truncate text-sm font-medium text-fg hover:text-accent-text">{item.label || item.resourceKey}</TransitionLink> : <p className="truncate text-sm font-medium text-fg">{item.label || item.resourceKey}</p>}
                <p className="mt-1 text-xs text-fg-muted">{item.resourceType}</p>
              </div>
              <button onClick={() => void onRemove(item)} className="focus-ring rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-fg/[0.05] hover:text-fg">Remover</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
