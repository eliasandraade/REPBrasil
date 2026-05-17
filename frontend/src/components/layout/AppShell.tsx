"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

function LifeBuoyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h16" /><path d="M4 18h16" /><path d="M4 6h16" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

function LogoMark({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-7 h-7 text-xs" : "w-8 h-8 text-sm";
  return (
    <div className={`${cls} rounded-md bg-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0`}>
      <span className="text-brand font-black leading-none">R</span>
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
}

function SidebarContent({ pathname, alwaysShowLabels = false, onLinkClick }: SidebarContentProps) {
  const labelCls = alwaysShowLabels
    ? "block"
    : "hidden group-hover/sidebar:block xl:block";
  const sectionLabelCls = alwaysShowLabels
    ? "block"
    : "hidden group-hover/sidebar:block xl:block";

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 p-4 border-b border-white/8">
        <LogoMark />
        <div className={`${labelCls} flex flex-col min-w-0`}>
          <span className="font-bold text-slate-100 text-sm leading-tight tracking-tight whitespace-nowrap">
            REPBrasil
          </span>
          <span className="text-[10px] text-slate-500 leading-tight whitespace-nowrap">
            Andrade Systems
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 py-4 space-y-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className={`${sectionLabelCls} px-3 mb-2 text-[9px] font-semibold text-slate-600 uppercase tracking-widest`}>
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, Icon, exact }) => {
                const active = isActive(href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    title={label}
                    onClick={onLinkClick}
                    className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150
                      ${active
                        ? "bg-brand/10 text-brand font-medium"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}
                  >
                    {active && (
                      <div className="absolute left-0 top-0 h-full w-0.5 bg-brand rounded-r-full" />
                    )}
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className={`${labelCls} whitespace-nowrap`}>{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom branding */}
      <div className="p-3 border-t border-white/8">
        <div className={labelCls}>
          <span className="inline-flex items-center rounded border border-brand/25 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
            Preview Técnico
          </span>
          <p className="mt-1.5 text-[10px] text-slate-600 leading-tight">
            © 2025 Andrade Systems
          </p>
        </div>
      </div>
    </>
  );
}

// ─── AppShell (exported) ──────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop: space holder + absolute sidebar */}
      <div className="relative hidden flex-shrink-0 lg:block lg:w-14 xl:w-56">
        <div className="h-full w-full" />
        <div className="group/sidebar absolute inset-y-0 left-0 z-50 flex w-14 flex-col overflow-hidden border-r border-white/8 bg-sidebar transition-all duration-200 hover:z-[60] hover:w-56 xl:w-56">
          <SidebarContent pathname={pathname} />
        </div>
      </div>

      {/* Mobile: overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile: drawer sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar border-r border-white/8 transition-transform duration-300 lg:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <SidebarContent
          pathname={pathname}
          alwaysShowLabels
          onLinkClick={() => setMobileOpen(false)}
        />
      </div>

      {/* Main content column */}
      <div className="flex flex-1 flex-col overflow-auto min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-sidebar border-b border-white/8 flex-shrink-0">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
          >
            {mobileOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size="sm" />
            <span className="font-bold text-slate-100 text-sm">REPBrasil</span>
          </Link>
        </div>

        {/* Page content */}
        {children}
      </div>
    </div>
  );
}
