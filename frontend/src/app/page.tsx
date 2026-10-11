import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";
import { HomeCoverage } from "@/components/home/HomeCoverage";
import { pageMetadata } from "@/lib/seo";
import { SearchBox } from "@/components/search/GlobalSearch";
import { TransitionLink } from "@/motion/navigation";

export const metadata: Metadata = pageMetadata({
  title: "REPBrasil — eleições brasileiras, da urna ao candidato",
  absoluteTitle: true,
  description:
    "Resultados oficiais do TSE por seção, zona e município, com o histórico de cada candidatura, patrimônio declarado e contas de campanha. Cada número aponta para a fonte.",
  path: "/",
});

function ArrowIcon({ size = 14 }: Readonly<{ size?: number }>) {
  return (
    <svg className="mi-arrow" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** O que o perfil de uma candidatura mostra — dito pelo que é, com a base que usa. */
const XRAY = [
  { title: "Onde teve votos", text: "Município, zona e seção, no mapa e em tabela, com a participação em cada lugar." },
  { title: "Como mudou", text: "A mesma disputa de uma eleição para outra. Se o cargo ou as seções mudaram, a tela avisa em vez de comparar." },
  { title: "Patrimônio declarado", text: "Os bens informados ao TSE em cada candidatura, com o valor declarado." },
  { title: "Contas de campanha", text: "Receitas e despesas da prestação de contas entregue à Justiça Eleitoral." },
  { title: "Comparação", text: "Até cinco candidaturas lado a lado: ranking, evolução e território." },
  { title: "Fonte em cada número", text: "Arquivo oficial, data do download e código de verificação (SHA-256)." },
] as const;

const LIMITS = [
  "Os votos por seção cobrem as eleições listadas acima; outros estados e anos ainda não foram importados.",
  "Quando a fonte não informa um dado, a tela mostra “—”: ausência não é zero.",
  "Candidatura e pessoa só são ligadas por identificador oficial; sem prova, ficam separadas.",
  "Nenhuma nota, índice ou ranking de político é exibido.",
  "A plataforma não substitui as fontes oficiais: confira sempre o arquivo vinculado.",
] as const;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-canvas">
      {/* ── Busca: o instrumento central ──────────────────────────────────── */}
      <section className="relative border-b border-line py-14 md:py-20">
        <div className="bg-grid-pattern absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6">
          <p className="mb-4 text-center text-label uppercase tracking-[0.1em] text-accent-text">
            Dados públicos oficiais · TSE e IBGE
          </p>
          <h1 className="mb-4 text-center text-3xl font-bold leading-tight tracking-tight text-fg sm:text-4xl md:text-5xl">
            Eleições brasileiras, da urna ao candidato.
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-center text-base leading-relaxed text-fg-muted sm:text-lg">
            Resultados oficiais por seção, zona e município e o histórico de cada candidatura, com patrimônio declarado e contas
            de campanha. Cada número aponta para a fonte.
          </p>
          <div className="mx-auto max-w-2xl">
            <SearchBox variant="inline" placeholder="Político, município, partido ou eleição" />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <TransitionLink href="/eleicoes" className="focus-ring inline-flex items-center gap-1.5 rounded font-medium text-accent-text hover:text-fg">
              <span className="mi-underline">Explorar eleições</span> <ArrowIcon size={13} />
            </TransitionLink>
            <TransitionLink href="/eleicoes/comparar" className="focus-ring inline-flex items-center gap-1.5 rounded font-medium text-fg-soft hover:text-fg">
              <span className="mi-underline">Comparar candidaturas</span> <ArrowIcon size={13} />
            </TransitionLink>
          </div>
        </div>
      </section>

      {/* ── Cobertura, caminho territorial e fontes (dados reais) ─────────── */}
      <HomeCoverage />

      {/* ── O raio X de uma candidatura ───────────────────────────────────── */}
      <section aria-labelledby="xray-title" className="border-b border-line py-12">
        <div className="mx-auto max-w-5xl px-6">
          <h2 id="xray-title" className="text-xl font-bold text-fg sm:text-2xl">
            O raio X de uma candidatura
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
            Procure qualquer candidato pelo nome de urna. O perfil reúne, a partir das bases do TSE:
          </p>
          <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {XRAY.map((item) => (
              <div key={item.title} className="border-l-2 border-accent/30 pl-4">
                <dt className="text-sm font-semibold text-fg-soft">{item.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-fg-muted">{item.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Limitações — imóveis de propósito: são um compromisso ─────────── */}
      <section aria-labelledby="limits-title" className="border-b border-line py-12">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-lg border border-warn/20 bg-warn/5 p-5 sm:p-6">
            <h2 id="limits-title" className="mb-3 text-sm font-semibold text-warn">
              O que a plataforma ainda não faz — e o que ela nunca faz
            </h2>
            <ul className="space-y-1.5 text-sm text-fg-muted">
              {LIMITS.map((text) => (
                <li key={text} className="flex gap-2">
                  <span aria-hidden="true" className="text-warn/70">•</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <TransitionLink href="/suporte" className="focus-ring mt-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-warn hover:text-warn">
              <span className="mi-underline">Encontrou um erro? Peça a correção com a fonte</span> <ArrowIcon size={13} />
            </TransitionLink>
          </div>
        </div>
      </section>

      {/* ── Rodapé ────────────────────────────────────────────────────────── */}
      <footer className="py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            {/* Assinatura principal com descriptor (≥ 160px), versão negativa no tema escuro */}
            <Logo variant="signature" height={52} alt="REPBrasil — Inteligência Eleitoral" />
            <p className="mt-3 text-xs leading-relaxed text-fg-muted">
              Dados públicos oficiais sobre eleições e agentes políticos brasileiros. Transparência sem militância.
            </p>
            <p className="mt-2 text-xs text-fg-muted">Um produto da Andrade Systems.</p>
          </div>
          <nav aria-label="Rodapé" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-fg-muted">
            <TransitionLink href="/eleicoes" className="mi-underline focus-ring rounded hover:text-fg-soft">Eleições</TransitionLink>
            <TransitionLink href="/politicos" className="mi-underline focus-ring rounded hover:text-fg-soft">Políticos</TransitionLink>
            <TransitionLink href="/eleicoes/comparar" className="mi-underline focus-ring rounded hover:text-fg-soft">Comparar</TransitionLink>
            <TransitionLink href="/manifesto" className="mi-underline focus-ring rounded hover:text-fg-soft">Manifesto</TransitionLink>
            <TransitionLink href="/glossario" className="mi-underline focus-ring rounded hover:text-fg-soft">Glossário</TransitionLink>
            <TransitionLink href="/suporte" className="mi-underline focus-ring rounded hover:text-fg-soft">Suporte e correções</TransitionLink>
          </nav>
        </div>
        <p className="mx-auto mt-8 max-w-5xl px-6 text-xs text-fg-muted">© 2026 REPBrasil · Andrade Systems</p>
      </footer>
    </main>
  );
}
