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
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-100">Glossário eleitoral</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Os termos que aparecem nos resultados, em linguagem simples. Uma regra vale para todos: quando a fonte não informa, a tela mostra
          &ldquo;—&rdquo; — ausência de dado não é zero.
        </p>
        <nav aria-label="Termos" className="mt-5 flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
          {entries.map(([id, e]) => (
            <a key={id} href={`#${id}`} className="focus-ring rounded text-brand underline-offset-2 hover:underline">
              {e.term}
            </a>
          ))}
        </nav>
        <dl className="mt-6 divide-y divide-white/8 rounded-xl border border-white/[0.08] bg-card">
          {entries.map(([id, e]) => (
            <div key={id} id={id} className="scroll-mt-20 px-5 py-4">
              <dt className="text-sm font-semibold text-slate-100">{e.term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-400">
                {e.short}
                {e.more && <span className="mt-1 block text-xs text-slate-500">{e.more}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
