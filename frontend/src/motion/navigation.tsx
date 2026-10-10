"use client";

import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { directionBetween, type NavDirection } from "./depth";
import { prefersReducedMotion } from "./reduced-motion";
import { cssEasing, duration } from "./tokens";

/**
 * Transições de rota do REPBrasil.
 *
 * - Navegação iniciada pelo produto (links/rotas) passa por `navigate()`: com
 *   suporte à View Transitions API e sem Reduced Motion, a troca acontece dentro
 *   de `document.startViewTransition`, com a direção (deeper/shallower/lateral)
 *   em `<html data-nav-direction>` para o CSS escolher a coreografia.
 * - Sem suporte (ou em voltar/avançar do navegador, que o App Router trata
 *   internamente), o quadro de conteúdo recebe uma entrada curta via WAAPI com a
 *   mesma gramática. Nada fica escondido à espera de animação.
 * - Elementos compartilhados (identidade do político) só recebem
 *   `view-transition-name` no instante do clique — nunca uma lista inteira.
 *
 * A navegação nunca espera a animação: o push acontece imediatamente dentro do
 * callback e a transição é liberada no commit da nova rota (ou após um teto).
 */

type NavigateOptions = { direction?: NavDirection; scroll?: boolean; share?: HTMLElement | null; replace?: boolean };
type Navigate = (href: string, options?: NavigateOptions) => void;

