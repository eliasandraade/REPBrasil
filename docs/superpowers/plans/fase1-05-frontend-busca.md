# REPBrasil Fase 1 — Bloco 5: Frontend — Home com Busca e Listagem

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 4 (API rodando com dados reais).

**Objetivo:** Habilitar a busca na home page, criar a página `/politicos` com listagem de resultados paginada e configurar o cliente HTTP com TanStack Query. O campo de busca na home deve navegar para `/politicos?q=...` ao submeter.

---

## Decisões arquiteturais

- **TanStack Query**: `QueryClientProvider` adicionado ao layout raiz. Gerencia cache, loading e error states sem boilerplate.
- **API client centralizado**: módulo `src/lib/api.ts` com funções tipadas que fazem fetch para `NEXT_PUBLIC_API_URL`. Evita URLs espalhadas pelo código.
- **Search via URL**: estado da busca vive na query string (`?q=`), não em estado React. Facilita compartilhamento de links e navegação browser-back.
- **Debounce**: 300ms no campo de busca para não disparar request a cada tecla.
- **Paginação simples**: botões Anterior/Próximo. Sem paginação infinita na Fase 1.
- **`useSearchParams`**: hook do Next.js para ler `q` e `page` da URL na página de listagem.
- **Sem loading skeleton complexo**: spinner simples. Skeleton será adicionado na Fase 2.

---

## Arquivos criados/modificados

```
frontend/src/
├── app/
│   ├── layout.tsx                   (adicionar QueryClientProvider)
│   ├── page.tsx                     (habilitar busca, navegar para /politicos)
│   └── politicos/
│       └── page.tsx                 (listagem de resultados)
├── lib/
│   ├── api.ts                       (cliente HTTP centralizado)
│   └── types.ts                     (tipos TypeScript dos DTOs)
└── components/
    └── politicians/
        ├── PoliticianCard.tsx        (card na listagem)
        └── SearchInput.tsx           (campo de busca reutilizável)
```

---

## Steps

- [ ] **1. Criar `frontend/src/lib/types.ts`**

```typescript
export interface PoliticianSummary {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
}

export interface PoliticianDetail {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
  camaraId: string | null;
  senateId: string | null;
  createdAt: string;
  sourceUpdatedAt: string | null;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
```

- [ ] **2. Criar `frontend/src/lib/api.ts`**

```typescript
import type { PagedResult, PoliticianDetail, PoliticianSummary } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export function searchPoliticians(
  query: string,
  page: number,
  pageSize = 20,
): Promise<PagedResult<PoliticianSummary>> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize),
  });
  return fetchJson<PagedResult<PoliticianSummary>>(`/api/v1/politicians?${params}`);
}

export function getPolitician(id: string): Promise<PoliticianDetail> {
  return fetchJson<PoliticianDetail>(`/api/v1/politicians/${id}`);
}
```

- [ ] **3. Configurar TanStack Query em `src/app/layout.tsx`**

