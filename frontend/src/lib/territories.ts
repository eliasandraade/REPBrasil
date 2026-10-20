import { fetchJson } from "./api";

/** UF do catálogo territorial (IBGE), com o total de municípios cadastrados. */
export interface TerritoryState {
  code: string;
  name: string;
  ibgeCode: number | null;
  municipalities: number;
}

/** Município do catálogo territorial: código IBGE (7 dígitos), nome, slug e código TSE (5 dígitos). */
export interface TerritoryMunicipality {
  ibgeCode: string;
  name: string;
  slug: string;
  tseCode: string;
  stateCode: string;
}

/** Catálogo territorial independente de eleição: serve a escolha de território, não diz que há dado carregado. */
export const territoriesApi = {
  states: () => fetchJson<TerritoryState[]>("/api/v1/territories/states"),
  municipalities: (uf: string) =>
    fetchJson<TerritoryMunicipality[]>(`/api/v1/territories/states/${encodeURIComponent(uf.toUpperCase())}/municipalities`),
};

/** UF pelo prefixo do código IBGE do município (2 primeiros dígitos). */
const UF_BY_IBGE_PREFIX: Readonly<Record<string, string>> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export const ufOfIbgeCode = (ibgeCode: string): string | null => UF_BY_IBGE_PREFIX[ibgeCode.slice(0, 2)] ?? null;
