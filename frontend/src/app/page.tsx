export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl text-center space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            REPBrasil
          </h1>
          <p className="text-lg text-slate-500 font-medium">
            Apenas dados. Sem discursos.
          </p>
        </div>

        <div className="w-full">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar político, partido, estado ou cargo..."
              className="w-full px-5 py-4 text-base border border-slate-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
              disabled
              aria-label="Busca (disponível na Fase 1)"
            />
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Busca disponível na Fase 1. Acompanhe o{" "}
            <a
              href="https://github.com/eliasandraade/REPBrasil"
              className="underline hover:text-slate-600"
              target="_blank"
              rel="noopener noreferrer"
            >
              repositório
            </a>
            .
          </p>
        </div>

        <nav className="flex flex-wrap justify-center gap-4 text-sm text-slate-500">
          <a href="/manifesto" className="hover:text-slate-800 hover:underline">
            Manifesto
          </a>
          <a href="/metodologia" className="hover:text-slate-800 hover:underline">
            Metodologia
          </a>
          <a
            href="https://github.com/eliasandraade/REPBrasil"
            className="hover:text-slate-800 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </main>
  );
}