```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

Atualizar o `RootLayout` para envolver com `Providers`:

```typescript
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "REPBrasil — Apenas dados. Sem discursos.",
  description:
    "Plataforma open source de transparência política e reputação pública documental.",
  keywords: ["transparência", "política", "dados públicos", "Brasil", "score público"],
  openGraph: {
    title: "REPBrasil",
    description: "Apenas dados. Sem discursos.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Criar `src/app/providers.tsx`:

```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **4. Criar `src/components/politicians/SearchInput.tsx`**

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

interface SearchInputProps {
  defaultValue?: string;
  placeholder?: string;
}

export function SearchInput({
  defaultValue = "",
  placeholder = "Buscar político, partido, estado ou cargo...",
}: SearchInputProps) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams({ q: value, page: "1" });
      router.push(`/politicos?${params}`);
    }, 300);
  }

  return (
    <input
      type="text"
      defaultValue={defaultValue}
      onChange={handleChange}
      placeholder={placeholder}
      className="w-full px-5 py-4 text-base border border-slate-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
      aria-label="Buscar político"
    />
  );
}
```

- [ ] **5. Atualizar `src/app/page.tsx`**

```typescript
import { SearchInput } from "@/components/politicians/SearchInput";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl text-center space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">REPBrasil</h1>
          <p className="text-lg text-slate-500 font-medium">Apenas dados. Sem discursos.</p>
        </div>

        <div className="w-full">
          <SearchInput />
          <p className="mt-2 text-sm text-slate-400">
            Dados do TSE — eleições 2024.
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
```

- [ ] **6. Criar `src/components/politicians/PoliticianCard.tsx`**

```typescript
import Link from "next/link";
import type { PoliticianSummary } from "@/lib/types";

interface PoliticianCardProps {
  politician: PoliticianSummary;
}

export function PoliticianCard({ politician }: PoliticianCardProps) {
  return (
    <Link
      href={`/politico/${politician.id}`}
      className="block p-4 border border-slate-200 rounded-lg hover:border-brand-500 hover:shadow-sm transition-all"
    >
      <p className="font-semibold text-slate-900">{politician.ballotName}</p>
      <p className="text-sm text-slate-500">{politician.name}</p>
      {politician.tseId && (
        <p className="text-xs text-slate-400 mt-1">TSE: {politician.tseId}</p>
      )}
    </Link>
  );
}
```

- [ ] **7. Criar `src/app/politicos/page.tsx`**

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { PoliticianCard } from "@/components/politicians/PoliticianCard";
import { SearchInput } from "@/components/politicians/SearchInput";
import { searchPoliticians } from "@/lib/api";

export default function PoliticosPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q") ?? "";
  const page = Number(searchParams.get("page") ?? "1");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politicians", q, page],
    queryFn: () => searchPoliticians(q, page),
  });

  function goToPage(newPage: number) {
    const params = new URLSearchParams({ q, page: String(newPage) });
    router.push(`/politicos?${params}`);
  }

  return (
    <main className="min-h-screen px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-8 space-y-4">
        <a href="/" className="text-sm text-slate-400 hover:text-slate-600">
          ← REPBrasil
        </a>
        <SearchInput defaultValue={q} />
      </div>

      {isLoading && (
        <p className="text-slate-500 text-center py-12">Buscando...</p>
      )}

      {isError && (
        <p className="text-red-500 text-center py-12">
          Erro ao buscar políticos. Verifique se a API está rodando.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm text-slate-400 mb-4">
            {data.totalCount} resultado{data.totalCount !== 1 ? "s" : ""}
            {q ? ` para "${q}"` : ""}
          </p>

          <div className="space-y-2">
            {data.items.map((p) => (
              <PoliticianCard key={p.id} politician={p} />
            ))}
          </div>

          {data.items.length === 0 && (
            <p className="text-slate-500 text-center py-12">
              Nenhum político encontrado{q ? ` para "${q}"` : ""}.
            </p>
          )}

          {(data.hasPrevious || data.hasNext) && (
            <div className="flex justify-between mt-8">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={!data.hasPrevious}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                ← Anterior
              </button>
              <span className="text-sm text-slate-400 self-center">
                Página {data.page} de {data.totalPages}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={!data.hasNext}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **8. Criar `frontend/.env.local` para desenvolvimento**

```bash
# A partir de frontend/
cp .env.local.example .env.local
```

Verificar que contém:
```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

- [ ] **9. Verificar typecheck, lint e build**

```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

Todos devem passar sem erros.

- [ ] **10. Testar manualmente**

```bash
npm run dev
```

Abrir `http://localhost:3000`:
- Digitar um nome no campo de busca
- Verificar navegação para `/politicos?q=...`
- Verificar listagem de resultados
- Verificar paginação
- Verificar mensagem quando sem resultados

- [ ] **11. Commit**

```bash
cd ..
git add frontend/
git commit -m "feat(frontend): busca funcional, listagem /politicos com TanStack Query"
git push
```

---

## Critérios de sucesso

- [ ] `npm run typecheck` — sem erros
- [ ] `npm run lint` — sem warnings
- [ ] `npm run build` — compila sem erros
- [ ] Home: digitar no campo navega para `/politicos?q=...`
- [ ] `/politicos` exibe lista de políticos da API
- [ ] Paginação funciona (botões Anterior/Próximo)
- [ ] Mensagem de erro quando API offline
- [ ] Mensagem "Nenhum resultado" quando busca retorna vazio

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| `useSearchParams` requer `Suspense` boundary | Envolver `PoliticosPage` em `<Suspense>` no layout ou criar wrapper client component |
| `QueryClientProvider` em Server Component | Movido para `providers.tsx` com `"use client"` |
| CORS bloqueando fetch do browser | Configurado no backend (Bloco 4) para `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` undefined em produção | Configurar variável no Railway na Fase 2 |
| Hydration mismatch com `defaultValue` | `SearchInput` usa `defaultValue` (não `value`) para evitar controlled/uncontrolled mismatch |
