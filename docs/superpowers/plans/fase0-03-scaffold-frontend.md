# REPBrasil Fase 0 — Bloco 3: Scaffold do Frontend

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (pasta `frontend/` criada).

**Objetivo:** Criar um projeto Next.js 15 funcional dentro de `frontend/` com TypeScript, Tailwind CSS, ESLint, Prettier e uma home placeholder com o slogan do projeto. O resultado deve passar em `npm run build`, `npm run lint` e `npm run typecheck` sem erros.

---

## Arquivos criados

```
frontend/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
├── .env.local.example
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   └── globals.css
    └── components/
        └── ui/
            └── button.tsx          # Componente shadcn/ui base
```

---

## Decisões arquiteturais

- **App Router (Next.js 15)**: sem `pages/`; toda rota vive em `src/app/`.
- **`lang="pt-BR"`** no `<html>`: o produto é brasileiro — o navegador deve saber.
- **Metadata com Open Graph**: perfis de políticos serão indexáveis; a estrutura de metadata começa aqui.
- **Tailwind CSS**: utility-first, bundle pequeno, zero CSS-in-JS.
- **shadcn/ui**: componentes copiados para o projeto (`src/components/ui/`), sem runtime externo. Só o `Button` é criado na Fase 0 — os demais virão conforme a UI evoluir.
- **TanStack Query**: adicionado ao `package.json` mas sem Provider na Fase 0 — o Provider será criado na Fase 3 quando houver dados reais.
- **TypeScript strict**: `"strict": true` no `tsconfig.json`. Nenhum `any` explícito.
- **`npm run typecheck`** roda `tsc --noEmit` — não é substituído pelo build.
- **Home placeholder**: a página inicial exibe apenas o slogan e um campo de busca inativo. Sem dados, sem features — apenas estrutura visual básica para validar que o scaffold roda.

---

## Steps

- [ ] **1. Criar `frontend/package.json`**

```json
{
  "name": "repbrasil-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.0.0",
    "autoprefixer": "^10.0.0",
    "eslint": "^8.0.0",
    "eslint-config-next": "^15.0.0",
    "prettier": "^3.0.0",
    "@types/prettier": "^3.0.0"
  }
}
```

- [ ] **2. Criar `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **3. Criar `frontend/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **4. Criar `frontend/tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9ff",
          500: "#0ea5e9",
          900: "#0c4a6e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **5. Criar `frontend/postcss.config.mjs`**

```javascript
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
```

- [ ] **6. Criar `frontend/.eslintrc.json`**

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"]
}
```

- [ ] **7. Criar `frontend/.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 100
}
```

- [ ] **8. Criar `frontend/.env.local.example`**

```env
# URL da API backend (desenvolvimento local)
NEXT_PUBLIC_API_URL=http://localhost:5000
```

- [ ] **9. Criar `frontend/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 15, 23, 42;
  --background-rgb: 248, 250, 252;
}

body {
  color: rgb(var(--foreground-rgb));
  background: rgb(var(--background-rgb));
}
```

- [ ] **10. Criar `frontend/src/app/layout.tsx`**

```typescript
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REPBrasil — Apenas dados. Sem discursos.",
  description:
    "Plataforma open source de transparência política e reputação pública documental. Dados públicos oficiais sobre políticos brasileiros.",
  keywords: ["transparência", "política", "dados públicos", "Brasil", "score público"],
  openGraph: {
    title: "REPBrasil",
    description: "Apenas dados. Sem discursos.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **11. Criar `frontend/src/app/page.tsx`**

```typescript
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl text-center space-y-8">
        {/* Logo e slogan */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            REPBrasil
          </h1>
          <p className="text-lg text-slate-500 font-medium">
            Apenas dados. Sem discursos.
          </p>
        </div>

        {/* Busca placeholder */}
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
              href="https://github.com/oeliasandraade/REPBrasil"
              className="underline hover:text-slate-600"
              target="_blank"
              rel="noopener noreferrer"
            >
              repositório
            </a>
            .
          </p>
        </div>

        {/* Links institucionais */}
        <nav className="flex flex-wrap justify-center gap-4 text-sm text-slate-500">
          <a href="/manifesto" className="hover:text-slate-800 hover:underline">
            Manifesto
          </a>
          <a href="/metodologia" className="hover:text-slate-800 hover:underline">
            Metodologia
          </a>
          <a
            href="https://github.com/oeliasandraade/REPBrasil"
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

- [ ] **12. Criar `frontend/src/components/ui/button.tsx`**

Componente base do shadcn/ui, adaptado para o projeto:

```typescript
import * as React from "react";

type ButtonVariant = "default" | "outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-brand-500 text-white hover:bg-brand-600",
  outline: "border border-slate-300 text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
```

- [ ] **13. Instalar dependências**

```bash
cd frontend
npm install
```

Esperado: `node_modules/` criado, sem erros.

- [ ] **14. Verificar typecheck**

```bash
npm run typecheck
```

Esperado: saída sem erros.

- [ ] **15. Verificar lint**

```bash
npm run lint
```

Esperado: `No ESLint warnings or errors.`

- [ ] **16. Verificar build**

```bash
npm run build
```

Esperado: `✓ Compiled successfully` e rotas listadas sem erros.

- [ ] **17. Verificar dev server**

```bash
npm run dev
```

Abrir `http://localhost:3000`. Verificar:
- Título "REPBrasil" aparece na aba
- Slogan "Apenas dados. Sem discursos." visível
- Campo de busca renderizado (desabilitado)
- Links institucionais no rodapé

- [ ] **18. Commit**

```bash
cd ..
git add frontend/
git commit -m "feat(frontend): scaffold Next.js 15 com TypeScript, Tailwind, home placeholder"
git push
```

---

## Critérios de sucesso

- [ ] `npm run typecheck` passa sem erros
- [ ] `npm run lint` passa sem warnings
- [ ] `npm run build` completa sem erros
- [ ] `http://localhost:3000` renderiza a home com slogan
- [ ] `<html lang="pt-BR">` presente no HTML gerado
- [ ] `src/components/ui/button.tsx` existe e tipado corretamente

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| Versões de Next.js/React incompatíveis entre si | Usar as versões exatas do `package.json` acima |
| `create-next-app` criando `.git` interno | Criar os arquivos manualmente (como neste plano) em vez de usar o CLI |
| Tailwind não aplicando estilos | Verificar se `globals.css` importa `@tailwind base/components/utilities` |
| TypeScript reclamando de `React.ReactNode` | Garantir `@types/react` e `@types/react-dom` instalados |
| `npm run dev` e `npm run build` em conflito de porta | Encerrar o dev server antes de rodar build |
