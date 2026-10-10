import type { Metadata } from "next";
import { TransitionLink } from "@/motion/navigation";

export const metadata: Metadata = {
  title: "Página não encontrada — REPBrasil",
  robots: { index: false },
};

const LINKS = [
  { href: "/eleicoes", label: "Explorar eleições", hint: "Resultados por estado, município, zona e seção" },
  { href: "/politicos", label: "Buscar políticos e candidaturas", hint: "Perfis com o Raio X eleitoral" },
  { href: "/", label: "Página inicial", hint: "O que o REPBrasil reúne" },
];

/** Nenhuma rota casou: diz isso com clareza e oferece caminhos — nunca um beco sem saída. */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-background px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Erro 404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">Página não encontrada</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          O endereço não existe ou mudou. Se você chegou aqui por um link do REPBrasil, ele pode ter sido escrito
          errado — os dados continuam onde estavam.
        </p>
        <ul className="mt-8 space-y-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <TransitionLink
                href={l.href}
                className="mi-surface focus-ring flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-card px-4 py-3 hover:border-brand/30"
              >
                <span>
                  <span className="block text-sm font-medium text-slate-200">{l.label}</span>
                  <span className="block text-xs text-slate-500">{l.hint}</span>
                </span>
                <span aria-hidden="true" className="text-brand">→</span>
              </TransitionLink>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
