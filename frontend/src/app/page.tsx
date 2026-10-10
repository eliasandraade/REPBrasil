import type { CSSProperties, ReactNode } from "react";
import { SearchInput } from "@/components/politicians/SearchInput";
import { StatCard } from "@/components/home/StatCard";
import { TransitionLink } from "@/motion/navigation";
import { Reveal } from "@/motion/reveal";

const order = (i: number) => ({ "--i": i }) as CSSProperties;

// ─── Feature Card ─────────────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
  index,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  index: number;
}) {
  return (
    <div className="reveal-unfold mi-surface rounded-lg border border-white/8 bg-card p-5 hover:border-brand/30" style={order(index)}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-brand">
        {icon}
      </div>
      <h3 className="mb-1.5 font-semibold text-slate-100">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}

// ─── Source Badge ─────────────────────────────────────────────────────────────

function SourceBadge({
  name,
  org,
  type,
  index,
}: {
  name: string;
  org: string;
  type: string;
  index: number;
}) {
  return (
    <div className="relative z-10 flex items-start gap-3 rounded-lg border border-white/8 bg-card p-4">
      <div className="reveal-node mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand" style={order(index)} />
      <div>
        <p className="text-sm font-medium text-slate-200">{name}</p>
        <p className="text-xs text-slate-500">{org}</p>
        <p className="mt-1 text-xs text-slate-600">{type}</p>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function DatabaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" /><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" x2="20" y1="9" y2="9" /><line x1="4" x2="20" y1="15" y2="15" /><line x1="10" x2="8" y1="3" y2="21" /><line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function ScoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

function ArrowIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="mi-arrow" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
//
// Coreografia (docs/MOTION_SYSTEM.md · Home):
// 1. Entrada — registro documental: régua, selos de procedência carimbados,
//    anotação sob o objeto da plataforma e o visor que enquadra a busca.
//    O título é renderizado completo no servidor (sem texto "digitando").
// 2. Leitura (scroll) — cada seção tem uma função: consolidar (números),
//    desdobrar (capacidades), enquadrar (manifesto), conectar (fontes).
//    As limitações ficam imóveis de propósito: são um compromisso, não um efeito.
// 3. Microinteração — superfícies marcam o canto, setas apontam o destino,
//    pressionar escurece o tom; nada muda de tamanho ou de lugar.

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="hero-gradient relative overflow-hidden border-b border-white/8 py-16 md:py-24">
        <div className="bg-grid-pattern absolute inset-0 opacity-100" aria-hidden="true" />

        <div className="relative mx-auto max-w-4xl px-6">
          {/* Régua de abertura */}
          <div aria-hidden="true" className="hero-rule mx-auto mb-6 flex max-w-2xl items-center gap-2">
            <span className="h-2 w-px bg-brand/60" />
            <span className="h-px flex-1 bg-gradient-to-r from-brand/50 via-white/15 to-transparent" />
            <span className="h-2 w-px bg-white/20" />
          </div>

          {/* Selos de procedência */}
          <ul className="mb-6 flex flex-wrap items-center justify-center gap-2" aria-label="Procedência dos dados">
            <li className="hero-stamp inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-xs font-medium text-brand" style={order(0)}>
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
              Produto da Andrade Systems
            </li>
            <li className="hero-stamp inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400" style={order(1)}>
              Dados Públicos Oficiais · TSE
            </li>
            <li className="hero-stamp inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400" style={order(2)}>
              Fontes Rastreáveis · SHA-256
            </li>
            <li className="hero-stamp inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/8 px-3 py-1 text-xs text-amber-400" style={order(3)}>
              Base inicial em expansão
            </li>
          </ul>

          <h1 className="mb-4 text-center text-3xl font-bold leading-tight tracking-tight text-slate-100 sm:text-4xl md:text-5xl">
            Inteligência pública sobre <span className="hero-annotation">agentes políticos</span> brasileiros.
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-center text-base leading-relaxed text-slate-400 sm:text-lg">
            O REPBrasil organiza dados públicos oficiais, fontes rastreáveis e
            informações estruturadas para ampliar a compreensão sobre a vida
            pública no Brasil.
          </p>

          {/* Busca enquadrada: o instrumento central da consulta */}
          <div className="hero-viewfinder mx-auto mb-6 max-w-2xl">
            <span aria-hidden="true" className="vf-corner" data-c="tl" />
            <span aria-hidden="true" className="vf-corner" data-c="tr" />
            <span aria-hidden="true" className="vf-corner" data-c="bl" />
            <span aria-hidden="true" className="vf-corner" data-c="br" />
            <SearchInput placeholder="Busque por nome, cargo, partido, município ou UF" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <TransitionLink
              href="/politicos"
              className="mi-press focus-ring inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-brand-light"
            >
              Buscar político
              <ArrowIcon />
            </TransitionLink>
            <TransitionLink
              href="/manifesto"
              className="mi-press focus-ring inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:border-white/25 hover:bg-white/10 hover:text-slate-100"
            >
              Conhecer manifesto
            </TransitionLink>
          </div>
        </div>
      </section>

      {/* ── Números da plataforma — consolidação ──────────────────────────── */}
      <section className="border-b border-white/8 py-10" aria-label="Números da plataforma">
        <Reveal className="mx-auto grid max-w-4xl grid-cols-2 gap-3 px-6 sm:grid-cols-4">
          <StatCard
            index={0}
            value="1.000+"
            label="Políticos indexados"
            note="base inicial"
            hint="Base inicial com 1.000 políticos indexados, a partir dos dados eleitorais do TSE 2024. Expansão progressiva prevista com novos ciclos e integração com Câmara e Senado."
          />
          <StatCard
            index={1}
            value="3"
            label="Fontes oficiais TSE"
            note="candidatos · bens · resultados"
            hint="Três bases públicas do TSE: candidaturas 2024, bens declarados 2024 e resultados eleitorais 2024. Cada arquivo com hash SHA-256 e download original disponível."
          />
          <StatCard
            index={2}
            value="2024"
            label="Ciclo eleitoral"
            note="dados do TSE"
            hint="Dados importados do ciclo eleitoral de 2024. Importação de ciclos anteriores e de eleições suplementares está prevista nas próximas fases da plataforma."
          />
          <StatCard
            index={3}
            value="Em dev."
            label="Score REPBrasil"
            note="metodologia em construção"
            hint="O Score REPBrasil está em desenvolvimento. Nenhum índice é exibido antes da metodologia ser publicada, explicada e aberta à auditoria pública."
          />
        </Reveal>
      </section>

      {/* ── O que fazemos — desdobramento ─────────────────────────────────── */}
      <section className="border-b border-white/8 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-8 text-center">
            <h2 className="text-xl font-bold text-slate-100 sm:text-2xl">
              O que o REPBrasil faz
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Uma infraestrutura de inteligência cívica para dados públicos brasileiros.
            </p>
          </div>
          <Reveal className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              index={0}
              icon={<DatabaseIcon />}
              title="Organiza dados públicos"
              description="Coleta, estrutura e contextualiza dados eleitorais e declarações públicas em uma experiência navegável."
            />
            <FeatureCard
              index={1}
              icon={<LinkIcon />}
              title="Conecta fontes oficiais"
              description="Cada dado exibido aponta para uma fonte verificável. Download original disponível com hash SHA-256."
            />
            <FeatureCard
              index={2}
              icon={<UserIcon />}
              title="Estrutura perfis políticos"
              description="Perfis organizados com histórico eleitoral, patrimônio declarado, fontes vinculadas e score em desenvolvimento."
            />
            <FeatureCard
              index={3}
              icon={<ShieldIcon />}
              title="Rastreabilidade integral"
              description="SHA-256 de cada arquivo-fonte, data de importação e integridade verificável. Nada é afirmado sem origem."
            />
            <FeatureCard
              index={4}
              icon={<MessageIcon />}
              title="Contestação disponível"
              description="Políticos, assessorias e cidadãos podem solicitar revisão de informações mediante indicação de fonte oficial."
            />
            <FeatureCard
              index={5}
              icon={<ScoreIcon />}
              title="Score em desenvolvimento"
              description="Um índice explicável e auditável baseado em critérios objetivos. Metodologia em refinamento, sem score fake."
            />
          </Reveal>
        </div>
      </section>

      {/* ── Por que existe — enquadramento ────────────────────────────────── */}
      <section className="border-b border-white/8 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal className="rounded-xl border border-brand/20 bg-brand/5 p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-2">
              <div className="reveal-rule-out-left h-px flex-1 bg-brand/20" />
              <span className="text-xs font-semibold uppercase tracking-widest text-brand/70">
                Por que o REPBrasil existe
              </span>
              <div className="reveal-rule-out-right h-px flex-1 bg-brand/20" />
            </div>
            <blockquote className="mb-5 text-base leading-relaxed text-slate-300 sm:text-lg">
              &ldquo;O Brasil não sofre por falta de dados. Sofre porque dados públicos,
              dispersos e difíceis de interpretar, raramente viram compreensão pública.
              O REPBrasil nasce para organizar informações oficiais sobre agentes
              políticos brasileiros em uma experiência clara, rastreável e auditável.&rdquo;
            </blockquote>
            <TransitionLink
              href="/manifesto"
              className="focus-ring inline-flex items-center gap-2 rounded text-sm font-medium text-brand hover:text-brand-light"
            >
              <span className="mi-underline">Ler manifesto completo</span>
              <ArrowIcon size={13} />
            </TransitionLink>
          </Reveal>
        </div>
      </section>

      {/* ── Fontes e rastreabilidade — conexão ────────────────────────────── */}
      <section className="border-b border-white/8 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-8">
            <h2 className="mb-2 text-xl font-bold text-slate-100 sm:text-2xl">
              Fontes e rastreabilidade
            </h2>
            <p className="text-sm text-slate-500">
              Transparência é parte central do REPBrasil. Cada dado relevante aponta para uma fonte pública verificável.
            </p>
          </div>
          <Reveal className="relative mb-6 grid gap-3 sm:grid-cols-3">
            {/* A linha atravessa os intervalos entre as fontes: a procedência é uma cadeia. */}
            <span aria-hidden="true" className="reveal-connector absolute inset-x-0 top-[22px] hidden h-px bg-brand/40 sm:block" />
            <span aria-hidden="true" className="reveal-connector-v absolute inset-y-0 left-[20px] w-px bg-brand/40 sm:hidden" />
            <SourceBadge
              index={0}
              name="TSE — Candidatos 2024"
              org="Tribunal Superior Eleitoral"
              type="Dados de candidaturas e filiação partidária"
            />
            <SourceBadge
              index={1}
              name="TSE — Bens Declarados 2024"
              org="Tribunal Superior Eleitoral"
              type="Declarações patrimoniais dos candidatos"
            />
            <SourceBadge
              index={2}
              name="TSE — Resultados 2024"
              org="Tribunal Superior Eleitoral"
              type="Resultados eleitorais por cargo e município"
            />
          </Reveal>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5 rounded border border-white/8 bg-card px-2.5 py-1.5">
              <HashIcon />
              SHA-256 por arquivo-fonte
            </span>
            <span className="flex items-center gap-1.5 rounded border border-white/8 bg-card px-2.5 py-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              Download original disponível
            </span>
            <span className="flex items-center gap-1.5 rounded border border-white/8 bg-card px-2.5 py-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Data de importação registrada
            </span>
          </div>
        </div>
      </section>

      {/* ── Limitações honestas — imóvel de propósito ─────────────────────── */}
      <section className="border-b border-white/8 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-5 sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 flex-shrink-0" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <p className="text-sm font-semibold text-amber-400">Transparência sobre limitações</p>
            </div>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li>• Base inicial com 1.000 políticos indexados — em expansão progressiva.</li>
              <li>• Dados sujeitos a inconsistências herdadas das fontes originais (TSE).</li>
              <li>• Match entre candidatos e resultados eleitorais pode ser incompleto nesta fase.</li>
              <li>• Metodologia de score em refinamento — nenhum score definitivo é exibido.</li>
              <li>• Esta plataforma não substitui as fontes oficiais. Consulte sempre a fonte vinculada.</li>
              <li>• Contestação disponível para correções fundamentadas com fonte ou documento comprobatório.</li>
            </ul>
            <TransitionLink
              href="/suporte"
              className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded text-xs font-medium text-amber-400 hover:text-amber-300"
            >
              <span className="mi-underline">Contestar ou corrigir informação</span> →
            </TransitionLink>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/8 py-10">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-8 grid gap-8 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-brand/20 bg-brand/10">
                  <span className="text-sm font-black leading-none text-brand">R</span>
                </div>
                <span className="font-bold text-slate-100">REPBrasil</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Inteligência pública sobre agentes políticos brasileiros. Dados
                públicos oficiais, fontes rastreáveis.
              </p>
              <p className="mt-3 text-xs text-slate-600">
                Um produto da{" "}
                <span className="font-medium text-slate-500">Andrade Systems</span>.
              </p>
            </div>

            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Plataforma
              </p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><TransitionLink href="/politicos" className="mi-underline focus-ring rounded hover:text-slate-300">Buscar políticos</TransitionLink></li>
                <li><TransitionLink href="/manifesto" className="mi-underline focus-ring rounded hover:text-slate-300">Manifesto</TransitionLink></li>
                <li><TransitionLink href="/suporte" className="mi-underline focus-ring rounded hover:text-slate-300">Central de suporte</TransitionLink></li>
              </ul>
            </div>

            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Institucional
              </p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><TransitionLink href="/suporte" className="mi-underline focus-ring rounded hover:text-slate-300">Contestação de dados</TransitionLink></li>
                <li><span className="text-slate-700">Termos de uso</span></li>
                <li><span className="text-slate-700">Privacidade</span></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-white/8 pt-6 sm:flex-row">
            <p className="text-xs text-slate-600">
              © 2026 REPBrasil — um produto da Andrade Systems
            </p>
            <p className="text-xs text-slate-700">
              Dados públicos. Transparência sem militância.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
