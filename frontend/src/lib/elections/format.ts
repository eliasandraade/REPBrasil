/**
 * Formatação eleitoral. `—` é "não informado pela fonte", NUNCA zero:
 * nenhum formatador transforma `null`/`undefined` em 0.
 */

export const UNAVAILABLE = "—";

export const pad3 = (n: number) => String(n).padStart(3, "0");

export const zoneLabel = (n: number) => `Zona ${pad3(n)}`;

export const sectionLabel = (n: number) => `Seção ${pad3(n)}`;

export function formatCount(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("pt-BR") : UNAVAILABLE;
}

export function formatPercent(p: number | null | undefined): string {
  return typeof p === "number" && Number.isFinite(p)
    ? `${p.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : UNAVAILABLE;
}

export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Data do arquivo oficial ("DD/MM/AAAA HH:MM:SS") para exibição. */
export function sourceDate(raw: string | null | undefined): string | null {
  const m = raw ? /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(raw) : null;
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

/**
 * Nomes publicados pelo TSE vêm em caixa alta; a capitalização é só de
 * apresentação (identidade nunca depende dela).
 */
export function displayName(name: string | null | undefined): string {
  if (!name) return UNAVAILABLE;
  if (name !== name.toUpperCase()) return name;
  const lower = new Set(["da", "de", "do", "das", "dos", "e"]);
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && lower.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Resultado oficial do TSE ("ELEITO POR QP") em caixa de frase, mantendo a sigla: "Eleito por QP". */
export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return UNAVAILABLE;
  if (outcome !== outcome.toUpperCase()) return outcome;
  const lower = outcome.toLowerCase().replace(/\bqp\b/g, "QP");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const shortHash = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 12)}…` : UNAVAILABLE);
