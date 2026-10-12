import type { Metadata } from "next";
import { TransitionLink } from "@/motion/navigation";

export const metadata: Metadata = {
  title: "Sem conexão",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-4 py-12 sm:px-6">
      <section className="w-full rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8" role="status">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">REPBrasil offline</p>
        <h1 className="mt-2 text-2xl font-semibold text-fg sm:text-3xl">Você está sem conexão</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted sm:text-base">
          Para proteger a integridade das informações, resultados eleitorais, pesquisas, atividade parlamentar e outros dados factuais não são servidos de um cache antigo. Reconecte-se para consultar a versão atual.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <TransitionLink
            href="/"
            className="focus-ring rounded-lg bg-action px-4 py-2 text-sm font-semibold text-action-fg hover:bg-action/90"
          >
            Tentar novamente
          </TransitionLink>
          <TransitionLink
            href="/manifesto"
            className="focus-ring rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-fg-soft hover:bg-fg/5"
          >
            Como tratamos os dados
          </TransitionLink>
        </div>
      </section>
    </main>
  );
}
