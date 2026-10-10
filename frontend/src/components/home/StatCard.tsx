/**
 * Número institucional da home. O valor é apresentado já pronto (o CSS o
 * revela por trás de uma máscara): nunca contamos de 0 até X, porque isso
 * sugeriria um dado chegando ao vivo. A explicação abre por hover no cartão
 * ou pelo botão de informação (teclado e leitores de tela).
 */
export function StatCard({
  value,
  label,
  note,
  hint,
  index,
}: Readonly<{ value: string; label: string; note?: string; hint: string; index: number }>) {
  const hintId = `stat-hint-${index}`;
  return (
    <div
      className="mi-hint-host mi-surface relative rounded-lg border border-white/8 bg-card p-4 text-center hover:border-brand/30 hover:bg-card-elevated"
      style={{ "--i": index } as React.CSSProperties}
    >
      <span aria-hidden="true" className="reveal-rule absolute inset-x-4 top-0 h-px bg-brand/50" />
      <p className="overflow-hidden text-2xl font-bold tabular-nums text-brand">
        <span className="reveal-value block">{value}</span>
      </p>
      <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
      {note && <p className="mt-0.5 text-xs text-slate-600">{note}</p>}
      <button
        type="button"
        aria-label={`Sobre: ${label}`}
        aria-describedby={hintId}
        className="focus-ring absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-slate-600 transition-colors duration-[var(--motion-acknowledge)] hover:text-slate-300 focus-visible:text-slate-300"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      <div
        id={hintId}
        role="tooltip"
        className="mi-hint pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 w-60 -translate-x-1/2 rounded-lg border border-white/10 bg-card-elevated p-3 text-left shadow-card"
      >
        <p className="text-xs leading-relaxed text-slate-400">{hint}</p>
      </div>
    </div>
  );
}
