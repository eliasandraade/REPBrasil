/**
 * Glossário eleitoral: os termos que aparecem nas telas, em linguagem simples. Fonte única para as dicas
 * (<Term>) e para a página /glossario. Definições descritivas, sem juízo — e coerentes com a regra da casa:
 * ausência de dado não é zero.
 */
export interface GlossaryEntry {
  term: string;
  /** Uma ou duas frases: o que aparece na dica. */
  short: string;
  /** Complemento para a página do glossário (opcional). */
  more?: string;
}

export const GLOSSARY = {
  "boletim-de-urna": {
    term: "Boletim de Urna (BU)",
    short: "O extrato que cada urna imprime ao fim da votação, com os votos de cada número. O TSE publica todos: é a fonte dos resultados por seção.",
  },
  secao: {
    term: "Seção eleitoral",
    short: "O lugar de votação de um grupo de eleitores. Cada seção tem uma urna.",
  },
  "secao-agregada": {
    term: "Seção agregada",
    short: "Seção que votou na urna de outra (a principal). Eleitores e votos dela já estão somados na principal.",
  },
  "zona-eleitoral": {
    term: "Zona eleitoral",
    short: "A unidade da Justiça Eleitoral (um cartório) responsável por um conjunto de seções. Pode cobrir parte de um município ou vários municípios.",
  },
  aptos: {
    term: "Eleitores aptos",
    short: "Eleitores com direito a votar naquela seção (somando as agregadas).",
  },
  abstencao: {
    term: "Abstenção",
    short: "Eleitores aptos que não compareceram para votar.",
  },
  "votos-validos": {
    term: "Votos válidos",
    short: "Votos nominais (no número de um candidato) mais votos de legenda (no número de um partido). Brancos e nulos não entram. É a base dos percentuais.",
    more: "Lei 9.504/1997, art. 5º.",
  },
  "votacao-nominal": {
    term: "Votação nominal",
    short: "Voto dado no número de um candidato.",
  },
  legenda: {
    term: "Voto de legenda",
    short: "Voto dado só no número do partido, nas eleições proporcionais (vereador e deputado). Conta para o partido, não para um candidato.",
  },
  qp: {
    term: "Eleito por QP",
    short: "Eleito pelas vagas que o partido ou federação conquistou com o quociente partidário (seus votos válidos divididos pelo quociente eleitoral).",
  },
  media: {
    term: "Eleito por média",
    short: "Eleito numa vaga de sobra, distribuída depois do quociente partidário pelo cálculo das maiores médias.",
  },
  suplente: {
    term: "Suplente",
    short: "Não eleito, mas na fila do partido ou federação para assumir a vaga se um eleito sair.",
  },
  chapa: {
    term: "Chapa",
    short: "Vice e suplentes são votados junto com o titular: os votos são da chapa, não de cada um.",
  },
  comparavel: {
    term: "Comparável",
    short: "Duas votações só têm saldo direto quando a disputa é a mesma (mesmo cargo e unidade) e o território é o mesmo. Fora disso, os números aparecem lado a lado, sem saldo.",
  },
  "composicao-mudou": {
    term: "Composição da seção mudou",
    short: "A seção existe nas duas eleições, mas com outras seções agregadas a ela: os eleitores não são os mesmos, então não há saldo direto.",
  },
  "sem-cobertura": {
    term: "Sem cobertura",
    short: "Não há Boletim de Urna importado para aquele lugar e eleição. Não é zero: é ausência de dado.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof GLOSSARY;

/** Termo do glossário para o resultado oficial do TSE ("ELEITO POR QP" → qp), quando houver. */
export function outcomeTerm(outcome: string | null | undefined): GlossaryId | null {
  const o = (outcome ?? "").toUpperCase();
  if (o.includes("QP")) return "qp";
  if (o.includes("MÉDIA") || o.includes("MEDIA")) return "media";
  if (o.includes("SUPLENTE")) return "suplente";
  return null;
}
