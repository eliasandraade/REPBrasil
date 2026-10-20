import { TransitionLink } from "@/motion/navigation";

/**
 * Uso de um limite do plano ("7 de 10"). Barra fina com o número escrito ao lado: a cor nunca é a única pista.
 * Acima do limite (limite reduzido depois), mostra o uso real; nada é apagado.
 */
export function UsageMeter({ label, used, max, unit }: Readonly<{ label: string; used: number; max: number; unit?: string }>) {
  const full = used >= max;
  const ratio = max > 0 ? Math.min(used / max, 1) : 1;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body-sm text-fg-soft">{label}</span>
        <span className="tabular-nums text-body-sm text-fg">
          {used.toLocaleString("pt-BR")} <span className="text-fg-muted">de {max.toLocaleString("pt-BR")}{unit ? ` ${unit}` : ""}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(used, max)}
        aria-valuetext={`${used} de ${max}`}
        className="mt-2 h-1 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full rounded-full ${full ? "bg-warn" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      {full && (
        <p className="mt-1.5 text-micro text-warn">
          Limite do plano atingido.{" "}
          <TransitionLink href="/planos" className="focus-ring rounded underline underline-offset-2">
            Ver planos
          </TransitionLink>
        </p>
      )}
    </div>
  );
}
