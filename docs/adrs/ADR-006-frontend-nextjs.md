# ADR-006 — Frontend com Next.js 15 e TypeScript

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O frontend precisa ser rápido em conexões 3G (o Seu Zé do interior com celular simples),
acessível, mobile-first, com SSR para SEO (perfis de políticos devem ser indexáveis),
e com componentes de UI consistentes.

## Decisão

- **Next.js 15** com App Router, SSR/SSG por página.
- **TypeScript strict**: zero `any`, tipos explícitos.
- **Tailwind CSS**: utility-first, sem CSS-in-JS, bundle pequeno.
- **shadcn/ui**: componentes acessíveis, copiados para o projeto (sem dependência de runtime).
- **TanStack Query**: cache de dados no cliente, estados de loading/error.
- **ESLint + Prettier**: consistência de código.

## Estratégia de performance

- Home e perfil básico: SSR com dados no servidor, sem JavaScript obrigatório.
- Grafo e análises avançadas: carregamento sob demanda (dynamic import).
- Sem animações pesadas no primeiro carregamento.
- Target: < 100KB HTML+CSS para o primeiro fold da home.

## Consequências

- `npm run dev` para desenvolvimento local.
- `npm run build` deve passar sem erros antes de qualquer merge.
- `npm run typecheck` obrigatório no CI futuro.
- shadcn/ui componentes vivem em `src/components/ui/` e podem ser customizados.
