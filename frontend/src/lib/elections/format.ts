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

const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e", "del"]);
/** "d'água" → "D'Água", "não-me-toque" → "Não-Me-Toque": maiúscula no início e após hífen/apóstrofo. */
const titleWord = (w: string) => w.replace(/(^|[-'’])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());

/**
 * Nomes publicados pelo TSE vêm em CAIXA ALTA ou com toda palavra capitalizada ("Juazeiro Do Norte").
 * Apresentação: partículas soltas (da, de, do, das, dos, e, del) em minúscula, exceto na 1ª palavra; em
 * caixa alta, cada palavra é capitalizada antes. A grafia oficial (acentos, hífens, apóstrofos) é preservada
 * e a identidade nunca depende do nome.
 */
export function displayName(name: string | null | undefined): string {
  if (!name) return UNAVAILABLE;
  const upper = name === name.toUpperCase();
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && PARTICLES.has(lower)) return lower;
      return upper ? titleWord(lower) : w;
    })
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
