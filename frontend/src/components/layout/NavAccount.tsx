"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { PLAN_NAME } from "@/lib/plans";
import { useAccount } from "@/lib/useAccount";
import { TransitionLink } from "@/motion/navigation";

const PENDING = <div className="skeleton h-10 w-full" aria-hidden="true" data-testid="nav-account-pending" />;

/**
 * Conta na navegação: "Entrar" (voltando para a mesma página), ou avatar, nome e plano → /conta; a Administração
 * aparece só para quem a API diz ser Super Admin. Enquanto a sessão carrega, a geometria fica reservada.
 * `useSearchParams` no shell exige Suspense: sem ele, o prerender estático das páginas falha no build.
 */
export function NavAccount(props: Readonly<{ onLinkClick?: () => void }>) {
  return (
    <Suspense fallback={PENDING}>
      <AccountBlock {...props} />
    </Suspense>
  );
}

function AccountBlock({ onLinkClick }: Readonly<{ onLinkClick?: () => void }>) {
  const { data: me } = useAccount();
  const pathname = usePathname() ?? "/";
  const query = useSearchParams()?.toString() ?? "";

  if (me === undefined) return PENDING;

  if (!me) {
    const here = query ? `${pathname}?${query}` : pathname;
    const returnTo = pathname.startsWith("/entrar") ? "/conta" : here;
    return (
      <TransitionLink
        href={`/entrar?returnTo=${encodeURIComponent(returnTo)}`}
        onClick={onLinkClick}
        className="focus-ring mi-press flex w-full items-center justify-center rounded-md border border-line-strong px-3 py-2 text-sm font-semibold text-fg hover:bg-fg/[0.05]"
        data-testid="nav-signin"
      >
        Entrar
      </TransitionLink>
    );
  }

  const name = me.displayName ?? me.email;
  const active = pathname.startsWith("/conta");
  return (
    <div className="space-y-1" data-testid="nav-account">
      <TransitionLink
        href="/conta"
        onClick={onLinkClick}
        aria-current={active ? "page" : undefined}
        className={`nav-item focus-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 ${active ? "bg-accent/10" : "hover:bg-fg/[0.05]"}`}
      >
        <AccountAvatar name={name} avatarUrl={me.avatarUrl} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{name}</span>
          <span className="block text-micro text-fg-muted">Plano {PLAN_NAME[me.plan]}</span>
        </span>
      </TransitionLink>
      {me.role === "superadmin" && (
        <TransitionLink
          href="/admin"
          onClick={onLinkClick}
          aria-current={pathname.startsWith("/admin") ? "page" : undefined}
          className="focus-ring mi-underline block w-fit rounded px-2 text-micro font-medium text-accent-text"
        >
          Administração
        </TransitionLink>
      )}
    </div>
  );
}
