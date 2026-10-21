/**
 * Nome da UF dentro de uma frase, com a contração certa: "do Ceará", "da Bahia", "de São Paulo"; "no Ceará",
 * "na Bahia", "em São Paulo". Sem artigo conhecido, usa a forma sem artigo.
 */
const ARTICLE: Readonly<Record<string, "o" | "a" | null>> = {
  AC: "o", AL: null, AM: "o", AP: "o", BA: "a", CE: "o", DF: "o", ES: "o", GO: null,
  MA: "o", MG: null, MS: null, MT: null, PA: "o", PB: "a", PE: null, PI: "o", PR: "o",
  RJ: "o", RN: "o", RO: null, RR: null, RS: "o", SC: null, SE: null, SP: null, TO: "o",
};

const FORMS = { de: { o: "do", a: "da", none: "de" }, em: { o: "no", a: "na", none: "em" } } as const;

function form(kind: "de" | "em", uf: string | null | undefined): string {
  const article = uf ? ARTICLE[uf.toUpperCase()] : null;
  return FORMS[kind][article ?? "none"];
}

/** Só a preposição ("do", "da", "de"), para quando o nome vai num elemento à parte. */
export const ufOfPreposition = (uf: string | null | undefined) => form("de", uf);

/** "do Ceará", "da Bahia", "de São Paulo". */
export const ofUf = (uf: string | null | undefined, name: string) => `${form("de", uf)} ${name}`;

/** "no Ceará", "na Bahia", "em São Paulo". */
export const inUf = (uf: string | null | undefined, name: string) => `${form("em", uf)} ${name}`;
