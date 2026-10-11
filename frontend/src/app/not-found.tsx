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
    <main className="min-h-screen bg-canvas px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Erro 404</p>
        <h1 className="mt-2 text-2xl font-bold text-fg">Página não encontrada</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          O endereço não existe ou mudou. Se você chegou aqui por um link do REPBrasil, ele pode ter sido escrito
          errado — os dados continuam onde estavam.
        </p>
        <ul className="mt-8 space-y-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <TransitionLink
                href={l.href}
                className="mi-surface focus-ring flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:border-accent/30"
              >
                <span>
                  <span className="block text-sm font-medium text-fg-soft">{l.label}</span>
                  <span className="block text-xs text-fg-muted">{l.hint}</span>
                </span>
                <span aria-hidden="true" className="text-accent-text">→</span>
              </TransitionLink>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
