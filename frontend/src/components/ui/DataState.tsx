import type { ReactNode } from "react";

/**
 * Estados de dado com um vocabulário só, em todas as telas. Cada um afirma uma coisa diferente — e nenhum vira
 * zero: "sem cobertura" e "indisponível" não são "nenhum voto".
 */
export type DataStateKind =
  | "loading"
  | "empty"
  | "unavailable"
  | "no_coverage"
  | "not_comparable"
  | "error"
  | "partial"
  | "updated"
  | "processing";

export const DATA_STATE_LABEL: Record<DataStateKind, string> = {
  loading: "Carregando",
  empty: "Nada a mostrar",
  unavailable: "Indisponível no momento",
  no_coverage: "Sem cobertura",
  not_comparable: "Não comparável",
  error: "Erro ao carregar",
  partial: "Cobertura parcial",
  updated: "Atualizado",
  processing: "Em atualização",
};

const TONE: Record<DataStateKind, string> = {
  loading: "border-line",
  empty: "border-line",
  unavailable: "border-line",
  no_coverage: "border-line",
  not_comparable: "border-line",
  error: "border-warn/25",
  partial: "border-warn/25",
  updated: "border-line",
  processing: "border-warn/25",
};

/**
 * Bloco de estado (painel inteiro). `loading` mostra esqueleto com a altura pedida; `error` é anunciado como
 * alerta; os demais como status. O título diz o que aconteceu; `children` explica; `action` oferece a saída.
 */
export function DataState({
  kind,
  title,
  children,
  action,
  height = "h-24",
}: Readonly<{ kind: DataStateKind; title?: string; children?: ReactNode; action?: ReactNode; height?: string }>) {
  if (kind === "loading") {
    return <div className={`skeleton rounded-lg ${height}`} aria-busy="true" aria-label={title ?? DATA_STATE_LABEL.loading} data-state-kind="loading" />;
  }
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      data-state-kind={kind}
      className={`rounded-lg border bg-surface/60 px-4 py-4 text-sm text-fg-muted ${TONE[kind]}`}
    >
      <p className="font-medium text-fg-soft">{title ?? DATA_STATE_LABEL[kind]}</p>
      {children && <div className="mt-1 text-xs leading-relaxed text-fg-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Ação padrão de nova tentativa. */
export function RetryButton({ onRetry, children = "Tentar de novo" }: Readonly<{ onRetry: () => void; children?: ReactNode }>) {
  return (
    <button type="button" onClick={onRetry} className="focus-ring rounded text-xs font-medium text-accent-text hover:underline">
      {children}
    </button>
  );
}
