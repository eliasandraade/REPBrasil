"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Painel modal lateral (gaveta) acessível: foco preso dentro, Esc fecha, foco devolvido a quem abriu.
 * Em celular ocupa a largura toda; no desktop, uma coluna à direita.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  testId,
  wide = false,
}: Readonly<{ open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; testId?: string; wide?: boolean }>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid={testId}>
      <button type="button" aria-label="Fechar painel" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-fg/30" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex h-full w-full flex-col overflow-y-auto border-l border-line bg-canvas shadow-lg outline-none ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-heading-sm text-fg">
              {title}
            </h2>
            {subtitle ? <div className="mt-0.5 text-body-sm text-fg-muted">{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="focus-ring rounded-lg border border-line px-3 py-1.5 text-body-sm font-medium text-fg-soft hover:bg-subtle">
            Fechar
          </button>
        </div>
        <div className="flex-1 px-4 py-4 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
