"use client";

import { useCallback, type ElementType, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { prefersReducedMotion } from "./reduced-motion";

/**
 * Revelação na leitura. Um único IntersectionObserver para a página inteira;
 * nenhum estado React: o elemento passa de `data-reveal="pending"` para
 * `"in"` e o CSS (motion.css) descreve o que isso significa para cada peça
 * (.reveal-unfold, .reveal-rule, .reveal-value, .reveal-connector...).
 *
 * O HTML do servidor já sai com `pending`, para não haver o salto
 * visível → escondido → animado. Isso só esconde algo quando `html.js` existe
 * e o usuário não pediu Reduced Motion, e um failsafe em CSS revela tudo
 * mesmo que a hidratação falhe.
 */
let observer: IntersectionObserver | null = null;

function shared(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.reveal = "in";
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
  );
  return observer;
}

export function useReveal<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el) return;
    const io = shared();
    if (!io || prefersReducedMotion()) {
      el.dataset.reveal = "in";
      return;
    }
    io.observe(el);
  }, []);
}

type RevealProps<E extends ElementType> = { as?: E; children?: ReactNode } & Omit<ComponentPropsWithoutRef<E>, "as" | "children">;

export function Reveal<E extends ElementType = "div">({ as, children, ...rest }: RevealProps<E>) {
  const ref = useReveal<HTMLElement>();
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag ref={ref} data-reveal="pending" {...rest}>
      {children}
    </Tag>
  );
}
