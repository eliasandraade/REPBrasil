/**
 * Valores de indicador como texto, pela unidade publicada no catálogo. A unidade nunca é inventada: unidade
 * desconhecida aparece como veio, depois do número.
 */

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const threeDecimals = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

const plural = (value: number, one: string, many: string) => (Math.abs(value) === 1 ? one : many);

export function formatValue(value: number, unit: string): string {
  switch (unit.trim()) {
    case "%":
      return `${oneDecimal.format(value)}%`;
    case "pessoas":
      return `${integer.format(value)} ${plural(value, "pessoa", "pessoas")}`;
    case "R$":
      return money.format(value);
    case "R$ mil":
      return `R$ ${integer.format(value)} mil`;
    case "R$/pessoa":
      return `${money.format(value)} por pessoa`;
    case "índice":
      return threeDecimals.format(value);
    case "emendas":
      return `${integer.format(value)} ${plural(value, "emenda", "emendas")}`;
    case "votos":
      return `${integer.format(value)} ${plural(value, "voto", "votos")}`;
    default:
      return `${twoDecimals.format(value)} ${unit}`.trim();
  }
}

/** Forma curta para legendas (extremos de escala): números grandes em notação compacta (1,2 mi). */
export function formatShort(value: number, unit: string): string {
  const u = unit.trim();
  if (Math.abs(value) < 100_000 || u === "%" || u === "índice") return formatValue(value, u);
  if (u === "R$" || u === "R$/pessoa") return `R$ ${compact.format(value)}`;
  if (u === "R$ mil") return `R$ ${compact.format(value * 1000)}`;
  return `${compact.format(value)} ${u}`.trim();
}

export const formatInteger = (value: number) => integer.format(value);

/** Coeficiente com sinal e duas casas (−0,82). */
export function formatCoefficient(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const text = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return value < 0 ? `−${text}` : text;
}
