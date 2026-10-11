/**
 * Endereço público do site e permissão de indexação. Por padrão NADA é indexado: só com
 * NEXT_PUBLIC_SITE_URL (endereço definitivo) e NEXT_PUBLIC_ALLOW_INDEXING=true os buscadores são
 * convidados — ambiente local e staging nunca aparecem em busca.
 */
export const SITE_NAME = "REPBrasil";

/** "https://x.org///" → "https://x.org" (sem regex: nada de retrocesso). */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

export const SITE_URL: string | null = withoutTrailingSlashes(process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "") || null;

export const INDEXING: boolean = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true" && SITE_URL !== null;

/** Nomes oficiais das UFs (IBGE), pela sigla. */
export const UF_NAMES: Readonly<Record<string, string>> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

export const UFS = Object.keys(UF_NAMES);

export const ufName = (uf: string | null | undefined) => (uf ? UF_NAMES[uf.toUpperCase()] ?? uf.toUpperCase() : null);
