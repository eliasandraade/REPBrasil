import Link from "next/link";
import { SearchInput } from "@/components/politicians/SearchInput";

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-card p-4 text-center">
      <p className="text-2xl font-bold text-brand">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
      {note && <p className="mt-0.5 text-xs text-slate-600">{note}</p>}
    </div>
  );
}

// ─── Feature Card ─────────────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-card p-5 transition-colors hover:border-brand/30">
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
}: {
  name: string;
  org: string;
  type: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/8 bg-card p-4">
      <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand" />
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="hero-gradient relative overflow-hidden border-b border-white/8 py-16 md:py-24">
        <div className="bg-grid-pattern absolute inset-0 opacity-100" />

        {/* Animated ambient orbs */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-orb-1 absolute left-[10%] top-[20%] h-72 w-72 rounded-full bg-brand/6 blur-[80px]" />
          <div className="animate-orb-2 absolute right-[8%] top-[30%] h-56 w-56 rounded-full bg-brand/5 blur-[70px]" />
          <div className="animate-orb-3 absolute left-[55%] bottom-[-5%] h-64 w-64 rounded-full bg-brand/4 blur-[90px]" />
        </div>

        <div className="relative mx-auto max-w-4xl px-6">

          {/* Badge bar */}
          <div className="mb-6 flex flex-wrap items-center justify-center gap-2 animate-fade-in-up" style={{ animationDelay: "0ms" }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Produto da Andrade Systems
            </span>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
              Dados Públicos Oficiais · TSE
            </span>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
              Fontes Rastreáveis · SHA-256
            </span>
            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/8 px-3 py-1 text-xs text-amber-400">
              Base inicial em expansão
            </span>
          </div>

          {/* Title */}
          <h1 className="mb-4 text-center text-3xl font-bold leading-tight tracking-tight text-slate-100 sm:text-4xl md:text-5xl animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            Inteligência pública sobre{" "}
            <span className="text-gradient-brand">agentes políticos</span>{" "}
            brasileiros.
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mb-10 max-w-2xl text-center text-base leading-relaxed text-slate-400 sm:text-lg animate-fade-in-up" style={{ animationDelay: "240ms" }}>
            O REPBrasil organiza dados públicos oficiais, fontes rastreáveis e
            informações estruturadas para ampliar a compreensão sobre a vida
            pública no Brasil.
          </p>

          {/* Search */}
          <div className="mx-auto mb-6 max-w-2xl">
            <SearchInput placeholder="Busque por nome, cargo, partido, município ou UF" />
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 animate-fade-in-up" style={{ animationDelay: "360ms" }}>
            <Link
              href="/politicos"
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-brand-sm transition-all hover:bg-brand-light hover:shadow-brand"
            >
              Buscar político
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
            <Link
              href="/manifesto"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:border-white/25 hover:bg-white/10 hover:text-slate-100"
            >
              Conhecer manifesto
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <section className="border-b border-white/8 py-10">
        <div className="mx-auto max-w-4xl px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard value="1.000+" label="Políticos indexados" note="base inicial" />
            <StatCard value="3" label="Fontes oficiais TSE" note="candidatos · bens · resultados" />
            <StatCard value="2024" label="Ciclo eleitoral" note="dados do TSE" />
            <StatCard value="Em dev." label="Score REPBrasil" note="metodologia em construção" />
          </div>
        </div>
      </section>

      {/* ── O que fazemos ─────────────────────────────────────────────────── */}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<DatabaseIcon />}
              title="Organiza dados públicos"
              description="Coleta, estrutura e contextualiza dados eleitorais e declarações públicas em uma experiência navegável."
            />
            <FeatureCard
              icon={<LinkIcon />}
              title="Conecta fontes oficiais"
              description="Cada dado exibido aponta para uma fonte verificável. Download original disponível com hash SHA-256."
            />
            <FeatureCard
              icon={<UserIcon />}
              title="Estrutura perfis políticos"
              description="Perfis organizados com histórico eleitoral, patrimônio declarado, fontes vinculadas e score em desenvolvimento."
            />
            <FeatureCard
              icon={<ShieldIcon />}
              title="Rastreabilidade integral"
              description="SHA-256 de cada arquivo-fonte, data de importação e integridade verificável. Nada é afirmado sem origem."
            />
            <FeatureCard
              icon={<MessageIcon />}
              title="Contestação disponível"
              description="Políticos, assessorias e cidadãos podem solicitar revisão de informações mediante indicação de fonte oficial."
            />
            <FeatureCard
              icon={<ScoreIcon />}
              title="Score em desenvolvimento"
              description="Um índice explicável e auditável baseado em critérios objetivos. Metodologia em refinamento, sem score fake."
            />
          </div>
        </div>
      </section>

      {/* ── Por que existe ────────────────────────────────────────────────── */}
      <section className="border-b border-white/8 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <div className="rounded-xl border border-brand/20 bg-brand/5 p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-px flex-1 bg-brand/20" />
              <span className="text-xs font-semibold uppercase tracking-widest text-brand/70">
                Por que o REPBrasil existe
              </span>
              <div className="h-px flex-1 bg-brand/20" />
            </div>
            <blockquote className="mb-5 text-base leading-relaxed text-slate-300 sm:text-lg">
              &ldquo;O Brasil não sofre por falta de dados. Sofre porque dados públicos,
              dispersos e difíceis de interpretar, raramente viram compreensão pública.
              O REPBrasil nasce para organizar informações oficiais sobre agentes
              políticos brasileiros em uma experiência clara, rastreável e auditável.&rdquo;
            </blockquote>
            <Link
              href="/manifesto"
              className="inline-flex items-center gap-2 text-sm font-medium text-brand transition-colors hover:text-brand-light"
            >
              Ler manifesto completo
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Fontes e rastreabilidade ──────────────────────────────────────── */}
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
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <SourceBadge
              name="TSE — Candidatos 2024"
              org="Tribunal Superior Eleitoral"
              type="Dados de candidaturas e filiação partidária"
            />
            <SourceBadge
              name="TSE — Bens Declarados 2024"
              org="Tribunal Superior Eleitoral"
              type="Declarações patrimoniais dos candidatos"
            />
            <SourceBadge
              name="TSE — Resultados 2024"
              org="Tribunal Superior Eleitoral"
              type="Resultados eleitorais por cargo e município"
            />
          </div>
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

      {/* ── Limitações honestas ───────────────────────────────────────────── */}
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
            <Link
              href="/suporte"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 transition-colors hover:text-amber-300"
            >
              Contestar ou corrigir informação →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/8 py-10">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-8 grid gap-8 sm:grid-cols-3">
            {/* Brand */}
            <div className="sm:col-span-1">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 border border-brand/20">
                  <span className="font-black text-brand text-sm leading-none">R</span>
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

            {/* Links */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Plataforma
              </p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><Link href="/politicos" className="transition-colors hover:text-slate-300">Buscar políticos</Link></li>
                <li><Link href="/manifesto" className="transition-colors hover:text-slate-300">Manifesto</Link></li>
                <li><Link href="/suporte" className="transition-colors hover:text-slate-300">Central de suporte</Link></li>
              </ul>
            </div>

            {/* Institucional */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Institucional
              </p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><Link href="/suporte" className="transition-colors hover:text-slate-300">Contestação de dados</Link></li>
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
