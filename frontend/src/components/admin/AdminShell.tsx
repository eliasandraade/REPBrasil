"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { adminApi } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { useHydrated } from "@/lib/useAccount";

export const ADMIN_SECTIONS = [
  { href: "/admin", label: "Visão geral" },
  { href: "/admin/contas", label: "Contas" },
  { href: "/admin/assinaturas", label: "Assinaturas" },
  { href: "/admin/auditoria", label: "Auditoria" },
  { href: "/admin/api", label: "API" },
  { href: "/admin/suporte", label: "Suporte" },
] as const;

const isCurrent = (pathname: string, href: string) => (href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

function Frame({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">{children}</main>;
}

/**
 * Área do Super Admin. A decisão é do servidor (GET /api/v1/admin/me): sem sessão, volta ao login; conta comum vê
 * "Acesso restrito", sem nenhum dado administrativo. Nada aqui recebe segredo.
 */
export function AdminShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const hydrated = useHydrated();
  const me = useQuery({ queryKey: ["admin", "me"], queryFn: adminApi.me, retry: false, staleTime: 30_000 });
  const status = me.error instanceof ApiError ? me.error.status : null;

  useEffect(() => {
    if (status === 401) router.replace(`/entrar?returnTo=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (!hydrated || me.isPending || status === 401) {
    return (
      <Frame>
        <DataState kind="loading" title="Verificando acesso" height="h-40" />
      </Frame>
    );
  }
  if (status === 403) {
    return (
      <Frame>
        <h1 className="text-heading-md text-fg">Acesso restrito</h1>
        <p className="mt-2 max-w-xl text-body-sm text-fg-muted">
          Esta área é só para a administração do REPBrasil. Sua conta continua com acesso a tudo o que é público e à{" "}
          <TransitionLink href="/conta" className="focus-ring mi-underline rounded text-accent-text">sua conta</TransitionLink>.
        </p>
      </Frame>
    );
  }
  if (me.isError) {
    return (
      <Frame>
        <DataState kind="error" title="Não foi possível verificar o acesso" action={<RetryButton onRetry={() => void me.refetch()} />} />
      </Frame>
    );
  }

  return (
    <Frame>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
        <div>
          <p className="text-label uppercase text-fg-muted">Super Admin</p>
          <h1 className="mt-1 text-heading-md text-fg">Administração</h1>
        </div>
        <p className="text-body-sm text-fg-muted">{me.data.email}</p>
      </header>
      <nav aria-label="Seções da administração" className="-mx-4 mt-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {ADMIN_SECTIONS.map((section) => {
            const current = isCurrent(pathname, section.href);
            return (
              <li key={section.href}>
                <TransitionLink
                  href={section.href}
                  aria-current={current ? "page" : undefined}
                  className={`focus-ring nav-item -mb-px block whitespace-nowrap border-b-2 px-3 py-3 text-body-sm ${
                    current ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg"
                  }`}
                >
                  {section.label}
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
