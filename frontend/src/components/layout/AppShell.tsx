"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { SearchProvider, SearchTrigger } from "@/components/search/GlobalSearch";
import { TransitionLink } from "@/motion/navigation";

const destinations = [
  { href: "/", label: "Explorar", glyph: "◎" },
  { href: "/eleicoes", label: "Eleições", glyph: "◷" },
  { href: "/politicos", label: "Pessoas", glyph: "○" },
  { href: "/eleicoes/comparar", label: "Comparar", glyph: "⇄" },
];
function ShellLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/"
      ? pathname === "/"
      : href === "/eleicoes"
        ? pathname.startsWith(href) && !pathname.startsWith("/eleicoes/comparar")
        : pathname.startsWith(href);
  const links = destinations.map(({ href, label, glyph }) => (
    <TransitionLink
      key={href}
      href={href}
      aria-current={active(href) ? "page" : undefined}
      className="workspace-nav-link"
    >
      <span aria-hidden="true" className="workspace-nav-glyph">
        {glyph}
      </span>
      <span>{label}</span>
    </TransitionLink>
  ));
  return (
    <div className="workspace">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="workspace-header vt-app-nav">
        <TransitionLink href="/" className="workspace-brand" aria-label="REPBrasil, início">
          <BrandMark />
        </TransitionLink>
        <nav aria-label="Navegação principal" className="workspace-desktop-nav">
          {links}
        </nav>
        <div className="workspace-search">
          <SearchTrigger />
        </div>
        <TransitionLink href="/manifesto" className="workspace-method">
          Sobre os dados ↗
        </TransitionLink>
      </header>
      <div id="conteudo" tabIndex={-1} className="workspace-content">
        <div data-route-frame>{children}</div>
        <footer className="workspace-footer">
          <span>REPBrasil / Inteligência eleitoral</span>
          <nav aria-label="Informações">
            <TransitionLink href="/manifesto">Princípios</TransitionLink>
            <TransitionLink href="/glossario">Glossário</TransitionLink>
            <TransitionLink href="/suporte">Suporte</TransitionLink>
          </nav>
        </footer>
      </div>
      <nav aria-label="Navegação principal no celular" className="workspace-mobile-nav">
        {links}
      </nav>
    </div>
  );
}
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SearchProvider>
      <ShellLayout>{children}</ShellLayout>
    </SearchProvider>
  );
}
