/**
 * Formatação da apuração ao vivo (pt-BR). Fonte única: nenhum componente formata número, percentual ou horário
 * por conta própria.
 *
 * - `null`/`undefined` → "—" (não publicado pela fonte), NUNCA zero.
 * - Horários sempre no fuso oficial da eleição (America/Sao_Paulo), nunca no relógio do navegador.
 * - Nenhum arredondamento acontece antes da exibição: o contrato traz a precisão oficial do TSE.
 */

export const NA = "—";
export const ELECTION_TIME_ZONE = "America/Sao_Paulo";

const isNumber = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const fixedCache = new Map<number, Intl.NumberFormat>();
const signedCache = new Map<number, Intl.NumberFormat>();

function fixed(digits: number): Intl.NumberFormat {
  let f = fixedCache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    fixedCache.set(digits, f);
  }
  return f;
}

function signed(digits: number): Intl.NumberFormat {
  let f = signedCache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "exceptZero" });
    signedCache.set(digits, f);
  }
  return f;
}

/** 12.345.678 */
export function formatVotes(n: number | null | undefined): string {
  return isNumber(n) ? integer.format(n) : NA;
}

/** Inteiro com separador de milhar (seções, eleitores, municípios). */
export function formatInteger(n: number | null | undefined): string {
  return isNumber(n) ? integer.format(n) : NA;
}

/** Quantidade de seções (12.345). */
export const formatSections = formatInteger;

/** 51,23% (precisão configurável: `formatPercent(99.987654, 6)` → 99,987654%). */
export function formatPercent(p: number | null | undefined, digits = 2): string {
  return isNumber(p) ? `${fixed(digits).format(p)}%` : NA;
}

/** +2,41 p.p. (sinal explícito, com o sinal de menos tipográfico; zero sem sinal). */
export function formatPercentagePoints(pp: number | null | undefined, digits = 2): string {
  return isNumber(pp) ? `${signed(digits).format(pp).replace("-", "−")} p.p.` : NA;
}

/** Diferença de votos com sinal (+1.234 / −1.234). */
export function formatSignedVotes(n: number | null | undefined): string {
  if (!isNumber(n)) return NA;
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${integer.format(Math.abs(n))}`;
}

/**
 * Casas decimais do percentual de totalização: perto de 100% duas casas escondem o que falta
 * (99,99% pode ser 99,987654%). Até 99%: 2 casas; de 99% a 99,99%: 4; acima de 99,99% (exceto 100): 6.
 */
export function sectionsPrecision(pct: number | null | undefined): number {
  if (!isNumber(pct) || pct >= 100 || pct < 99) return 2;
  return pct < 99.99 ? 4 : 6;
}

/** Percentual de seções totalizadas com precisão adaptativa (99,987654%). */
export function formatSectionsPct(pct: number | null | undefined): string {
  return formatPercent(pct, sectionsPrecision(pct));
}

/** Percentual com toda a precisão publicada pelo TSE (até 9 casas, sem zeros à direita), para dicas e detalhes. */
export function formatPercentExact(p: number | null | undefined): string {
  if (!isNumber(p)) return NA;
  const text = p.toFixed(9).replace(/\.?0+$/, "");
  const [whole, frac] = text.split(".");
  const grouped = integer.format(Number(whole));
  return `${frac ? `${grouped},${frac}` : grouped}%`;
}

/** 12,3 mi · 4,3 mil (eixos e rótulos curtos). */
export function formatIntegerCompact(n: number | null | undefined): string {
  return isNumber(n) ? compact.format(n) : NA;
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: ELECTION_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const timeSecFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: ELECTION_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: ELECTION_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const longDateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: ELECTION_TIME_ZONE, day: "numeric", month: "long", year: "numeric" });

export type TimestampStyle = "time" | "time-seconds" | "datetime";

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Horário em Brasília: "19:32" (time), "19:32:41" (time-seconds) ou "25/10 19:32:41" (datetime). */
export function formatTimestamp(iso: string | null | undefined, style: TimestampStyle = "time-seconds"): string {
  const d = toDate(iso);
  if (!d) return NA;
  if (style === "time") return timeFmt.format(d);
  if (style === "time-seconds") return timeSecFmt.format(d);
  return dateTimeFmt.format(d).replace(",", "");
}

/** "25 de outubro de 2026" a partir de AAAA-MM-DD (meio-dia em Brasília, para não escorregar de dia). */
export function formatElectionDate(date: string | null | undefined): string {
  if (!date) return NA;
  const d = toDate(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00-03:00` : date);
  return d ? longDateFmt.format(d) : NA;
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "always", style: "short" });

/** "agora", "há 12 s", "há 3 min", "há 2 h". */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const d = toDate(iso);
  if (!d) return NA;
  const seconds = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 5) return "agora";
  if (abs < 60) return relative.format(seconds, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
}

/** Duração curta: "1,2 s", "45 s", "3 min 20 s", "2 h 05 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!isNumber(seconds) || seconds < 0) return NA;
  if (seconds < 10) return `${fixed(1).format(seconds)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const total = Math.round(seconds);
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Votos por minuto ("12.345/min"). */
export function formatRate(n: number | null | undefined): string {
  return isNumber(n) ? `${integer.format(Math.round(n))}/min` : NA;
}
