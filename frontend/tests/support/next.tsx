import type { ReactNode } from "react";
import { vi } from "vitest";

/** Estado do roteador nos testes: cada teste define `pathname`/`search` e confere `replace`/`push`. */
export const nav = { pathname: "/", search: "", replace: vi.fn(), push: vi.fn() };

export const navigationMock = () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: vi.fn() }),
});

export const linkMock = () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
});
