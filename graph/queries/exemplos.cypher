// ============================================================
// REPBrasil — Exemplos de queries Cypher
// ============================================================
// Estas queries ilustram como navegar o grafo de conexões políticas.
// Todas assumem que o grafo está populado (Fase 4+).

// ------------------------------------------------------------
// 1. Partidos de um político (histórico completo)
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r:BELONGS_TO]->(party:Party)
RETURN party.name AS partido,
       party.acronym AS sigla,
       r.startDate AS inicio,
       r.endDate AS fim
ORDER BY r.startDate DESC;

// ------------------------------------------------------------
// 2. Empresas vinculadas a um político
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r:OWNS]->(c:Company)
RETURN c.name AS empresa,
       c.cnpj AS cnpj,
       r.role AS papel,
       r.startDate AS inicio,
       r.endDate AS fim,
       r.confidence AS confianca,
       r.source AS fonte
ORDER BY r.confidence, r.startDate DESC;

// ------------------------------------------------------------
// 3. Municípios que receberam emendas de um político
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[:ALLOCATED]->(a:Amendment)-[:BENEFITS]->(m:Municipality)
RETURN m.name AS municipio,
       m.state AS estado,
       sum(a.value) AS total_emendas,
       count(a) AS num_emendas
ORDER BY total_emendas DESC;

// ------------------------------------------------------------
// 4. Processos judiciais com condenação transitada
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r:HAS_LEGAL_CASE]->(lc:LegalCase)
WHERE lc.hasFinalConviction = true
RETURN lc.caseNumber AS processo,
       lc.court AS tribunal,
       r.source AS fonte,
       r.collectedAt AS coletado_em;

// ------------------------------------------------------------
// 5. Rede de conexões diretas de um político (1 salto)
//    Útil para renderizar o grafo visual inicial
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r]-(connected)
WHERE r.confidence = 'Confirmado'
RETURN p, r, connected
LIMIT 50;
