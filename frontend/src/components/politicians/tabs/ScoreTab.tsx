import type { ScoreStatusItem } from "@/lib/types";

const FACTOR_CATEGORIES = [
  {
    key: "atividade_politica",
    label: "Atividade Política",
    description:
      "Histórico eleitoral e trajetória de cargos. Baseado exclusivamente em resultados eleitorais certificados pelo TSE.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
    ),
  },
  {
    key: "transparencia_patrimonial",
    label: "Transparência Patrimonial",
    description:
      "Consistência e completude das declarações de bens ao longo dos mandatos. Baseado em declarações ao TSE.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
    ),
  },
  {
    key: "rastreabilidade_fontes",
    label: "Rastreabilidade das Fontes",
    description:
      "Completude e integridade das fontes vinculadas ao perfil. Cada dado deve apontar para uma fonte verificável.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
    ),
  },
  {
    key: "responsabilidade_publica",
    label: "Responsabilidade Pública",
    description:
      "Presença em votações, apresentação de projetos e cumprimento de obrigações parlamentares. Dados da Câmara e Senado.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
    ),
  },
  {
    key: "consistencia_registros",
    label: "Consistência dos Registros",
    description:
      "Coerência entre os dados declarados em diferentes ciclos e fontes. Identificação de divergências documentais sem inferência de irregularidade.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
    ),
  },
];

interface ScoreTabProps {
  score?: ScoreStatusItem;
}

export function ScoreTab({ score }: ScoreTabProps) {
  const methodologyVersion = score?.methodologyVersion ?? "v0";

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="flex items-start gap-3 rounded-lg border border-white/[0.08] bg-card-elevated p-4">
        {/* Score circle placeholder */}
        <div className="flex-shrink-0 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-white/15">
          <span className="text-center text-[9px] font-semibold uppercase tracking-wide text-slate-600 leading-tight">
            Em<br />dev.
          </span>
        </div>
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-100">Score REPBrasil</h2>
            <span className="rounded border border-amber-500/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              Em desenvolvimento
            </span>
          </div>
          <p className="text-sm leading-relaxed text-slate-400">
            O Score REPBrasil será um índice explicável e auditável, construído a partir
            de critérios objetivos e fontes verificáveis. Nenhuma pontuação definitiva
            está sendo atribuída nesta fase.
          </p>
          <p className="mt-1.5 text-xs text-slate-600">
            Metodologia {methodologyVersion}
          </p>
        </div>
      </div>

      {/* In development notice */}
      <div className="rounded-lg border border-dashed border-white/10 p-4">
        <p className="mb-1.5 text-sm font-semibold text-slate-300">
          Por que o score ainda não está disponível?
        </p>
        <p className="text-sm leading-relaxed text-slate-500">
          O cálculo do Score REPBrasil exige validação metodológica rigorosa antes de qualquer
          resultado ser exibido. Os componentes planejados estão descritos abaixo. Quando ativos,
          cada fator terá sua fonte, peso e critério documentados publicamente.
        </p>
      </div>

      {/* Factor categories */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
          Componentes planejados
        </p>
        <div className="space-y-2">
          {FACTOR_CATEGORIES.map((cat) => (
            <div
              key={cat.key}
              className="flex items-start gap-3 rounded-lg border border-white/[0.08] bg-card-elevated px-4 py-3"
            >
              <div className="mt-0.5 flex-shrink-0 text-slate-600">{cat.icon}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-300">{cat.label}</p>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-600">
                    pendente
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{cat.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="rounded-md border border-white/[0.08] bg-card-elevated px-4 py-3 space-y-1.5">
        <p className="text-xs text-slate-500">
          {score?.disclaimer ??
            "Score em desenvolvimento. Não representa recomendação de voto, julgamento moral ou inferência automática."}
        </p>
        <p className="text-xs text-slate-600">
          Nenhuma pontuação foi atribuída a este agente político. Todas as informações desta
          página derivam de fontes públicas oficiais. Sem inferência automática ou interpretação
          opinativa.
        </p>
      </div>
    </div>
  );
}
