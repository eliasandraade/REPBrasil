"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/motion/reduced-motion";
import { cssEasing, duration } from "@/motion/tokens";

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

/**
 * Abas do perfil como camadas do mesmo documento: o indicador desliza até a
 * aba escolhida (continuidade de posição) e o conteúdo entra pelo lado da
 * direção da escolha. A identidade do político, acima, nunca se move.
 * Teclado: ←/→, Home/End (padrão WAI-ARIA de tabs com ativação automática).
 */
export function ProfileTabs<T extends string>({
  tabs,
  active,
  onChange,
  idPrefix,
  children,
}: Readonly<{
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  idPrefix: string;
  children: ReactNode;
}>) {
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previous = useRef<T>(active);
  const placed = useRef(false);
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === active));
  const order = tabs.map((t) => t.id).join("|");

  // Indicador: mede a aba ativa (só quando ela muda) e desliza via transform.
  useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    const button = list?.querySelector<HTMLButtonElement>(`[data-tab="${active}"]`);
    if (!list || !indicator || !button) return;
    // Base de 100px escalada: só transform (compositor), nunca width.
    const place = () => (indicator.style.transform = `translateX(${button.offsetLeft}px) scaleX(${button.offsetWidth / 100})`);
    if (!placed.current) {
      // Primeira posição (inclusive deep link): sem deslizar a partir do zero.
      indicator.style.transition = "none";
      place();
      indicator.getBoundingClientRect(); // aplica a posição antes de reativar a transição
      indicator.style.transition = "";
      placed.current = true;
    } else {
      place();
      button.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [active, tabs.length]);

  // Conteúdo: entra pelo lado da direção da escolha (sem manter o conteúdo anterior).
  useLayoutEffect(() => {
    const from = order.split("|").indexOf(previous.current);
    previous.current = active;
    if (reduced || from === activeIndex || from < 0) return;
    const dx = activeIndex > from ? 10 : -10;
    panelRef.current?.animate?.(
      [
        { opacity: 0, transform: `translateX(${dx}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: duration.settle, easing: cssEasing("enter") },
    );
  }, [active, activeIndex, reduced, order]);

  const targetIndex = (key: string): number | null => {
    if (key === "ArrowRight") return (activeIndex + 1) % tabs.length;
    if (key === "ArrowLeft") return (activeIndex - 1 + tabs.length) % tabs.length;
    if (key === "Home") return 0;
    if (key === "End") return tabs.length - 1;
    return null;
  };

  // O teclado é tratado na aba focada (elemento interativo), não na lista.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = targetIndex(e.key);
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next].id}"]`)?.focus();
  };

  return (
    <div className="rounded-xl border border-white/8 bg-card">
      <div className="border-b border-white/8">
        <div ref={listRef} role="tablist" aria-label="Seções do perfil" className="relative flex overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${idPrefix}-panel`}
                tabIndex={selected ? 0 : -1}
                data-tab={tab.id}
                onClick={() => onChange(tab.id)}
                onKeyDown={onKeyDown}
                className={`relative flex-shrink-0 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--motion-acknowledge)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                  selected ? "text-brand" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          <span
            ref={indicatorRef}
            aria-hidden="true"
            data-testid="tab-indicator"
            className="tab-indicator pointer-events-none absolute bottom-0 left-0 h-0.5 w-[100px] origin-left bg-brand"
          />
        </div>
      </div>
      <div
        ref={panelRef}
        role="tabpanel"
        id={`${idPrefix}-panel`}
        aria-labelledby={`${idPrefix}-tab-${active}`}
        tabIndex={0}
        className="p-5 focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
