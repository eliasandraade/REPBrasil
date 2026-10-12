"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SearchProvider, SearchTrigger } from "@/components/search/GlobalSearch";
import { TransitionLink } from "@/motion/navigation";

// ─── Icons ────────────────────────────────────────────────────────────────────

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function UserIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

/** Eleições: barras de resultado (iconografia neutra — sem urna, estrela, bandeira ou Congresso). */
function ResultsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M8 17v-5" />
      <path d="M13 17V8" />
      <path d="M18 17v-9" />
    </svg>
  );
}

/** Partidos: grupo de pessoas (iconografia neutra — sem bandeira, estrela ou símbolo partidário). */
function GroupIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Rankings: lista ordenada (neutra). */
function RankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 6h11" />
      <path d="M10 12h11" />
      <path d="M10 18h11" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}

/** Comparar: fluxos bidirecionais entre itens equivalentes. */
function CompareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 7h12" />
      <path d="m16 3 4 4-4 4" />
      <path d="M16 17H4" />
      <path d="m8 13-4 4 4 4" />
    </svg>
  );
}

/** Dados: pontos conectados por eixos, sem iconografia partidária. */
function DataIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <circle cx="9" cy="14" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="18" cy="7" r="1.5" />
    </svg>
  );
}

function LifeBuoyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m4.93 4.93 4.24 4.24" />
      <path d="m14.83 9.17 4.24-4.24" />
      <path d="m14.83 14.83 4.24 4.24" />
      <path d="m9.17 14.83-4.24 4.24" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h16" /><path d="M4 18h16" /><path d="M4 6h16" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

// ─── Nav config ───────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: "Geral",
    items: [
      { href: "/", label: "Início", Icon: HomeIcon, exact: true },
      { href: "/politicos", label: "Políticos", Icon: UserIcon, exact: false },
      { href: "/eleicoes", label: "Eleições", Icon: ResultsIcon, exact: false },
      { href: "/partidos", label: "Partidos", Icon: GroupIcon, exact: false },
      { href: "/rankings", label: "Rankings", Icon: RankIcon, exact: false },
      { href: "/comparar", label: "Comparar", Icon: CompareIcon, exact: false },
      { href: "/dados", label: "Dados", Icon: DataIcon, exact: false },
      { href: "/manifesto", label: "Manifesto", Icon: BookOpenIcon, exact: false },
    ],
  },
  {
    label: "Suporte",
    items: [
      { href: "/glossario", label: "Glossário", Icon: BookOpenIcon, exact: false },
      { href: "/suporte", label: "Central de Suporte", Icon: LifeBuoyIcon, exact: false },
    ],
  },
] as const;

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  pathname: string;
  onLinkClick?: () => void;
}

function Sidebar({ pathname, onLinkClick }: SidebarProps) {
  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center border-b border-line px-3 py-3">
        <TransitionLink href="/" onClick={onLinkClick} className="focus-ring rounded-lg" aria-label="REPBrasil — início">
          {/* Assinatura reduzida "[RB] REPBrasil" (≥ 112px) com área de proteção 1X */}
          <Logo variant="horizontal" height={34} alt="" priority clearSpaceIncluded />
        </TransitionLink>
      </div>

      {/* Busca global (abre o diálogo; atalho "/" ou Ctrl+K) */}
      <div className="px-3 pt-4">
        <SearchTrigger />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? "mt-3 border-t border-line pt-3" : ""}>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, Icon, exact }) => {
                const active = isActive(href, exact);
                return (
                  <TransitionLink
                    key={href}
                    href={href}
                    onClick={onLinkClick}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item focus-ring relative flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium
                      ${active
                        ? "bg-accent/10 text-accent-text"
                        : "text-fg-muted hover:bg-fg/[0.05] hover:text-fg-soft"
                      }`}
                  >
                    <span aria-hidden="true" className="nav-marker absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-accent" />
                    <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                    <span>{label}</span>
                  </TransitionLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="space-y-3 border-t border-line px-4 py-3">
        <ThemeToggle />
        <p className="text-micro text-fg-muted">© 2026 Andrade Systems</p>
      </div>
    </div>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

function ShellLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Drawer: foco entra ao abrir e volta ao botão ao fechar; Esc fecha.
  useEffect(() => {
    if (mobileOpen) {
      // Foco no item da página atual (não no primeiro link do documento, que é o logo).
      const drawer = drawerRef.current;
      (drawer?.querySelector<HTMLElement>("a[aria-current='page']") ?? drawer?.querySelector<HTMLElement>("nav a"))?.focus();
    } else if (wasOpen.current) {
      toggleRef.current?.focus();
    }
    wasOpen.current = mobileOpen;
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Desktop static sidebar */}
      <aside className="vt-app-nav hidden w-56 flex-shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Sidebar pathname={pathname} />
      </aside>

      {/* Mobile backdrop (sempre montado: a opacidade transiciona, o clique só existe aberto) */}
      <div
        aria-hidden="true"
        data-open={mobileOpen}
        className="drawer-backdrop fixed inset-0 z-40 bg-black/60 lg:hidden"
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile drawer */}
      <div
        id="mobile-nav"
        ref={drawerRef}
        data-open={mobileOpen}
        inert={!mobileOpen}
        aria-label="Navegação"
        className="drawer fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-surface lg:hidden"
      >
        <Sidebar pathname={pathname} onLinkClick={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {/* Mobile topbar */}
        <div className="vt-app-topbar sticky top-0 z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button
            ref={toggleRef}
            onClick={() => setMobileOpen(!mobileOpen)}
            className="focus-ring rounded-md p-1.5 text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg-soft"
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <TransitionLink href="/" className="focus-ring rounded-lg" aria-label="REPBrasil — início">
            {/* Celular: símbolo micro oficial (sem mapa); tablet: assinatura reduzida. Nunca a assinatura completa espremida. */}
            <Logo variant="symbol" height={32} alt="" priority className="sm:hidden" />
            <Logo variant="horizontal" height={32} alt="" priority className="hidden sm:inline-flex" />
          </TransitionLink>
          <div className="ml-auto">
            <SearchTrigger compact />
          </div>
        </div>

        <div data-route-frame className="flex min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SearchProvider>
      <ShellLayout>{children}</ShellLayout>
    </SearchProvider>
  );
}