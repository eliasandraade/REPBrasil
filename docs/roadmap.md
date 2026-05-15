# Roadmap REPBrasil

## Fase 0 — Fundação ✅ (atual)

- [x] Criar repositório público no GitHub
- [x] Definir licença AGPL-3.0
- [x] Escrever manifesto
- [x] Escrever metodologia inicial do Score Público (v1.0.0)
- [x] Escrever documentação institucional (governança, auditoria, contestação, LGPD)
- [x] Escrever matriz de fontes P0/P1/P2
- [x] Criar ADRs iniciais (001–007)
- [x] Scaffold frontend Next.js 15
- [x] Scaffold backend .NET 8 Clean Architecture
- [x] Scaffold ETL Python
- [x] Documentação do modelo de grafo Neo4j
- [x] docker-compose com PostgreSQL + Redis + Neo4j
- [x] `GET /health` e `GET /api/v1/status` funcionando

## Fase 1 — Dados básicos

- [ ] Importar candidatos TSE (últimas eleições)
- [ ] Importar bens declarados TSE
- [ ] Importar resultados eleitorais TSE
- [ ] Importar filiações partidárias TSE
- [ ] Criar modelo `Politician` / `Candidate` com dados reais
- [ ] Criar busca básica por nome/partido/estado
- [ ] Criar perfil básico com dados eleitorais

## Fase 2 — Score v0

- [ ] Implementar pilares do Score Público
- [ ] Criar `ScoreSnapshot` com cálculo real
- [ ] Criar explicabilidade básica (breakdown de pilares)
- [ ] Criar flags simples (patrimonial, processos)
- [ ] Publicar metodologia v1.1 com ajustes pós-implementação

## Fase 3 — Interface

- [ ] Homepage com busca funcional
- [ ] Perfil com card e score
- [ ] Abas de navegação
- [ ] Breakdown expansível do score
- [ ] Gráficos patrimoniais
- [ ] Timeline eleitoral

## Fase 4 — Grafo

- [ ] Neo4j em produção
- [ ] Entidades e relações básicas populadas
- [ ] Visualização progressiva no frontend
- [ ] Fontes nas arestas
- [ ] Histórico temporal nas relações

## Fase 5 — Dados avançados

- [ ] Gastos (cota parlamentar, diárias)
- [ ] Emendas parlamentares (SIOP/TransfereGov)
- [ ] Contratos públicos (PNCP)
- [ ] Empresas vinculadas (Receita Federal)
- [ ] Processos judiciais (DataJud/CNJ)
- [ ] CPIs (Câmara/Senado)
- [ ] Conexões documentadas

## Fase 6 — Auditoria pública

- [ ] Sistema de contestação funcional
- [ ] Changelog público de dados
- [ ] Histórico de score por político
- [ ] Dashboard de transparência financeira
- [ ] API pública com documentação
- [ ] Rate limiting e Cloudflare
