"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

function PinOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 2l20 20" />
      <path d="M22 6a2 2 0 0 0-2-2H9.17" />
      <path d="M16 6v3.18" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
      <path d="M12 17v5" />
    </svg>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

function LogoMark({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? 30 : 36;
  const fontSize = size === "sm" ? 15 : 18;
  return (
    <div
      className="flex-shrink-0 rounded-lg bg-brand flex items-center justify-center"
      style={{ width: dim, height: dim, minWidth: dim }}
    >
      <span
        className="font-black text-slate-900 select-none leading-none"
        style={{ fontSize }}
      >
        R
      </span>
    </div>
  );
}

// ─── Nav config ───────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: "Geral",
    items: [
      { href: "/", label: "Início", Icon: HomeIcon, exact: true },
      { href: "/politicos", label: "Buscar Políticos", Icon: SearchIcon, exact: false },
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

// ─── Sidebar Content ──────────────────────────────────────────────────────────

interface SidebarContentProps {
  pathname: string;
  alwaysShowLabels?: boolean;
  onLinkClick?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

function SidebarContent({
  pathname,
  alwaysShowLabels = false,
  onLinkClick,
  pinned = true,
  onTogglePin,
}: SidebarContentProps) {
  // Labels visible: always (mobile drawer) | hover OR pinned-xl (desktop)
  const labelCls = alwaysShowLabels
    ? "block"
    : pinned
    ? "hidden group-hover/sidebar:block xl:block"
    : "hidden group-hover/sidebar:block";

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex h-full flex-col">
      {/* ── Logo header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-5">
        <LogoMark />
        <span className={`${labelCls} text-[15px] font-bold text-slate-100 tracking-tight whitespace-nowrap`}>
          REPBrasil
        </span>
      </div>

      {/* ── Navigation ──────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? "mt-2 border-t border-white/[0.05] pt-3" : ""}>
            {/* Section label */}
            <p className={`${labelCls} mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600`}>
              {section.label}
            </p>

            {/* Nav items */}
            <div className="space-y-0.5">
              {section.items.map(({ href, label, Icon, exact }) => {
                const active = isActive(href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    title={label}
                    onClick={onLinkClick}
                    className={`group relative flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors duration-100
                      ${active
                        ? "bg-brand/10 text-brand"
                        : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                      }`}
                  >
                    {/* Active left bar */}
                    {active && (
                      <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-brand" />
                    )}
                    <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                    <span className={`${labelCls} font-medium whitespace-nowrap leading-none`}>
                      {label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="border-t border-white/[0.05] px-3 py-3">
        <div className={`${labelCls} flex items-center justify-between`}>
          <span className="text-[10px] text-slate-600">
            © 2026 Andrade Systems
          </span>

          {/* Pin / unpin toggle — desktop only */}
          {onTogglePin && (
            <button
              onClick={onTogglePin}
              title={pinned ? "Recolher sidebar" : "Fixar sidebar"}
              className="rounded p-1 text-slate-700 transition-colors hover:bg-white/5 hover:text-slate-400"
            >
              {pinned ? <PinOffIcon className="h-3.5 w-3.5" /> : <PinIcon className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {/* Collapsed state: just a small dot placeholder so footer has height */}
        <div className={`${alwaysShowLabels ? "hidden" : "block group-hover/sidebar:hidden"} h-3`} />
      </div>
    </div>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const pathname = usePathname();

  // Spaceholder width: if pinned → always xl:w-56, else icon-only
  const spaceHolderCls = pinned
    ? "relative hidden flex-shrink-0 lg:block lg:w-14 xl:w-56"
    : "relative hidden flex-shrink-0 lg:block lg:w-14";

  // Sidebar width: hover always expands; xl:w-56 only when pinned
  const sidebarWidthCls = pinned
    ? "w-14 hover:w-56 xl:w-56"
    : "w-14 hover:w-56";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop spaceholder */}
      <div className={spaceHolderCls}>
        <div className="h-full w-full" />
        {/* Absolute sidebar */}
        <div
          className={`group/sidebar absolute inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-white/[0.06] bg-sidebar transition-[width] duration-200 ease-in-out hover:z-[60] ${sidebarWidthCls}`}
        >
          <SidebarContent
            pathname={pathname}
            pinned={pinned}
            onTogglePin={() => setPinned((v) => !v)}
          />
        </div>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/[0.06] bg-sidebar transition-transform duration-300 ease-in-out lg:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <SidebarContent
          pathname={pathname}
          alwaysShowLabels
          onLinkClick={() => setMobileOpen(false)}
        />
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {/* Mobile topbar */}
        <div className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/[0.06] bg-sidebar px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
          >
            {mobileOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size="sm" />
            <span className="text-sm font-bold text-slate-100">REPBrasil</span>
          </Link>
        </div>

        {children}
      </div>
    </div>
  );
}
