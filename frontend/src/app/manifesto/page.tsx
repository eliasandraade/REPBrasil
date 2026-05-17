import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Manifesto — REPBrasil",
  description:
    "Manifesto por uma inteligência pública mais clara. O REPBrasil existe para organizar dados públicos brasileiros em uma experiência rastreável e auditável.",
};

function CommitmentCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 rounded-lg border border-white/8 bg-card p-4">
      <div className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-200">{title}</p>
        <p className="text-sm leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export default function ManifestoPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <div className="hero-gradient border-b border-white/8 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            REPBrasil
          </Link>

          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
            Posicionamento institucional
          </div>

          <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight text-slate-100 sm:text-4xl">
            Manifesto por uma inteligência{" "}
            <span className="text-gradient-brand">pública mais clara.</span>
          </h1>
          <p className="text-base leading-relaxed text-slate-400">
            Por que o REPBrasil existe e como opera.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Main text */}
        <div className="mb-12 space-y-6 text-base leading-relaxed text-slate-400">
          <p>
            O Brasil não sofre por falta de dados. Sofre porque dados públicos,
            dispersos e difíceis de interpretar, raramente viram compreensão
            pública.
          </p>
          <p>
            Existe uma distância real entre o dado disponível e a informação
            compreensível. Declarações patrimoniais existem, mas estão em
            planilhas brutas. Resultados eleitorais existem, mas fragmentados
            por ciclo, por cargo, por estado. Candidaturas existem, mas exigem
            familiaridade técnica para serem localizadas.
          </p>
          <p className="text-slate-300">
            O REPBrasil nasce para reduzir essa distância.
          </p>
          <p>
            Organizamos informações oficiais sobre agentes políticos brasileiros
            em uma experiência clara, rastreável e auditável. Não somos partido.
            Não somos governo. Não somos tribunal.
          </p>
          <p>
            Somos uma infraestrutura tecnológica para ampliar a transparência,
            a análise e a responsabilidade pública.
          </p>
        </div>

        {/* Divider with accent */}
        <div className="mb-10 flex items-center gap-4">
          <div className="h-px flex-1 bg-white/8" />
          <div className="h-2 w-2 rounded-full bg-brand/50" />
          <div className="h-px flex-1 bg-white/8" />
        </div>

        {/* Principles */}
        <div className="mb-12">
          <h2 className="mb-6 text-lg font-bold text-slate-100">
            Princípios operacionais
          </h2>
          <div className="space-y-4 text-base leading-relaxed text-slate-400">
            <div className="border-l-2 border-brand/40 pl-4">
              <p className="font-medium text-slate-200">Rastreabilidade sobre afirmação.</p>
              <p className="mt-1">
                Toda informação exibida deve apontar para uma fonte. Nenhum dado é
                exibido sem origem verificável. SHA-256 de cada arquivo-fonte está
                disponível para auditoria.
              </p>
            </div>
            <div className="border-l-2 border-brand/40 pl-4">
              <p className="font-medium text-slate-200">Contexto sobre número isolado.</p>
              <p className="mt-1">
                Toda métrica deve ser explicável. Transparência sem método vira
                ruído. Dados sem contexto viram confusão. Tecnologia sem
                responsabilidade vira risco.
              </p>
            </div>
            <div className="border-l-2 border-brand/40 pl-4">
              <p className="font-medium text-slate-200">Limitação declarada antes de omitida.</p>
              <p className="mt-1">
                Toda limitação deve ser declarada. A base está em expansão. A
                metodologia está em refinamento. Nenhum score definitivo é exibido
                nesta fase. A honestidade sobre o estágio atual é parte do produto.
              </p>
            </div>
            <div className="border-l-2 border-brand/40 pl-4">
              <p className="font-medium text-slate-200">Contestação como direito.</p>
              <p className="mt-1">
                Toda pessoa citada deve ter caminho para contestar dados
                inconsistentes. Políticos, assessorias e cidadãos podem solicitar
                revisão mediante indicação de fonte oficial ou documento
                comprobatório.
              </p>
            </div>
            <div className="border-l-2 border-brand/40 pl-4">
              <p className="font-medium text-slate-200">Neutralidade radical.</p>
              <p className="mt-1">
                Nenhuma afirmação sem fonte. Nenhum juízo moral. Nenhum ranque de
                virtude. Os dados falam por si quando organizados com rigor.
              </p>
            </div>
          </div>
        </div>

        {/* Commitments grid */}
        <div className="mb-12">
          <h2 className="mb-6 text-lg font-bold text-slate-100">
            Compromissos da Andrade Systems com o REPBrasil
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <CommitmentCard
              title="Neutralidade institucional"
              description="Nenhuma afiliação partidária, governamental ou ideológica. Dados e metodologia são públicos e auditáveis."
            />
            <CommitmentCard
              title="Rastreabilidade integral"
              description="Cada dado aponta para uma fonte pública. SHA-256, data de importação e URL original estão disponíveis."
            />
            <CommitmentCard
              title="Contestação fundamentada"
              description="Canal dedicado para revisão de informações mediante indicação de fonte oficial ou documento comprobatório."
            />
            <CommitmentCard
              title="Melhoria contínua da metodologia"
              description="O score e os critérios analíticos serão publicados e explicados antes de qualquer resultado ser exibido."
            />
            <CommitmentCard
              title="Transparência sobre o estágio"
              description="O produto está em desenvolvimento. As limitações atuais são informadas claramente em todas as interfaces."
            />
            <CommitmentCard
              title="Dados a serviço da compreensão"
              description="O objetivo final não é ranquear políticos, mas tornar a vida pública brasileira mais compreensível."
            />
          </div>
        </div>

        {/* Closing */}
        <div className="rounded-xl border border-brand/20 bg-brand/5 p-6">
          <p className="mb-4 text-base font-medium leading-relaxed text-slate-200">
            &ldquo;O REPBrasil existe para transformar dados públicos em inteligência
            cívica compreensível.&rdquo;
          </p>
          <p className="text-sm text-slate-500">
            REPBrasil é um produto da{" "}
            <span className="font-semibold text-slate-400">Andrade Systems</span>.
            Desenvolvido com foco em neutralidade, rastreabilidade e responsabilidade
            institucional.
          </p>
        </div>

        {/* Navigation */}
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/politicos"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-900 transition-all hover:bg-brand-light"
          >
            Buscar políticos →
          </Link>
          <Link
            href="/suporte"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:border-white/25 hover:bg-white/10"
          >
            Central de suporte
          </Link>
        </div>
      </div>
    </main>
  );
}
