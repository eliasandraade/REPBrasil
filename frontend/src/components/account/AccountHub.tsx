"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { PLAN_NAME } from "@/lib/plans";
import { useAccount } from "@/lib/useAccount";
import { AccountAvatar } from "./AccountAvatar";

export const ACCOUNT_SECTIONS = [
  { href: "/conta", label: "Visão geral" },
  { href: "/conta/perfil", label: "Perfil" },
  { href: "/conta/plano", label: "Plano" },
  { href: "/conta/favoritos", label: "Favoritos" },
  { href: "/conta/watchlist", label: "Watchlist" },
  { href: "/conta/alertas", label: "Alertas" },
  { href: "/conta/notificacoes", label: "Notificações" },
  { href: "/conta/seguranca", label: "Segurança" },
] as const;

function Frame({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">{children}</main>;
}

/**
 * Área autenticada: sem sessão, volta ao login com retorno para a seção pedida. Cabeçalho com identidade e
 * plano (decidido pela API) e navegação entre as seções da conta; cada seção é uma rota própria (link direto).
 */
export function AccountHub({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? "/conta";
  const router = useRouter();
  const account = useAccount();

  useEffect(() => {
    if (account.data === null) router.replace(`/entrar?returnTo=${encodeURIComponent(pathname)}`);
  }, [account.data, pathname, router]);

  if (account.isPending) {
    return (
      <Frame>
        <DataState kind="loading" title="Carregando sua conta" height="h-40" />
      </Frame>
    );
  }
  if (account.isError) {
    return (
      <Frame>
        <DataState kind="error" title="Não foi possível carregar sua conta" action={<RetryButton onRetry={() => void account.refetch()} />}>
          A conexão com o REPBrasil falhou. Seus dados continuam salvos.
        </DataState>
      </Frame>
    );
  }
  if (!account.data) {
    return (
      <Frame>
        <DataState kind="loading" title="Abrindo o login" height="h-40" />
      </Frame>
    );
  }

  const me = account.data;
  const name = me.displayName || me.profile.fullName || me.email;
  return (
    <Frame>
      <header className="vt-account-header flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <AccountAvatar name={name} avatarUrl={me.avatarUrl} size="lg" />
          <div className="min-w-0">
            <p className="text-label uppercase text-fg-muted">Sua conta</p>
            <h1 className="mt-1 truncate text-heading-md text-fg">{name}</h1>
            <p className="truncate text-body-sm text-fg-muted">{me.email}</p>
          </div>
        </div>
        <p className="text-body-sm text-fg-muted">
          Plano <strong className="font-semibold text-fg">{PLAN_NAME[me.plan]}</strong>
          {me.role === "superadmin" && <span className="text-fg-muted"> · Super Admin</span>}
          {" · "}
          <TransitionLink href="/planos" className="focus-ring mi-underline rounded text-accent-text">
            comparar planos
          </TransitionLink>
        </p>
      </header>

      <nav aria-label="Seções da conta" className="-mx-4 mt-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {ACCOUNT_SECTIONS.map((section) => {
            const current = pathname === section.href;
            const unread = section.href === "/conta/notificacoes" ? me.usage.unreadNotifications : 0;
            return (
              <li key={section.href}>
                <TransitionLink
                  href={section.href}
                  aria-current={current ? "page" : undefined}
                  className={`focus-ring nav-item relative -mb-px block whitespace-nowrap border-b-2 px-3 py-3 text-body-sm ${
                    current ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg"
                  }`}
                >
                  {section.label}
                  {unread > 0 && (
                    <span className="ml-1.5 tabular-nums text-accent-text">
                      {unread}
                      <span className="sr-only"> não lidas</span>
                    </span>
                  )}
                </TransitionLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-8">{children}</div>
    </Frame>
  );
}