const NavigationContext = createContext<Navigate | null>(null);
const SETTLE_CAP_MS = 1200;
/** Rotas do explorador eleitoral: a troca de nível tem coreografia própria (painel + câmera). */
const isExplorer = (path: string) => /^\/eleicoes\/\d+\/\d+(\/|$)/.test(path);
const pathOf = (href: string) => href.split(/[?#]/)[0];

type DocumentWithVT = Document & { startViewTransition?: Document["startViewTransition"] };

export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && typeof (document as DocumentWithVT).startViewTransition === "function";
}

/** Marca os descendentes `[data-vt]` de `root` como elementos compartilhados da transição. */
function markShared(root: HTMLElement | null | undefined): () => void {
  if (!root) return () => {};
  const nodes = [...(root.dataset.vt ? [root] : []), ...Array.from(root.querySelectorAll<HTMLElement>("[data-vt]"))];
  for (const n of nodes) n.style.viewTransitionName = `vt-${n.dataset.vt}`;
  return () => nodes.forEach((n) => (n.style.viewTransitionName = ""));
}

const FRAME_KEYFRAMES: Record<NavDirection, Keyframe[]> = {
  deeper: [
    { opacity: 0, transform: "scale(0.985)" },
    { opacity: 1, transform: "none" },
  ],
  shallower: [
    { opacity: 0, transform: "scale(1.012)" },
    { opacity: 1, transform: "none" },
  ],
  lateral: [
    { opacity: 0, transform: "translateX(6px)" },
    { opacity: 1, transform: "none" },
  ],
};

export function NavigationProvider({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const settle = useRef<(() => void) | null>(null);
  const vtActive = useRef(false);
  const pendingDirection = useRef<NavDirection | null>(null);
  // Cada transição recebe uma geração: só a mais recente pode limpar o estado global.
  const generation = useRef(0);

  // Commit da nova rota: libera a transição em curso.
  useLayoutEffect(() => {
    settle.current?.();
  }, [pathname]);

  // Voltar/avançar do navegador: a direção é deduzida dos caminhos, nunca herdada de um clique anterior.
  useEffect(() => {
    const onPop = () => (pendingDirection.current = null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback<Navigate>(
    (href, options = {}) => {
      const here = window.location.pathname + window.location.search;
      const direction = options.direction ?? directionBetween(here, href);
      const go = () => (options.replace ? router.replace(href, { scroll: options.scroll }) : router.push(href, { scroll: options.scroll }));
      const pathChanges = pathOf(href) !== window.location.pathname;
      const insideExplorer = isExplorer(pathOf(href)) && isExplorer(window.location.pathname);
      // Só uma troca de caminho consome a direção (filtros/query não deixam direção pendente).
      pendingDirection.current = pathChanges ? direction : null;

      if (!pathChanges || insideExplorer || !supportsViewTransitions() || prefersReducedMotion()) {
        go();
        return;
      }

      // Navegação consecutiva: libera imediatamente a transição anterior ainda aberta.
      settle.current?.();
      const id = ++generation.current;
      const root = document.documentElement;
      root.dataset.navDirection = direction;
      const unmark = markShared(options.share);
      vtActive.current = true;
      const transition = (document as DocumentWithVT).startViewTransition!(
        () =>
          new Promise<void>((resolve) => {
            let released = false;
            const done = () => {
              if (released) return;
              released = true;
              window.clearTimeout(cap);
              // Nunca apaga o liberador de uma transição mais nova.
              if (settle.current === done) settle.current = null;
              unmark();
              resolve();
            };
            const cap = window.setTimeout(done, SETTLE_CAP_MS);
            settle.current = done;
            go();
          }),
      );
      const cleanup = () => {
        if (generation.current !== id) return;
        vtActive.current = false;
        delete root.dataset.navDirection;
      };
      // Pulada por uma navegação mais nova, `ready` rejeita com AbortError: esperado, não é falha.
      transition.ready.catch(() => undefined);
      transition.finished.then(cleanup, cleanup);
    },
    [router],
  );

  return (
    <NavigationContext.Provider value={navigate}>
      <FrameDirection pathname={pathname} vtActive={vtActive} pendingDirection={pendingDirection} />
      {children}
    </NavigationContext.Provider>
  );
}

/** Quadro de conteúdo: entrada direcional quando a troca de rota não foi coberta por uma View Transition. */
function FrameDirection({
  pathname,
  vtActive,
  pendingDirection,
}: Readonly<{
  pathname: string;
  vtActive: React.MutableRefObject<boolean>;
  pendingDirection: React.MutableRefObject<NavDirection | null>;
}>) {
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname) return;
    const direction = pendingDirection.current ?? directionBetween(from, pathname);
    pendingDirection.current = null;
    if (vtActive.current || prefersReducedMotion() || (isExplorer(from) && isExplorer(pathname))) return;
    const frame = document.querySelector<HTMLElement>("[data-route-frame]");
    frame?.animate?.(FRAME_KEYFRAMES[direction], { duration: duration.traverse, easing: cssEasing("enter") });
  }, [pathname, vtActive, pendingDirection]);
  return null;
}

/** Fora do provider (testes de componente, Storybook) a navegação é a do documento. */
const documentNavigate: Navigate = (href, o) => (o?.replace ? window.location.replace(href) : window.location.assign(href));

export function useNavigate(): Navigate {
  return useContext(NavigationContext) ?? documentNavigate;
}

type TransitionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  /** Direção explícita quando a profundidade da rota não descreve a relação semântica. */
  direction?: NavDirection;
  /** Marca os `[data-vt]` deste link como elementos compartilhados com a próxima tela. */
  shareIdentity?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  children?: ReactNode;
};

/**
 * `next/link` com a gramática de transição. Cliques modificados (nova aba,
 * ctrl/cmd, botão do meio) seguem o comportamento nativo; o href continua real
 * (acessível, rastreável, funciona sem JS).
 */
export function TransitionLink({ href, direction, shareIdentity, scroll, prefetch, onClick, children, ...rest }: Readonly<TransitionLinkProps>) {
  const navigate = useContext(NavigationContext);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // Sem provider, o comportamento é exatamente o do next/link.
    if (!navigate || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigate(href, { direction, scroll, share: shareIdentity ? e.currentTarget : null });
  };
  return (
    <NextLink href={href} prefetch={prefetch} scroll={scroll} onClick={handle} {...rest}>
      {children}
    </NextLink>
  );
}
