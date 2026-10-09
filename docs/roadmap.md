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

## Fase 1 — Dados básicos ✅

- [x] Importar candidatos TSE 2024 (dataset de validação técnica)
- [x] Criar modelo `Politician` com dados reais do TSE
- [x] Criar busca básica por nome (EF Core + ILike, paginação)
- [x] Criar perfil básico com dados eleitorais e IDs externos
- [x] ETL `TseCandidatesPipeline` — download, parse, carga PostgreSQL
- [x] API `GET /api/v1/politicians` e `GET /api/v1/politicians/{id}`
- [x] Frontend: home com busca, listagem `/politicos`, perfil `/politico/[id]`
- [ ] Importar bens declarados TSE (Fase 2)
- [ ] Importar resultados eleitorais TSE (Fase 2)
- [ ] Importar filiações partidárias TSE (Fase 2)

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

## Inteligência eleitoral

Arquitetura em [ELECTORAL_ARCHITECTURE.md](ELECTORAL_ARCHITECTURE.md).

- [x] Schema `electoral` (PostGIS) com território, cadastro, Boletim de Urna e proveniência
- [x] Disputa, candidatura e vínculo determinístico Person ↔ candidatura ↔ perfil (CPF em HMAC + histórico oficial do TSE)
- [x] ETL eleitoral portado e auditado (sync estadual com escopos intercalados)
- [x] Ceará 2026, 1º turno: 184 municípios, 205 zonas, 23.765 urnas, 2.751.489 linhas de votos
- [x] API .NET de catálogo, seção e candidaturas; explorador `/eleicoes`; aba "Desempenho eleitoral" no perfil
- [ ] Identidade de votável por UF (pré-requisito para carregar a 2ª UF)
- [ ] Demais UFs de 2026 e 2º turno
- [ ] Eleições anteriores (2022, 2024) por seção
- [ ] Comparação entre eleições, desempenho partidário, correlações (sempre como métricas derivadas)
- [ ] Busca universal (políticos, candidatos, municípios, eleições)
- [ ] Revisão humana de sugestões de identidade (nunca automática)

