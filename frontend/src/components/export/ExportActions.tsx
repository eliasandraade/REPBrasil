"use client";

import { useState } from "react";
import { downloadReport, type ExportFormat, type ExportReport } from "@/lib/export/report";

const LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "XLSX",
  pdf: "PDF",
  png: "PNG",
};

export function ExportActions({ report }: Readonly<{ report: ExportReport }>) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState(false);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setError(false);
    try {
      // A URL reproduzível é a da barra no momento do clique. Lida na renderização, ela pode ser a anterior a um
      // router.replace: o React já renderiza com os parâmetros novos antes de o navegador gravar a URL no histórico.
      await downloadReport({ ...report, url: window.location.href }, format);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="export-actions">
      <span className="text-xs text-fg-muted">Exportar:</span>
      {(Object.keys(LABELS) as ExportFormat[]).map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(format)}
          className="focus-ring rounded-md border border-line-strong px-2.5 py-1 text-xs text-fg-soft hover:border-accent/50 disabled:cursor-wait disabled:opacity-60"
        >
          {busy === format ? "Gerando…" : LABELS[format]}
        </button>
      ))}
      <span role="status" aria-live="polite" className="text-xs text-warn">
        {error ? "Não foi possível gerar o arquivo." : ""}
      </span>
    </div>
  );
}
