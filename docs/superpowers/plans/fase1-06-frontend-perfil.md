# REPBrasil Fase 1 — Bloco 6: Frontend — Página de Perfil do Político

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 5 (busca funcional, `api.ts` e `types.ts` criados).

**Objetivo:** Criar a página `/politico/[id]` com o perfil básico do político — identidade (nome, nome de urna, IDs externos) e metadados de coleta. Sem score, sem grafo, sem análises avançadas — apenas os dados disponíveis na Fase 1.

---

## Decisões arquiteturais

- **Rota dinâmica `[id]`**: Next.js App Router com `params.id` como UUID.
- **`useQuery` para fetch**: TanStack Query gerencia cache e loading — evita refetch desnecessário ao navegar de volta do perfil para a listagem.
- **404 explícito**: se a API retorna 404, exibir página de "Político não encontrado" com link para voltar.
- **Dados mínimos**: só o que a API já retorna — `name`, `ballotName`, `tseId`, `camaraId`, `senateId`, `createdAt`, `sourceUpdatedAt`. Nenhum dado inventado ou mockado.
- **Sem score visual**: seção de score exibe "Disponível na Fase 2" com explicação breve.
- **Data de coleta formatada**: `sourceUpdatedAt` exibido como "Dados coletados em DD/MM/YYYY".

---

## Arquivos criados

```
frontend/src/
├── app/
│   └── politico/
│       └── [id]/
│           └── page.tsx
└── components/
    └── politicians/
        └── PoliticianProfile.tsx
```

---

## Steps

- [ ] **1. Criar `src/components/politicians/PoliticianProfile.tsx`**

```typescript
import type { PoliticianDetail } from "@/lib/types";

interface PoliticianProfileProps {
  politician: PoliticianDetail;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function PoliticianProfile({ politician }: PoliticianProfileProps) {
  return (
    <div className="space-y-8">
      {/* Identidade */}
      <section className="space-y-1">
        <h1 className="text-3xl font-bold text-slate-900">{politician.ballotName}</h1>
        <p className="text-lg text-slate-500">{politician.name}</p>
      </section>

      {/* IDs externos */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Identificadores externos
          </p>
        </div>
        <Row label="ID TSE" value={politician.tseId} />
        <Row label="ID Câmara" value={politician.camaraId} />
        <Row label="ID Senado" value={politician.senateId} />
      </section>

      {/* Metadados */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Dados de coleta
          </p>
        </div>
        <Row label="Dados coletados em" value={formatDate(politician.sourceUpdatedAt)} />
        <Row label="Registrado em" value={formatDate(politician.createdAt)} />
      </section>

      {/* Score — placeholder */}
      <section className="border border-dashed border-slate-300 rounded-lg p-6 text-center">
        <p className="text-slate-400 text-sm font-medium">Score Público</p>
        <p className="text-slate-300 text-4xl font-bold mt-1">—</p>
        <p className="text-slate-400 text-xs mt-2">
          Metodologia em desenvolvimento. Disponível na Fase 2.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="px-4 py-3 flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value ?? "—"}</span>
    </div>
  );
}
```

- [ ] **2. Criar `src/app/politico/[id]/page.tsx`**

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PoliticianProfile } from "@/components/politicians/PoliticianProfile";
import { getPolitician } from "@/lib/api";

export default function PoliticoPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politician", id],
    queryFn: () => getPolitician(id),
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("404")) return false;
      return failureCount < 2;
    },
  });

  if (isLoading) {
    return (
      <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
        <p className="text-slate-400 text-center py-24">Carregando...</p>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
        <a href="/politicos" className="text-sm text-slate-400 hover:text-slate-600 block mb-8">
          ← Voltar à busca
        </a>
        <div className="text-center py-24">
          <p className="text-slate-500 text-lg font-medium">Político não encontrado.</p>
          <p className="text-slate-400 text-sm mt-2">
            O ID informado não corresponde a nenhum registro.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
      <a href="/politicos" className="text-sm text-slate-400 hover:text-slate-600 block mb-8">
        ← Voltar à busca
      </a>
      <PoliticianProfile politician={data} />
    </main>
  );
}
```

- [ ] **3. Verificar typecheck, lint e build**

```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

Todos devem passar sem erros.

- [ ] **4. Testar manualmente**

```bash
npm run dev
```

Fluxo completo:
1. Acessar `http://localhost:3000`
2. Digitar nome no campo de busca
3. Clicar em um político na listagem
4. Verificar que a página de perfil carrega com os dados corretos
5. Verificar link "← Voltar à busca"
6. Testar URL inválida: `http://localhost:3000/politico/00000000-0000-0000-0000-000000000000` — deve exibir "Político não encontrado"

- [ ] **5. Commit**

```bash
cd ..
git add frontend/
git commit -m "feat(frontend): página de perfil /politico/[id] com dados básicos do TSE"
git push
```

---

## Critérios de sucesso

- [ ] `npm run typecheck` — sem erros
- [ ] `npm run lint` — sem warnings
- [ ] `npm run build` — compila sem erros
- [ ] `/politico/[id]` exibe nome, nome de urna e IDs externos
- [ ] Data de coleta formatada em pt-BR
- [ ] Seção de score placeholder com "Disponível na Fase 2"
- [ ] UUID inválido mostra "Político não encontrado"
- [ ] Link "← Voltar à busca" funciona

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| `useParams` retorna `string | string[]` no App Router | Tipado como `{ id: string }` no `useParams<>` genérico |
| Hydration mismatch por formatação de data | Datas formatadas com `toLocaleDateString` — pode diferir entre server e client; usar `"use client"` resolve |
| UUID com formato inválido na URL | A API retorna 404 ou 400; o retry handler não retenta em 404 |
| Score placeholder confundindo usuário | Texto explícito: "Disponível na Fase 2" e "Metodologia em desenvolvimento" |
