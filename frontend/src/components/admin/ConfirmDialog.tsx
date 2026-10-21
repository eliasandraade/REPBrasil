"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * Confirmação de ação sensível com `<dialog>` modal nativo (foco preso no diálogo, Esc fecha). A ação só roda
 * no botão de confirmar; `children` traz o contexto (e campos, se a ação pedir).
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  tone = "default",
  busy = false,
  onConfirm,
  onClose,
  children,
}: Readonly<{
  open: boolean;
  title: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Sem showModal (navegador antigo, jsdom), o diálogo abre sem a camada modal.
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line-strong bg-surface p-0 text-fg shadow-card-hover backdrop:bg-canvas/70"
    >
      {open && (
        <form
          method="dialog"
          className="p-6"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <h2 id={`${id}-title`} className="text-heading-sm text-fg">{title}</h2>
          <div className="mt-3 space-y-3 text-body-sm text-fg-soft">{children}</div>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="focus-ring rounded-lg border border-line px-4 py-2 text-body-sm font-medium text-fg hover:bg-fg/[0.04]">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`focus-ring mi-press rounded-lg px-4 py-2 text-body-sm font-semibold disabled:opacity-60 ${
                tone === "danger" ? "border border-danger bg-danger/10 text-danger" : "bg-action text-action-fg"
              }`}
            >
              {busy ? "Aplicando…" : confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
