"use client";

import { useQuery } from "@tanstack/react-query";
import { PlanGateNote, useEntitlement } from "@/components/account/PlanGate";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { getCorrelationMatrix } from "@/lib/data-intelligence";
import { mix, SEQUENTIAL, type DataTheme } from "@/lib/dataviz/palette";
import { CORRELATION_MATRIX } from "@/lib/plans";
import { formatCoefficient, formatInteger } from "@/lib/territory/format";
import { STRENGTH_LABEL, strengthOf } from "@/lib/territory/insights";

/** Texto legível sobre a cor da célula (a rampa inverte no tema escuro): escuro em fundo claro e vice-versa. */
function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const luminance = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luminance < 0.55 ? "#ffffff" : "#0b1b2b";
}

/**
 * Matriz de correlação da UF (todos os pares de uma vez). Ferramenta do plano Avançado: cada par continua aberto na
 * comparação X × Y acima. A cor mede só a força da associação (|ρ|), nunca o sentido ou um juízo.
 */
export function MatrixSection({ uf, period, theme }: Readonly<{ uf: string; period: number; theme: DataTheme }>) {
  const gate = useEntitlement(CORRELATION_MATRIX);
  const matrix = useQuery({
    queryKey: ["correlation-matrix", uf, period],
    queryFn: () => getCorrelationMatrix(uf, period),
    enabled: gate.allowed === true,
    staleTime: 5 * 60_000,
  });
  return (
    <section aria-labelledby="matrix-title" className="rounded-xl border border-line bg-surface p-4" data-testid="matrix-section">
      <h2 id="matrix-title" className="font-semibold text-fg">Matriz de correlação</h2>
      <p className="mt-1 text-body-sm text-fg-muted">Todos os indicadores carregados para os municípios da UF ({uf}) em {period}, cruzados dois a dois (Spearman).</p>
      {gate.allowed === false && <PlanGateNote capability={CORRELATION_MATRIX} className="mt-3" />}
      {gate.allowed && !matrix.data && matrix.isPending && <DataState kind="loading" title="Calculando a matriz" height="h-40" />}
      {gate.allowed && !matrix.data && matrix.isError && (
        <DataState kind="error" title="Não foi possível calcular a matriz" action={<RetryButton onRetry={() => void matrix.refetch()} />} />
      )}
      {matrix.data && matrix.data.indicators.length < 2 && (
        <p className="mt-3 text-body-sm text-fg-muted">Há menos de dois indicadores com dado neste recorte; não há pares para cruzar.</p>
      )}
      {matrix.data && matrix.data.indicators.length >= 2 && (
        <div className="mt-3 overflow-x-auto">
          <table className="text-micro">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1" />
                {matrix.data.indicators.map((i) => (
                  <th key={i.code} scope="col" className="max-w-[9rem] px-2 py-1 text-left font-medium text-fg-muted">{i.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.data.indicators.map((row) => (
                <tr key={row.code}>
                  <th scope="row" className="max-w-[12rem] px-2 py-1 text-left font-medium text-fg-muted">{row.name}</th>
                  {matrix.data.indicators.map((col) => {
                    if (row.code === col.code) return <td key={col.code} className="px-2 py-1 text-center text-fg-muted">—</td>;
                    const cell = matrix.data.cells.find((c) => (c.x === row.code && c.y === col.code) || (c.x === col.code && c.y === row.code));
                    const strength = strengthOf(cell?.spearman ?? null);
                    const tone = cell?.spearman == null ? undefined : mix(SEQUENTIAL[theme].low, SEQUENTIAL[theme].high, Math.abs(cell.spearman));
                    const ink = tone ? inkOn(tone) : undefined;
                    return (
                      <td
                        key={col.code}
                        className="min-w-[5.5rem] px-2 py-1.5 text-center tabular-nums text-fg"
                        style={tone ? { background: tone, color: ink } : undefined}
                        title={strength ? `${STRENGTH_LABEL[strength]} · N = ${formatInteger(cell!.n)}` : "sem coeficiente"}
                      >
                        {formatCoefficient(cell?.spearman ?? null)}
                        <span className="block text-[10px] opacity-75">N {formatInteger(cell?.n ?? 0)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-micro leading-5 text-fg-muted">{matrix.data.methodology} {matrix.data.caveat}</p>
        </div>
      )}
    </section>
  );
}
