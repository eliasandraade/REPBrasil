# Grafo de Conexões Políticas — Neo4j

## Por que Neo4j?

Conexões políticas são naturalmente um grafo. Consultas como:

- "Quais empresas receberam contratos de municípios onde este político concentrou emendas?"
- "Quais políticos estão conectados a este fornecedor por mais de um caminho?"
- "Qual é a rede de sócios de empresas que receberam emendas deste deputado?"

São complexas em SQL (múltiplos JOINs com tabelas de adjacência) mas naturais em Cypher.

## Princípios do grafo

### Expansão progressiva

O grafo começa com conexões diretas e confirmadas.
Conexões de segundo e terceiro nível são adicionadas progressivamente conforme os dados chegam.

### Níveis de confiança

Toda aresta (relação) tem um nível de confiança:

| Nível | Significado | Impacto no score |
|-------|-------------|-----------------|
| `Confirmado` | Relação verificada em fonte oficial | Pode impactar diretamente |
| `Provável` | Relação com evidência forte mas não definitiva | Não impacta o score |
| `Inconclusivo` | Relação com evidência fraca | Não impacta o score |

### Conexões indiretas e o score

**Conexões indiretas aparecem visualmente no grafo mas NÃO impactam diretamente o score.**

Esta é uma regra fundamental do REPBrasil. O objetivo é informar, não acusar.
Conexões de segundo grau (amigo do amigo) são informação para o cidadão — não evidência de irregularidade.

### Evidências nas arestas

Toda relação carrega:
- `source`: URL ou identificador da fonte que confirma a relação
- `collectedAt`: data da coleta
- `confidence`: nível de confiança
- `startDate`: início da relação (quando conhecido)
- `endDate`: fim da relação (quando conhecido)

## Status

**Fase 0 — Fundação.** O esquema está documentado mas o Neo4j não está populado.
Implementação do grafo prevista para a Fase 4.
