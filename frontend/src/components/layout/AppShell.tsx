"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import type { ReactNode } from "react";
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

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
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

function BallotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 12 2 2 4-4" />
      <path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z" />
      <path d="M22 19H2" />
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
      { href: "/politicos", label: "Buscar Políticos", Icon: SearchIcon, exact: false },
      { href: "/eleicoes", label: "Eleições", Icon: BallotIcon, exact: false },
      { href: "/manifesto", label: "Manifesto", Icon: BookOpenIcon, exact: false },
    ],
  },
  {
    label: "Suporte",
    items: [
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
      <div className="flex items-center px-5 py-5 border-b border-white/[0.05]">
        <TransitionLink href="/" onClick={onLinkClick} className="focus-ring rounded">
          <Image
            src="/logo.svg"
            alt="REPBrasil"
            width={148}
            height={40}
            className="h-9 w-auto"
            priority
          />
        </TransitionLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? "mt-3 border-t border-white/[0.05] pt-3" : ""}>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
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
                        ? "bg-brand/10 text-brand"
                        : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                      }`}
                  >
                    <span aria-hidden="true" className="nav-marker absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-brand" />
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
      <div className="border-t border-white/[0.05] px-5 py-3">
        <p className="text-[10px] text-slate-600">© 2026 Andrade Systems</p>
      </div>
    </div>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Drawer: foco entra ao abrir e volta ao botão ao fechar; Esc fecha.
  useEffect(() => {
    if (mobileOpen) {
      drawerRef.current?.querySelector<HTMLElement>("a[aria-current], a")?.focus();
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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop static sidebar */}
      <aside className="vt-app-nav hidden w-56 flex-shrink-0 flex-col border-r border-white/[0.06] bg-sidebar lg:flex">
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
        className="drawer fixed inset-y-0 left-0 z-50 w-64 border-r border-white/[0.06] bg-sidebar lg:hidden"
      >
        <Sidebar pathname={pathname} onLinkClick={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {/* Mobile topbar */}
        <div className="vt-app-topbar sticky top-0 z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/[0.06] bg-sidebar px-4 lg:hidden">
          <button
            ref={toggleRef}
            onClick={() => setMobileOpen(!mobileOpen)}
            className="focus-ring rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <TransitionLink href="/" className="focus-ring rounded">
            <Image
              src="/symbol.svg"
              alt="REPBrasil"
              width={28}
              height={28}
              className="h-7 w-auto"
            />
          </TransitionLink>
        </div>

        <div data-route-frame className="flex min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
