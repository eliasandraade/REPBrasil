import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Manifesto",
  description:
    "Sem medo. Sem lados. Sem se ajoelhar para ninguém. O REPBrasil existe para organizar dados públicos verificáveis sobre agentes políticos brasileiros.",
  path: "/manifesto",
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-text/80">
        {title}
      </h2>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-fg-muted">
          <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-accent/60" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function ManifestoPage() {
  return (
    <main className="min-h-screen bg-canvas">
      {/* Header */}
      <div className="border-b border-line py-14">
        <div className="mx-auto max-w-3xl px-6">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg-soft"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            REPBrasil
          </Link>

          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-text">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
            Posicionamento institucional
          </div>

          <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight text-fg sm:text-4xl">
            Manifesto{" "}
            <span>REPBrasil</span>
          </h1>
          <p className="text-base leading-relaxed text-fg-muted">
            Sem medo. Sem lados. Sem se ajoelhar para ninguém.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-12 space-y-12">

        {/* Origem */}
        <Section title="Origem">
          <div className="space-y-4 text-sm leading-relaxed text-fg-muted">
            <p>
              O REPBrasil nasce para combater a desinformação com clareza documental.
            </p>
            <p>
              O projeto não é partido, imprensa, tribunal ou movimento ideológico.
            </p>
            <p>
              O projeto não existe para dizer em quem o eleitor deve votar.
            </p>
            <p className="text-fg-soft font-medium">
              O projeto existe para organizar dados públicos verificáveis, mostrar
              conexões, expor padrões documentais e devolver ao cidadão a capacidade
              de enxergar.
            </p>
          </div>
        </Section>

        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-fg/6" />
          <div className="h-1.5 w-1.5 rounded-full bg-accent/40" />
          <div className="h-px flex-1 bg-fg/6" />
        </div>

        {/* O que somos */}
        <Section title="O que somos">
          <div className="space-y-3 text-sm leading-relaxed text-fg-muted">
            <p>
              Uma plataforma open source de transparência política e reputação pública documental.
            </p>
            <p>
              Reunimos, organizamos, cruzamos e apresentamos dados públicos oficiais sobre
              políticos brasileiros — para que qualquer cidadão compreenda, de forma simples
              e verificável, quem são os representantes e candidatos que disputam ou exercem
              poder público.
            </p>
          </div>
        </Section>

        {/* Compromisso central */}
        <Section title="Compromisso central">
          <BulletList items={[
            "Com a verdade verificável.",
            "Com a transparência.",
            "Com a neutralidade.",
            "Com o povo brasileiro.",
            "Com a auditoria pública.",
          ]} />
        </Section>

        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-fg/6" />
          <div className="h-1.5 w-1.5 rounded-full bg-accent/40" />
          <div className="h-px flex-1 bg-fg/6" />
        </div>

        {/* Duas colunas: usamos / não usamos */}
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-text/80">
              O que usamos
            </h2>
            <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Apenas:</p>
            <BulletList items={[
              "APIs governamentais",
              "Bases públicas oficiais",
              "Documentos públicos verificáveis",
              "Dados eleitorais oficiais",
              "Dados legislativos oficiais",
              "Registros administrativos oficiais",
              "Decisões judiciais oficiais",
            ]} />
          </div>

          <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-muted">
              O que não usamos
            </h2>
            <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Jamais:</p>
            <BulletList items={[
              "Notícias",
              "Imprensa",
              "Redes sociais",
              "Rumores",
              "Denúncias não verificadas",
              "Vazamentos",
              "Opinião editorial",
              "Avaliação ideológica",
            ]} />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-fg/6" />
          <div className="h-1.5 w-1.5 rounded-full bg-accent/40" />
          <div className="h-px flex-1 bg-fg/6" />
        </div>

        {/* O sistema mostra / nunca diz */}
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-lg border border-accent/15 bg-accent/5 p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-text/80">
              O que o sistema mostra
            </h2>
            <BulletList items={[
              "Dados",
              "Fontes",
              "Score",
              "Flags",
              "Conexões",
              "Histórico",
              "Metodologia",
            ]} />
          </div>

          <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-muted">
              O que o sistema nunca diz
            </h2>
            <ul className="space-y-2.5">
              {[
                "Este político é corrupto.",
                "Este político é bom.",
                "Este político é ruim.",
                "Vote neste candidato.",
                "Não vote neste candidato.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-fg-muted">
                  <span className="mt-1 text-fg-muted flex-shrink-0">✗</span>
                  <span className="italic">&ldquo;{item}&rdquo;</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Julgamento */}
        <p className="text-sm text-fg-muted text-center border-l-2 border-accent/30 pl-4">
          O juízo de valor pertence ao cidadão.
        </p>

        {/* Sustentabilidade: o compromisso público que os planos pagos não podem quebrar */}
        <Section title="Sustentabilidade">
          <p className="text-sm leading-relaxed text-fg-muted" data-testid="manifesto-sustentabilidade">
            O dado público essencial e a informação necessária para fiscalização democrática não devem ser artificialmente escondidos atrás de um paywall. Os planos pagos monetizam profundidade analítica, conveniência, produtividade, personalização, comparação, histórico, exportação e ferramentas profissionais — não o direito do cidadão de acessar informação pública básica.
          </p>
        </Section>

        {/* Assinatura filosófica */}
        <div className="rounded-xl border border-accent/20 bg-accent/5 p-6 sm:p-8 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent-text/60">
            Assinatura filosófica
          </p>
          <p className="text-xl font-bold leading-snug text-fg sm:text-2xl">
            Sem medo. Sem lados.<br />Sem se ajoelhar para ninguém.
          </p>
          <p className="mt-5 text-sm text-fg-muted">
            REPBrasil é um produto da{" "}
            <span className="font-semibold text-fg-muted">Andrade Systems</span>.
          </p>
        </div>

        {/* Navigation */}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/politicos"
            className="inline-flex items-center gap-2 rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-action-fg transition-all hover:bg-action/90"
          >
            Buscar políticos →
          </Link>
          <Link
            href="/suporte"
            className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-fg/5 px-4 py-2.5 text-sm font-semibold text-fg-soft transition-all hover:border-line-strong hover:bg-fg/10"
          >
            Central de suporte
          </Link>
        </div>
      </div>
    </main>
  );
}
