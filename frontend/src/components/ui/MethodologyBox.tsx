import type { ReactNode } from "react";

/** Bloco recolhível "Metodologia e definições": método, definições, atualização dos dados e extras (fontes etc.). */
export function MethodologyBox({
  methodology,
  definitions = {},
  freshness,
  title = "Metodologia e definições",
  children,
}: Readonly<{
  methodology: string;
  definitions?: Record<string, string>;
  freshness?: string | null;
  title?: string;
  children?: ReactNode;
}>) {
  const entries = Object.entries(definitions);
  return (
    <details className="rounded-lg border border-line bg-surface/60 px-4 py-3 text-xs text-fg-muted">
      <summary className="cursor-pointer font-medium text-fg-soft">{title}</summary>
      <p className="mt-2 leading-relaxed">{methodology}</p>
      {entries.length > 0 && (
        <dl className="mt-2 space-y-1">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt className="inline text-fg-soft">{k}: </dt>
              <dd className="inline">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {freshness && <p className="mt-2">{freshness}</p>}
      {children}
    </details>
  );
}
