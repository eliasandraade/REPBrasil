import type { Metadata } from "next";
import { GLOSSARY, type GlossaryEntry, type GlossaryId } from "@/lib/glossary";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Glossário eleitoral",
  description: "Boletim de Urna, seção agregada, votos válidos, legenda, quociente partidário, suplente: os termos das eleições em linguagem simples.",
  path: "/glossario",
});

/** Glossário eleitoral: os mesmos textos das dicas espalhadas pelas telas, num lugar só (com âncora por termo). */
export default function GlossaryPage() {
  const entries = (Object.entries(GLOSSARY) as Array<[GlossaryId, GlossaryEntry]>).sort(([, a], [, b]) => a.term.localeCompare(b.term, "pt-BR"));
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-fg">Glossário eleitoral</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Os termos que aparecem nos resultados, em linguagem simples. Uma regra vale para todos: quando a fonte não informa, a tela mostra
          &ldquo;—&rdquo; — ausência de dado não é zero.
        </p>
        <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
          {entries.map(([id, e]) => (
            <div key={id} id={id} className="scroll-mt-20 px-5 py-4">
              <dt className="text-sm font-semibold text-fg">{e.term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-fg-muted">
                {e.short}
                {e.more && <span className="mt-1 block text-xs text-fg-muted">{e.more}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
