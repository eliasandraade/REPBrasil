"use client";

import type { ScoreStatusItem } from "@/lib/types";

const FACTOR_CATEGORIES = [
  {
    key: "integridade_publica",
    label: "Integridade Pública",
    description:
      "Registros em órgãos de controle, ações judiciais relevantes e condenações transitadas em julgado. Dados públicos e verificáveis.",
  },
  {
    key: "transparencia_patrimonial",
    label: "Transparência Patrimonial",
    description:
      "Consistência e completude das declarações de bens ao longo dos mandatos. Baseado em declarações ao TSE.",
  },
  {
    key: "responsabilidade_publica",
    label: "Responsabilidade Pública",
    description:
      "Presença em votações, apresentação de projetos e cumprimento de obrigações parlamentares. Dados da Câmara e Senado.",
  },
  {
    key: "estrutura_poder",
    label: "Estrutura de Poder",
    description:
      "Mapeamento de vínculos institucionais e partidários a partir de registros públicos. Nenhuma inferência sobre intenções ou relações pessoais.",
  },
  {
    key: "atividade_politica",
    label: "Atividade Política",
    description:
      "Histórico eleitoral e trajetória de cargos. Baseado exclusivamente em resultados eleitorais certificados pelo TSE.",
  },
];

interface ScoreTabProps {
  score?: ScoreStatusItem;
}

export function ScoreTab({ score }: ScoreTabProps) {
  const methodologyVersion = score?.methodologyVersion ?? "v0";

  return (
    <div className="space-y-8">
      {/* Status header */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">Score Público</h2>
        <p className="text-sm text-slate-600">
          O Score Público <strong>será</strong> uma pontuação composta baseada em
          dados públicos verificáveis. Cada componente é rastreável até sua fonte
          primária.
        </p>
        <p className="text-xs text-slate-400">
          Metodologia {methodologyVersion}
        </p>
      </div>

      {/* Em desenvolvimento notice */}
      <div className="border border-dashed border-slate-300 rounded p-4 space-y-1">
        <p className="text-sm font-medium text-slate-700">Em desenvolvimento</p>
        <p className="text-sm text-slate-500">
          O cálculo do Score Público ainda não está ativo. As categorias abaixo
          descrevem os componentes planejados. Nenhuma pontuação foi atribuída a
          este político.
        </p>
      </div>

      {/* Factor categories */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Componentes planejados
        </h3>
        <div className="divide-y divide-slate-100">
          {FACTOR_CATEGORIES.map((cat) => (
            <div key={cat.key} className="py-3 space-y-0.5">
              <p className="text-sm font-medium text-slate-800">{cat.label}</p>
              <p className="text-sm text-slate-500">{cat.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="border-t border-slate-100 pt-4 space-y-1">
        <p className="text-xs text-slate-400">
          {score?.disclaimer ??
            "Score Público em desenvolvimento. Não representa recomendação de voto, julgamento moral ou inferência automática."}
        </p>
        <p className="text-xs text-slate-400">
          Não há inferência automática nem interpretação opinativa. Todas as
          informações derivam de fontes públicas oficiais.
        </p>
      </div>
    </div>
  );
}
