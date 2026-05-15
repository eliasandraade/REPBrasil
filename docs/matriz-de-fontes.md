# Matriz de Fontes REPBrasil

Catálogo de todas as fontes de dados utilizadas ou planejadas.
Atualizar sempre que uma nova fonte for adicionada ou um status mudar.

## Colunas

| Coluna | Descrição |
|--------|-----------|
| Nome | Nome da fonte |
| Órgão | Órgão responsável |
| URL/API | Endpoint ou página de acesso |
| Tipo | Tipo de dado |
| Periodicidade | Frequência de atualização |
| Uso | perfil / score / grafo |
| Risco LGPD | Baixo / Médio / Alto |
| Confiabilidade | Alta / Média / Baixa |
| Prioridade | P0 / P1 / P2 |
| Status | planejado / em desenvolvimento / ativo / inativo |
| Licença/Termos | Termos de uso da fonte |
| Base legal | Justificativa de uso (LGPD, transparência pública) |
| Observações | Notas técnicas |

---

## P0 — MVP

| Nome | Órgão | URL/API | Tipo | Periodicidade | Uso | Risco LGPD | Confiabilidade | Prioridade | Status | Licença/Termos | Base legal | Observações |
|------|-------|---------|------|---------------|-----|------------|----------------|------------|--------|----------------|------------|-------------|
| Candidatos TSE | TSE | dados.tse.jus.br | Candidaturas eleitorais | Por eleição | perfil/score/grafo | Baixo | Alta | P0 | planejado | Dados abertos TSE | Art. 7º, IX LGPD — dados públicos eleitorais | Inclui bens declarados |
| Bens declarados TSE | TSE | dados.tse.jus.br | Patrimônio declarado | Por eleição | perfil/score | Baixo | Alta | P0 | planejado | Dados abertos TSE | Declaração voluntária pública | Dados autodeclarados |
| Resultados eleitorais TSE | TSE | dados.tse.jus.br | Votação por candidato/município | Por eleição | perfil/grafo | Baixo | Alta | P0 | planejado | Dados abertos TSE | Registro público eleitoral | |
| Filiação partidária TSE | TSE | dados.tse.jus.br | Histórico de partidos | Mensal | perfil/score/grafo | Baixo | Alta | P0 | planejado | Dados abertos TSE | Registro público eleitoral | |
| Câmara dos Deputados | Câmara | dadosabertos.camara.leg.br | Deputados, votações, gastos, emendas | Diária | perfil/score/grafo | Baixo | Alta | P0 | planejado | Dados abertos Câmara | Transparência legislativa | API REST disponível |
| Senado Federal | Senado | legis.senado.leg.br | Senadores, votações, gastos | Diária | perfil/score/grafo | Baixo | Alta | P0 | planejado | Dados abertos Senado | Transparência legislativa | |
| Portal da Transparência | CGU | portaldatransparencia.gov.br | Gastos, contratos, servidores | Diária | perfil/score/grafo | Baixo | Alta | P0 | planejado | Dados abertos CGU | Lei de Acesso à Informação | |
| CEIS/CNEP | CGU | portaldatransparencia.gov.br | Sanções, impedimentos | Mensal | score/flags | Baixo | Alta | P0 | planejado | Dados abertos CGU | Transparência administrativa | |
| TCU | TCU | portal.tcu.gov.br | Acórdãos, sanções | Irregular | score/flags | Baixo | Alta | P0 | planejado | Dados abertos TCU | Controle externo | |
| DataJud/CNJ | CNJ | datajud.cnj.jus.br | Processos judiciais | Semanal | perfil/score/flags | Médio | Alta | P0 | planejado | Dados abertos CNJ | Publicidade processual | Apenas dados públicos |
| Receita Federal CNPJ | RFB | dados.rfb.gov.br | Empresas, sócios, situação | Mensal | perfil/grafo | Baixo | Alta | P0 | planejado | Dados abertos RFB | Registro público empresarial | |
| PNCP | MPOG | pncp.gov.br | Contratos públicos | Diária | perfil/grafo | Baixo | Alta | P0 | planejado | Dados abertos | Lei 14.133/2021 | Portal Nacional de Contratações |
| TransfereGov | MPOG | transferegov.gov.br | Emendas, transferências | Diária | perfil/score | Baixo | Alta | P0 | planejado | Dados abertos | Transparência orçamentária | |
| SIOP | SOF | siop.planejamento.gov.br | Emendas parlamentares | Mensal | perfil/score | Baixo | Alta | P0 | planejado | Dados abertos | Transparência orçamentária | |

---

## P1 — Diferenciais

| Nome | Órgão | URL/API | Tipo | Periodicidade | Uso | Risco LGPD | Confiabilidade | Prioridade | Status | Licença/Termos | Base legal | Observações |
|------|-------|---------|------|---------------|-----|------------|----------------|------------|--------|-------------|------------|-------------|
| CPIs Câmara/Senado | Câmara/Senado | — | Citações em CPIs | Irregular | perfil/flags | Baixo | Alta | P1 | planejado | Dados abertos | Transparência legislativa | Requer parsing de atas |
| SIAPE | Economia | — | Servidores públicos federais | Mensal | grafo | Médio | Alta | P1 | planejado | Dados abertos | LAI | Cuidado com dados pessoais |
| Querido Diário | OKBr | queridodiario.org | Diários oficiais municipais | Diária | perfil/grafo | Baixo | Média | P1 | planejado | Dados abertos | Publicidade oficial | |
| TCEs estaduais | TCEs | variado | Contas estaduais/municipais | Irregular | score/flags | Baixo | Média | P1 | planejado | Variado por estado | Controle externo | APIs variam muito por estado |
| CGU PEP | CGU | — | Pessoas Expostas Politicamente | Mensal | perfil/flags | Médio | Alta | P1 | planejado | Dados abertos | LGPD art. 7º — interesse público | |

---

## P2 — Expansão futura

| Nome | Órgão | URL/API | Tipo | Periodicidade | Uso | Risco LGPD | Confiabilidade | Prioridade | Status | Licença/Termos | Base legal | Observações |
|------|-------|---------|------|---------------|-----|------------|----------------|------------|--------|----------------|------------|-------------|
| CVM | CVM | cvmweb.cvm.gov.br | Ações, fundos, mercado | Diária | grafo | Baixo | Alta | P2 | planejado | Dados abertos | Transparência mercado de capitais | |
| Banco Central | BCB | bcb.gov.br | Penalidades | Irregular | score/flags | Baixo | Alta | P2 | planejado | Dados abertos | Transparência regulatória | |
| PGFN | PGFN | — | Dívida ativa | Mensal | score/flags | Baixo | Alta | P2 | planejado | Dados abertos | Transparência fiscal | |
| Acordos de leniência | AGU/CGU | — | Acordos firmados | Irregular | grafo/flags | Baixo | Alta | P2 | planejado | Dados abertos | Transparência administrativa | |
