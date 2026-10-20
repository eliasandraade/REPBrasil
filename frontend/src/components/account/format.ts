const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

/** "20/10/2026, 14:05" no horário de Brasília. */
export const formatDateTime = (iso: string) => DATE_TIME.format(new Date(iso));

/** "20 de outubro de 2026" no horário de Brasília. */
export const formatDate = (iso: string) => DATE.format(new Date(iso));

/** Tipo de recurso salvo, em português. */
export const RESOURCE_LABEL: Record<string, string> = {
  politician: "Político",
  party: "Partido",
  municipality: "Município",
  state: "Estado",
  election: "Eleição",
  candidacy: "Candidatura",
  poll: "Pesquisa",
  ranking: "Ranking",
  indicator: "Dados",
};

/** Tipo de uso informado no perfil (opcional). */
export const USAGE_TYPE_LABEL: Record<string, string> = {
  eleitor: "Eleitor",
  estudante_pesquisador: "Estudante ou pesquisador",
  jornalista: "Jornalista",
  assessor_politico: "Assessor político",
  servidor_publico: "Profissional do setor público",
  outro: "Outro",
};
