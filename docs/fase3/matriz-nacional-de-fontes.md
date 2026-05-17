# Matriz Nacional de Fontes — REPBrasil

> Documento arquitetural central da Fase de Expansão.
> **Versão:** 1.0 | **Data:** 2026-05-17 | **Status:** Vigente
>
> Este documento é complementar ao catálogo operacional [`docs/matriz-de-fontes.md`](../matriz-de-fontes.md).
> Aquele é a referência técnica rápida. Este é a análise arquitetural de profundidade.

---

## Estrutura de análise por fonte

Cada fonte é analisada em 13 dimensões:

| Dimensão | Descrição |
|---|---|
| **O que contém** | Dados específicos disponíveis, campos relevantes, granularidade |
| **Qualidade documental** | Completude, consistência, lacunas conhecidas, cobertura histórica |
| **Confiabilidade histórica** | Estabilidade de schema, retrocompatibilidade, risco de quebra, continuidade histórica |
| **O que pode ser cruzado** | Relações documentalmente suportadas, identificadores compartilhados |
| **O que NÃO pode ser inferido** | Limites explícitos do que o dado permite concluir — crítico para o Princípio da Não Acusação |
| **Relações fortes** | Cruzamentos de alta confiança por identificador primário compartilhado |
| **Relações que exigem cautela** | Cruzamentos por nome, data ou localidade — risco de homônimo, desatualização |
| **Risco LGPD** | Análise detalhada: base legal, dados sensíveis, cuidados necessários |
| **Dificuldade técnica** | Formato, autenticação, rate limit, parsing, volume, frequência |
| **Custo jurídico** | Termos de uso, restrições contratuais, base legal aplicável |
| **Prioridade estratégica** | P0 / P1 / P2 com justificativa |
| **Dependências** | Outros conectores ou entidades necessários antes |
| **Valor para** | perfil / score / grafo / evidência |

---

## 1. TSE — Tribunal Superior Eleitoral

**URL base:** `https://dadosabertos.tse.jus.br/dataset/`
**Formato:** CSV (bulk download por eleição/UF), sem API REST estruturada
**Autenticação:** pública, sem autenticação

### 1.1 Candidaturas

**O que contém:**
- Nome completo, nome de urna, CPF (parcial), data de nascimento, gênero, grau de instrução
- Cargo disputado, UF, município, número de urna
- Partido (sigla, número, nome completo), coligação
- Situação da candidatura (deferida, indeferida, cassada, sub judice)
- Naturalidade, estado civil, ocupação declarada
- Número sequencial TSE (identificador único por candidatura)

**Qualidade documental:**
- Alta completude para eleições municipais (2016, 2020, 2024) e gerais (2018, 2022)
- CPF parcial (apenas dígitos visíveis) — identificação por número sequencial + nome
- Histórico desde 1994, mas schamas antigos são incompatíveis com schamas modernos
- Situação de candidatura pode mudar após publicação (recursos, cassações)

**Confiabilidade histórica:** `MÉDIA-ALTA`
- Schema muda entre eleições (novas colunas, renomeações de campos)
- Eleições 2024 têm colunas diferentes de 2022 e 2020
- Nomes de colunas em português com espaços e acentos — frágil para ETL
- TSE não mantém API versionada — cada eleição é um dataset independente
- Risco: arquivos podem ser reprocessados/corrigidos sem versionamento explícito

**O que pode ser cruzado:**
- Com bens declarados TSE: por número sequencial TSE (identificador forte)
- Com resultados eleitorais TSE: por número sequencial TSE
- Com filiações partidárias TSE: por CPF (quando disponível) ou nome+data de nascimento
- Com DataJud (CNJ): por nome + CPF (identificação cuidadosa)
- Com Receita Federal (CNPJ): por CPF do candidato como sócio de empresa

**O que NÃO pode ser inferido:**
- Candidatura não é mandato — candidato indeferido não exerceu cargo
- Filiação ao partido no momento da candidatura não indica filiação atual
- Ocupação declarada não é verificada pelo TSE — dado autodeclarado
- Grau de instrução não é verificado — dado autodeclarado
- Presença na lista de candidatos não implica elegibilidade em todas as jurisdições

**Relações fortes:**
- `Politician ↔ ElectionResult` via número sequencial TSE (mesma eleição)
- `Politician ↔ AssetDeclaration` via número sequencial TSE (mesma eleição)
- `Politician ↔ Party` via código e sigla do partido na candidatura

**Relações que exigem cautela:**
- `Politician ↔ Person` via CPF parcial — risco de colisão com homônimos de mesmo nome
- Cruzamento entre eleições diferentes via nome — políticos trocam partido, UF, cargo
- Cruzamento com CNPJ via CPF — requer validação adicional (CPF completo não disponível)

**Risco LGPD:** `BAIXO`
- Base legal: Art. 7º, IX LGPD — dados tornados manifestamente públicos pelo titular
- Art. 6º, III — interesse público e transparência eleitoral
- CPF parcial reduz risco de identificação direta
- Dado de cargo público e candidatura = dado manifestamente público

**Dificuldade técnica:** `MÉDIA`
- Arquivos CSV grandes (até 500MB por eleição por UF)
- Encoding inconsistente (Latin-1 em arquivos antigos, UTF-8 em recentes)
- Schema muda por eleição — pipeline precisa de mapeamento por ano
- Download direto sem API — sem rate limit mas sem controle de mudanças

**Custo jurídico:** `BAIXO`
- Dados abertos TSE — uso livre com atribuição
- Sem restrições contratuais
- Base legal sólida na LAI e legislação eleitoral

**Prioridade estratégica:** `P0` — fundação do sistema, já implementado parcialmente

**Dependências:** nenhuma

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (alta), `evidência` (alta)

---

### 1.2 Bens Declarados TSE

**O que contém:**
- Lista de bens por candidato (por eleição)
- Tipo de bem (imóvel urbano, rural, veículo, aplicação financeira, etc.)
- Valor declarado em reais
- Descrição textual (autodeclarada)
- Total declarado por candidato

**Qualidade documental:**
- Dado 100% autodeclarado — sem verificação cruzada pelo TSE
- Subavaliação de imóveis (valor venal vs. valor de mercado) é recorrente
- Bens em nome de cônjuge ou terceiros não aparecem aqui
- Descrição de bens é texto livre — difícil de normalizar

**Confiabilidade histórica:** `MÉDIA`
- Disponível desde 2002 para eleições gerais
- Schema relativamente estável, mas descrição de tipos de bem muda
- Subconjunto menor do arquivo de candidaturas — mais estável

**O que pode ser cruzado:**
- Com candidaturas TSE: por número sequencial TSE (forte)
- Com CNPJ Receita: descrição textual de empresa no bem (fraco — texto livre)

**O que NÃO pode ser inferido:**
- Valor declarado ≠ valor real de mercado
- Bem não declarado ≠ inexistência do bem (pode estar em terceiros)
- Variação de patrimônio entre eleições pode ter explicações legítimas (venda, herança, valorização)
- Patrimônio declarado não indica origem dos recursos — dado não verifica procedência
- Comparar patrimônio entre eleições sem ajuste de inflação é metodologicamente incorreto

**Relações fortes:**
- `Politician ↔ AssetDeclaration` via número sequencial TSE

**Relações que exigem cautela:**
- Cruzamento de patrimônio entre diferentes eleições (partidos/cargos diferentes)
- Correlação entre patrimônio e contratos recebidos — requer múltiplas fontes

**Risco LGPD:** `BAIXO`
- Dado tornado público pelo próprio candidato como requisito legal de candidatura
- Lei das Eleições exige declaração de bens — dado manifestamente público

**Dificuldade técnica:** `BAIXA`
- CSV menor, schema relativamente simples
- Já implementado no ETL (TseCandidatesPipeline)

**Prioridade estratégica:** `P0` — já implementado

**Dependências:** Candidaturas TSE (P0)

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (baixa), `evidência` (alta)

---

### 1.3 Resultados Eleitorais TSE

**O que contém:**
- Resultado por candidato por município
- Total de votos, percentual, situação (eleito, não eleito, suplente)
- Turno (1º, 2º)
- Votos nominais, votos de legenda
- Comparecimento, abstenção, votos brancos/nulos por seção

**Qualidade documental:**
- Alta confiabilidade — resultado oficial homologado pela Justiça Eleitoral
- Granularidade até seção eleitoral
- Histórico completo desde 1994

**Confiabilidade histórica:** `ALTA`
- Schema de resultados é mais estável que candidaturas
- Identificador de candidato por número sequencial TSE é consistente dentro de cada eleição
- Comparação entre eleições requer mapeamento de identificadores (candidato pode ter sequencial diferente em cada eleição)

**O que pode ser cruzado:**
- Com candidaturas TSE: por número sequencial TSE (forte)
- Com filiações partidárias: por CPF (quando disponível)
- Com Câmara/Senado: para validar se eleito realmente tomou posse

**O que NÃO pode ser inferido:**
- Eleição não implica posse (pode haver cassação, renúncia, morte)
- Votos recebidos não refletem apoio ideológico — resultado eleitoral é um fato, não análise
- Não eleito não implica ausência de mandato (suplente pode assumir)

**Relações fortes:**
- `ElectionResult ↔ Politician` via número sequencial TSE
- `ElectionResult ↔ Election` (município, cargo, ano)

**Relações que exigem cautela:**
- Comparação de desempenho eleitoral entre cargos diferentes (deputado federal vs. estadual)
- Suplentes que assumem mandato — cruzamento com Câmara/Senado necessário

**Risco LGPD:** `BAIXO` — resultado eleitoral é dado público oficial

**Dificuldade técnica:** `MÉDIA` — arquivos grandes, um por estado por eleição

**Prioridade estratégica:** `P0` — implementado

**Dependências:** Candidaturas TSE

**Valor para:** `perfil` (alta), `score` (média), `grafo` (alta), `evidência` (alta)

---

### 1.4 Filiações Partidárias TSE

**O que contém:**
- Histórico de filiações de todos os eleitores filiados a partidos
- Nome, data de nascimento, UF, município, zona, seção
- Partido, data de filiação, situação (regular, cancelada, em duplicidade)

**Qualidade documental:**
- Altíssima cobertura — todos os filiados a partidos registrados no TSE
- Atualização mensal com data de referência explícita
- Histórico de situações (regular, cancelada) mas não de histórico de trocas de partido

**Confiabilidade histórica:** `ALTA`
- Formato estável ao longo dos anos
- Publicado mensalmente com data de referência
- Um dos datasets mais confiáveis do TSE

**O que pode ser cruzado:**
- Com candidaturas TSE: por nome + data de nascimento (cautela: homônimos)
- Com dados de partidos: por código de partido TSE

**O que NÃO pode ser inferido:**
- Filiação atual não implica atividade política
- Cancelamento de filiação não implica desfiliação voluntária (pode ser cassação, morte)
- Histórico de trocas de partido não é diretamente inferível — apenas snapshot mensal

**Relações fortes:**
- `Politician ↔ Party` — quando cruzado com candidatura por CPF confirmado

**Relações que exigem cautela:**
- Identificação de político em filiações por nome (sem CPF completo na candidatura)
- Histórico de partidos anteriores — requer cruzamento de snapshots mensais

**Risco LGPD:** `BAIXO-MÉDIO`
- Filiação partidária é dado tornado público pelo TSE — base legal sólida
- Inclui dados de eleitores não políticos — cuidado com escopo de uso
- REPBrasil deve limitar uso ao subconjunto de candidatos/mandatários

**Dificuldade técnica:** `ALTA`
- Arquivo muito grande (>50M de registros)
- Requer filtro por candidatos relevantes ao REPBrasil
- Identificação cruzada com candidatos sem CPF completo é complexa

**Prioridade estratégica:** `P1`

**Dependências:** Candidaturas TSE com CPFs parciais resolvidos

**Valor para:** `perfil` (alta), `score` (média), `grafo` (alta), `evidência` (média)

---

### 1.5 Doações de Campanha TSE (SPCE)

**O que contém:**
- Doações recebidas e gastos de candidatos/partidos
- Doador: nome, CPF/CNPJ, valor, data
- Receptor: candidato ou partido
- Descrição do recurso

**Qualidade documental:**
- Dado obrigatório por lei — alta cobertura formal
- Subnotificação possível (doações não declaradas são ilegais mas ocorrem)
- Doações de pessoas físicas são identificadas por CPF

**Confiabilidade histórica:** `MÉDIA`
- Dataset disponível desde 2010 para municipais, 2002 para gerais
- Schema muda entre eleições
- Sistema SPCE foi redesenhado em 2016 e 2022 — dados anteriores têm formato diferente

**O que pode ser cruzado:**
- Doadores CNPJ: com Receita Federal para identificar empresas
- Doadores CPF: com candidatos TSE (se for candidato doando para outro)
- Com contratos PNCP: empresa que doou e depois ganhou contrato (vínculo documental — **NÃO implica corrupção**)

**O que NÃO pode ser inferido:**
- Doação → favorecimento em contratos: correlação temporal documentável, mas causalidade **não** pode ser afirmada
- Doador não é cúmplice de eventuais ilícitos do candidato
- Empresa que doa e vence licitação pode ter feito tudo legalmente

**Relações fortes:**
- `Person/Company ↔ Politician` via doação de campanha (vínculo documental direto)

**Relações que exigem cautela:**
- Cruzamento doação → contrato: relação temporal documentável, interpretação é do cidadão
- Doadores repetidos: padrão documentável, não inferência de intenção

**Risco LGPD:** `BAIXO`
- Doações de campanha são dados públicos por legislação eleitoral
- CPF de doadores é dado público neste contexto específico

**Dificuldade técnica:** `MÉDIA`
- Arquivo moderado, schema varia por eleição
- Normalização de nomes de doadores é complexa

**Prioridade estratégica:** `P1` — alto valor investigativo documental

**Dependências:** Candidaturas TSE, Receita Federal CNPJ

**Valor para:** `perfil` (média), `score` (alta), `grafo` (muito alta), `evidência` (muito alta)

---

## 2. Câmara dos Deputados

**URL base:** `https://dadosabertos.camara.leg.br/api/v2/`
**Formato:** JSON via API REST versionada (v2)
**Autenticação:** pública, sem autenticação, rate limit moderado

### 2.1 Dados de Deputados

**O que contém:**
- Dados cadastrais: nome, partido, UF, foto, bio, situação (ativo, licenciado, suplente)
- ID interno da Câmara (ideCadastro) — identificador estável
- Histórico de mandatos
- Comissões permanentes e temporárias
- Mesa Diretora

**Qualidade documental:**
- Muito alta — fonte primária de dados legislativos federais
- API bem mantida com versão explícita (v2)
- Identificador da Câmara (ideCadastro) é estável entre legislaturas

**Confiabilidade histórica:** `ALTA`
- API v2 existe desde 2016 com contrato de interface relativamente estável
- Dados históricos desde a 49ª Legislatura (1991)
- Eventuais breaking changes são documentados no changelog da API
- Melhor confiabilidade histórica entre todas as APIs governamentais mapeadas

**O que pode ser cruzado:**
- Com candidaturas TSE: por nome + partido + UF (ou CamaraId que o ETL já armazena)
- Com CEAP: pelo ID interno da Câmara (forte)
- Com votações: pelo ID interno (forte)
- Com emendas parlamentares (SIOP): por identificação do parlamentar

**O que NÃO pode ser inferido:**
- Voto em plenário não implica posição ideológica permanente
- Participação em comissão não implica favorecimento de projetos
- Licença do mandato não implica renúncia ou punição

**Relações fortes:**
- `Politician ↔ Vote` via ID interno da Câmara
- `Politician ↔ Amendment` via ID parlamentar em SIOP/TransfereGov
- `Politician ↔ ElectionResult` via ID TSE armazenado em Politician.CamaraId

**Relações que exigem cautela:**
- Cruzamento com partidos: deputado pode ter trocado de partido no meio do mandato (janela partidária)

**Risco LGPD:** `BAIXO` — dados funcionais de agentes públicos

**Dificuldade técnica:** `BAIXA-MÉDIA`
- API REST bem documentada
- Paginação padrão com links de navegação
- Rate limit: ~300 req/min — respeitar com backoff

**Prioridade estratégica:** `P0` — dados essenciais de deputados federais

**Dependências:** nenhuma (fonte primária)

**Valor para:** `perfil` (muito alta), `score` (alta), `grafo` (alta), `evidência` (alta)

---

### 2.2 Gastos da Cota Parlamentar (CEAP)

**O que contém:**
- Todos os gastos reembolsados pela Cota para Exercício da Atividade Parlamentar
- Fornecedor: nome, CNPJ
- Tipo de despesa (passagens, combustível, alimentação, locação, etc.)
- Valor, data, nota fiscal, competência (mês/ano)
- Reembolsos devolvidos

**Qualidade documental:**
- Alta cobertura — todos os gastos reembolsados são obrigatoriamente registrados
- Dados desde 2008
- CNPJs de fornecedores identificados
- Suspeita de superfaturamento não é verificável apenas por este dataset

**Confiabilidade histórica:** `ALTA`
- Dataset existe desde 2008 com schema relativamente estável
- Câmara publica arquivo XML/JSON mensal
- Eventuais correções são republicadas

**O que pode ser cruzado:**
- Com Receita Federal CNPJ: identificar fornecedor (forte — via CNPJ)
- Com candidaturas TSE: verificar se fornecedor tem vínculo com doador de campanha
- Com PNCP: empresa que fornece para CEAP e também vence contratos públicos

**O que NÃO pode ser inferido:**
- Gasto alto ≠ irregularidade
- Fornecedor recorrente ≠ favorecimento
- Gasto com empresa X não implica relação pessoal do deputado com o dono de X

**Relações fortes:**
- `Politician ↔ Company` via CNPJ do fornecedor CEAP (vínculo documental de prestação de serviço)

**Relações que exigem cautela:**
- Correlação entre fornecedor CEAP e doador de campanha: documentável, mas interpretação é do cidadão

**Risco LGPD:** `BAIXO` — dado de agente público em exercício de função

**Dificuldade técnica:** `MÉDIA`
- Volume alto (anos de dados)
- Normalização de nomes de fornecedores (mesmo CNPJ com nome fantasia diferente)

**Prioridade estratégica:** `P0`

**Dependências:** API de Deputados da Câmara

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (muito alta), `evidência` (alta)

---

### 2.3 Votações em Plenário

**O que contém:**
- Votações nominais em plenário e comissões
- Voto de cada deputado (sim/não/abstenção/obstrução/art. 17)
- Proposição votada (PL, PEC, MP, etc.)
- Data, sessão, resultado

**Qualidade documental:**
- Alta — votação é registro oficial da Casa Legislativa
- Cobertura completa de votações nominais desde 2003

**Confiabilidade histórica:** `ALTA`

**O que pode ser cruzado:**
- Com proposições: via ID da proposição na API da Câmara
- Com mandatos: via ID interno do deputado

**O que NÃO pode ser inferido:**
- Sentido do voto não implica posição ideológica permanente
- Voto com o governo ≠ fidelidade partidária forçada
- Abstenção não implica conivência ou oposição
- Padrão de voto não é inferência política — é registro documental de ato público

**Relações fortes:**
- `Politician ↔ Vote` (registro oficial de ato público)

**Relações que exigem cautela:**
- Correlação entre padrão de voto e financiadores de campanha: documentável como coincidência temporal, não como causalidade

**Risco LGPD:** `BAIXO` — voto em plenário é ato público por natureza constitucional

**Dificuldade técnica:** `MÉDIA`
- Volume alto
- Cada votação tem sua própria requisição na API — necessidade de paginação por data

**Prioridade estratégica:** `P1`

**Dependências:** API de Deputados

**Valor para:** `perfil` (alta), `score` (média), `grafo` (média), `evidência` (alta)

---

## 3. Senado Federal

**URL base:** `https://legis.senado.leg.br/dadosabertos/`
**Formato:** XML/JSON via API REST
**Autenticação:** pública

### 3.1 Dados de Senadores

**O que contém:**
- Dados cadastrais dos senadores (atuais e históricos)
- Mandatos, suplentes, comissões
- ID interno do Senado
- Partido, UF, legislatura

**Qualidade documental:**
- Alta para senadores em exercício
- Histórico disponível mas com lacunas em legislaturas antigas

**Confiabilidade histórica:** `MÉDIA`
- API menos madura que a da Câmara
- Mudanças de schema sem versionamento explícito
- Alguns endpoints retornam erros em legislaturas antigas

**O que pode ser cruzado:**
- Com TSE: por nome + partido + UF
- Com gastos do Senado: pelo ID interno

**O que NÃO pode ser inferido:**
- Suplente que assume temporariamente ≠ senador com mandato pleno para todos os fins

**Relações fortes:**
- `Politician ↔ ElectionResult` via identificação por mandato

**Relações que exigem cautela:**
- Identificação por nome (sem CPF disponível na API)

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `MÉDIA` — API menos estável e documentada que a da Câmara

**Prioridade estratégica:** `P0`

**Dependências:** nenhuma

**Valor para:** `perfil` (muito alta), `score` (alta), `grafo` (alta), `evidência` (alta)

---

### 3.2 Gastos do Senado (SAPS)

**O que contém:**
- Gastos de senadores com verba de gabinete e cotas
- Fornecedor, CNPJ, valor, tipo de despesa, competência

**Qualidade documental:**
- Similar ao CEAP da Câmara
- Menor historicidade disponível em formato aberto

**Confiabilidade histórica:** `MÉDIA`

**O que pode ser cruzado:** idem CEAP

**O que NÃO pode ser inferido:** idem CEAP

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `MÉDIA`

**Prioridade estratégica:** `P1`

**Dependências:** API de Senadores

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (alta), `evidência` (alta)

---

## 4. Portal da Transparência — CGU

**URL base:** `https://api.portaldatransparencia.gov.br/api-de-dados/`
**Formato:** JSON via API REST com chave de API
**Autenticação:** requer cadastro e chave de API (gratuita)

### 4.1 Contratos Federais

**O que contém:**
- Contratos celebrados por órgãos federais
- Órgão contratante, CNPJ/CPF do contratado
- Valor, data de assinatura, vigência, objeto
- Modalidade de licitação, situação

**Qualidade documental:**
- Alta para contratos federais — obrigação legal de publicação
- Lacunas em contratos sigilosos (legalmente sigilosos)
- Atualizações podem ter atraso de publicação

**Confiabilidade histórica:** `MÉDIA`
- API foi significativamente reformulada em 2021
- Dados pré-2021 têm endpoint diferente ou são menos acessíveis
- Breaking changes entre versões da API ocorreram sem deprecation period adequado

**O que pode ser cruzado:**
- Com CNPJ Receita: identificar empresa contratada (forte — via CNPJ)
- Com doações TSE: empresa contratada que também doou para campanha (vínculo temporal documentável)
- Com CEIS/CNEP: empresa contratada com sanção ativa

**O que NÃO pode ser inferido:**
- Contrato com empresa X não implica favorecimento
- Empresa vencedora de múltiplos contratos não implica esquema irregular
- Contrato após doação não implica correlação causal

**Relações fortes:**
- `Company ↔ Contract ↔ PublicAgency` via CNPJ do contratado e órgão contratante

**Relações que exigem cautela:**
- Cruzamento contrato → doação → político: três fontes diferentes, interpretação é do cidadão
- Contratos de empresas com sócios políticos: requer Receita Federal para estabelecer vínculo

**Risco LGPD:** `BAIXO`
- Contratos públicos são dados obrigatoriamente públicos (LAI)
- CNPJ contratado é dado público

**Dificuldade técnica:** `MÉDIA-ALTA`
- Volume muito alto
- Paginação limitada (máx. 500 registros por requisição)
- Rate limit: ~100 req/min com chave
- Objetos de contrato em texto livre — difícil normalização

**Custo jurídico:** `BAIXO` — dado obrigatoriamente público, chave gratuita

**Prioridade estratégica:** `P0`

**Dependências:** Receita Federal CNPJ (para identificar contratados)

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (muito alta), `evidência` (alta)

---

## 5. PNCP — Portal Nacional de Contratações Públicas

**URL base:** `https://pncp.gov.br/api/pncp/v1/`
**Formato:** JSON via API REST
**Autenticação:** pública para consulta

### 5.1 Contratos PNCP (Lei 14.133/2021)

**O que contém:**
- Contratos sob a nova Lei de Licitações (14.133/2021)
- CNPJ contratado, órgão, valor, objeto, modalidade
- Itens do contrato quando disponíveis
- Histórico de aditivos

**Qualidade documental:**
- Alta para contratos pós-2022 (quando a lei entrou em vigor)
- Cobertura crescente — migração gradual dos órgãos

**Confiabilidade histórica:** `BAIXA` (sistema muito novo)
- PNCP foi lançado em 2021 — dados históricos inexistentes
- Schema ainda em consolidação — mudanças possíveis sem backward compatibility
- Não substitui dados de contratos anteriores (ainda no Portal da Transparência)
- Risco: sistema pode mudar significativamente nos próximos anos

**O que pode ser cruzado:**
- Com Receita Federal: via CNPJ do contratado
- Com Portal da Transparência: complementar (lei nova vs. lei antiga)

**O que NÃO pode ser inferido:**
- Mesmo conjunto de restrições que Portal da Transparência

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `BAIXA-MÉDIA`
- API razoavelmente documentada
- Volume menor que Portal da Transparência (sistema novo)

**Prioridade estratégica:** `P1` — crescente importância com migração para nova lei

**Dependências:** Receita Federal CNPJ

**Valor para:** `perfil` (média), `score` (média), `grafo` (alta), `evidência` (alta)

---

## 6. Receita Federal — CNPJ

**URL base:** `https://dados.rfb.gov.br/CNPJ/`
**Formato:** CSV bulk (arquivos de texto de largura fixa, comprimidos)
**Autenticação:** pública, sem autenticação

### 6.1 Cadastro Nacional de Pessoas Jurídicas

**O que contém:**
- Dados cadastrais de todas as empresas registradas no Brasil
- Razão social, nome fantasia, CNPJ, situação cadastral
- Data de abertura, natureza jurídica, porte
- Capital social
- Sócios: nome, CPF/CNPJ do sócio, qualificação (sócio, administrador, etc.), data de entrada
- Atividade econômica (CNAE)
- Endereço, telefone, email (quando disponíveis)

**Qualidade documental:**
- Muito alta — cadastro oficial de todas as empresas brasileiras
- Cobertura total: >60 milhões de CNPJs ativos e inativos
- Sócios históricos: inclui entradas e saídas (quando disponível)
- Inconsistências: alguns CNPJs têm dados incompletos ou desatualizados

**Confiabilidade histórica:** `ALTA`
- Dataset publicado mensalmente (dump completo)
- Formato razoavelmente estável ao longo dos anos
- Arquivo de largura fixa é robusto mas exige decoder específico
- Risco principal: volume e complexidade de parsing, não instabilidade de schema

**O que pode ser cruzado:**
- Com candidaturas TSE: CPF do candidato como sócio de empresa (identificação por CPF)
- Com doações TSE: CNPJ do doador
- Com contratos Portal da Transparência/PNCP: CNPJ do contratado
- Com CEIS/CNEP: CNPJ da empresa sancionada

**O que NÃO pode ser inferido:**
- Ser sócio de empresa ≠ gestão ativa da empresa
- Empresa com sócio político ≠ empresa favorecida por esse político
- Empresa inativa pode manter sócios no cadastro sem atividade real
- CNPJ sem situação de irregularidade ≠ empresa "idônea" (CNPJ não verifica outros aspectos)
- Participação societária não equivale a propriedade real (pode haver nominees/laranjas — mas isso **não pode ser afirmado** sem evidência judicial)

**Relações fortes:**
- `Person/Politician ↔ Company` via CPF como sócio no CNPJ (relação documental direta)
- `Company ↔ Company` via sócio pessoa jurídica (empresa que é sócia de outra)

**Relações que exigem cautela:**
- Cruzamento entre saída de sócio e atividade política: coincidência temporal documentável, não causalidade
- Empresa de familiar de político: requer identificação de familiares (não disponível no CNPJ diretamente)

**Risco LGPD:** `BAIXO-MÉDIO`
- Dados do CNPJ são públicos por definição (registro comercial obrigatório)
- CPF de sócios é dado público neste contexto específico
- Cuidado: agrupar dados de sócios para montar perfil de pessoa física vai além do uso previsto
- REPBrasil deve usar apenas o cruzamento CPF político → empresa, não montar perfil de pessoas comuns

**Dificuldade técnica:** `MUITO ALTA`
- Arquivo de texto com largura fixa (não CSV)
- Volume total: >20GB comprimido (>100GB descomprimido)
- Múltiplos arquivos separados (empresas, sócios, estabelecimentos, simples, etc.)
- Requer decodificador específico (encoding Latin-1, posições fixas de campos)
- Normalização de nomes de empresas e pessoas é complexa

**Custo jurídico:** `BAIXO` — dado público por natureza do registro comercial

**Prioridade estratégica:** `P0` — fundação do grafo de relacionamentos

**Dependências:** nenhuma (fonte independente), mas máximo valor quando cruzado com TSE

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (muito alta), `evidência` (muito alta)

---

## 7. SIOP e TransfereGov — Emendas Parlamentares

**SIOP:** `https://www.siop.planejamento.gov.br/`
**TransfereGov:** `https://www.transferegov.gov.br/`
**Formato:** variado (download CSV, API parcial)
**Autenticação:** pública

### 7.1 Emendas Parlamentares

**O que contém:**
- Emendas individuais de deputados e senadores ao Orçamento Geral da União
- Emendas de bancada e comissão
- Autor (deputado/senador), tipo, valor empenhado/pago
- Beneficiário: município, estado, entidade
- Classificação orçamentária (programa, ação, função)
- Status de execução (empenhado, liquidado, pago)

**Qualidade documental:**
- Boa cobertura para emendas federais
- Execução orçamentária pode ter atraso de publicação
- Distinção entre emenda individual, de bancada e de comissão é importante

**Confiabilidade histórica:** `MÉDIA`
- SIOP tem dados desde 2000, mas interface e formato mudaram muito
- TransfereGov é mais recente (unificou sistemas antes dispersos)
- Identificação do parlamentar autor usa CPF ou ID interno — nem sempre consistente

**O que pode ser cruzado:**
- Com candidaturas TSE: por CPF do parlamentar (quando disponível)
- Com contratos Portal da Transparência: beneficiário da emenda pode ter contrato
- Com municípios: destino da emenda (cruzamento geográfico)
- Com doações TSE: empresa que recebe benefício e também doou para campanha

**O que NÃO pode ser inferido:**
- Emenda para município da base eleitoral ≠ irregularidade (pode ser legítima representação)
- Emenda para entidade específica ≠ favorecimento ilegal
- Alto volume de emendas ≠ problema (parlamentares têm direito constitucional a emendar)
- Correlação emenda → doador: documentável como padrão temporal, interpretação é do cidadão

**Relações fortes:**
- `Politician ↔ Amendment ↔ Municipality` (destino documentado)

**Relações que exigem cautela:**
- Cruzamento emenda → beneficiário → doador: três passos, cada um com incerteza

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `ALTA`
- Múltiplos sistemas (SIOP, SIGA Brasil, TransfereGov) com dados parcialmente sobrepostos
- Identificação do parlamentar nem sempre por CPF
- Classificação orçamentária requer decodificação de tabelas auxiliares

**Prioridade estratégica:** `P0`

**Dependências:** Candidaturas TSE + Câmara/Senado (para identificar parlamentar)

**Valor para:** `perfil` (alta), `score` (alta), `grafo` (muito alta), `evidência` (alta)

---

## 8. CEIS e CNEP — Cadastros de Sanções

**URL base:** `https://api.portaldatransparencia.gov.br/api-de-dados/`
**Formato:** JSON via API Portal da Transparência
**Autenticação:** chave de API gratuita

### 8.1 CEIS — Cadastro de Empresas Inidôneas e Suspensas

**O que contém:**
- Empresas e pessoas físicas sancionadas por órgãos federais
- Tipo de sanção (inidoneidade, suspensão, impedimento)
- Órgão sancionador, prazo de vigência, processo de origem
- CNPJ/CPF do sancionado

**Qualidade documental:**
- Alta — alimentado diretamente pelos órgãos sancionadores
- Pode ter atraso na alimentação por parte de órgãos
- Sanções podem ser suspensas por liminar (não refletido imediatamente)

**Confiabilidade histórica:** `ALTA`
- Sistema existe desde 2013 com schema estável
- API do Portal da Transparência garante acesso estruturado

**O que pode ser cruzado:**
- Com Receita Federal CNPJ: empresa sancionada como sócia de político
- Com contratos Portal da Transparência: empresa com sanção ativa vencendo contratos
- Com candidaturas TSE: político com sanção pessoal (pessoa física)

**O que NÃO pode ser inferido:**
- Sanção administrativa ≠ condenação penal
- Empresa sancionada por um órgão não é "empresa criminosa"
- Sanção pode estar suspensa por recurso judicial — dados devem ser contextualizados

**Relações fortes:**
- `Company ↔ Flag[CEIS]` via CNPJ (registro documental de sanção administrativa)
- `Person ↔ Flag[CEIS]` para sanções a pessoas físicas

**Relações que exigem cautela:**
- Sanção suspensa por liminar deve ser exibida com status atualizado, não apenas a sanção original

**Risco LGPD:** `BAIXO`
- Sanção administrativa é dado público por natureza — interesse público explícito

**Dificuldade técnica:** `BAIXA`
- Volume pequeno, API bem estruturada
- Atualização frequente — requerer verificação periódica

**Prioridade estratégica:** `P0` — alto valor investigativo, baixíssima complexidade técnica

**Dependências:** nenhuma

**Valor para:** `perfil` (alta), `score` (muito alta), `grafo` (alta), `evidência` (muito alta)

---

### 8.2 CNEP — Cadastro Nacional de Empresas Punidas

**O que contém:**
- Empresas punidas com base na Lei Anticorrupção (Lei 12.846/2013)
- Acordos de leniência
- Ente federativo que aplicou a punição

**Qualidade documental:**
- Alta para punições federais
- Cobertura estadual/municipal variável

**Confiabilidade histórica:** `ALTA`

**O que NÃO pode ser inferido:**
- Punição de empresa não implica responsabilidade penal de sócios (salvo processo específico)

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `BAIXA`

**Prioridade estratégica:** `P0`

**Dependências:** nenhuma

**Valor para:** `perfil` (alta), `score` (muito alta), `grafo` (alta), `evidência` (muito alta)

---

## 9. TCU — Tribunal de Contas da União

**URL base:** `https://portal.tcu.gov.br/`
**Formato:** parcialmente estruturado (acórdãos em texto, alguns dados em API)
**Autenticação:** pública

### 9.1 Acórdãos e Sanções TCU

**O que contém:**
- Acórdãos de julgamento de contas
- Sanções aplicadas: inabilitação, multa, débito
- CNPJ/CPF do responsabilizado
- Processo, relatora, data do acórdão, situação

**Qualidade documental:**
- Alta para as decisões em si
- Parsing de acórdãos é complexo — texto livre com estrutura semi-fixa
- API estruturada disponível para sancionados, mas incompleta

**Confiabilidade histórica:** `MÉDIA`
- Dados históricos disponíveis mas em formatos heterogêneos
- API de sancionados é recente — dados mais antigos podem não estar estruturados
- Acórdãos disponíveis em PDF — parsing necessário para extração estruturada

**O que pode ser cruzado:**
- Com candidaturas TSE: CPF/CNPJ do responsabilizado
- Com CEIS/CNEP: sanção TCU pode gerar entrada no CEIS

**O que NÃO pode ser inferido:**
- Decisão de débito ≠ condenação criminal
- Responsabilizado em TCU pode ter recurso pendente ou decisão revertida
- Julgamento de contas irregular ≠ enriquecimento ilícito

**Relações fortes:**
- `Person/Politician ↔ Flag[TCU]` via CPF/CNPJ com decisão de TCU

**Relações que exigem cautela:**
- Situação de recurso deve ser verificada — decisão pode não ser definitiva

**Risco LGPD:** `BAIXO`
- Decisões do TCU são públicas

**Dificuldade técnica:** `ALTA`
- Parsing de acórdãos em PDF
- API estruturada de sancionados é o caminho mais viável

**Prioridade estratégica:** `P1`

**Dependências:** nenhuma para sancionados; parsing de PDF para acórdãos completos

**Valor para:** `perfil` (alta), `score` (muito alta), `grafo` (média), `evidência` (muito alta)

---

## 10. CNJ — DataJud

**URL base:** `https://datajud.cnj.jus.br/`
**Formato:** JSON via Elasticsearch API pública
**Autenticação:** API key pública (CNJ)

### 10.1 Processos Judiciais

**O que contém:**
- Processos em todos os tribunais brasileiros cadastrados no DataJud
- Número do processo (CNJ), tribunal, classe processual
- Partes: nome, CPF/CNPJ (quando disponível nas peças públicas)
- Movimentações públicas
- Assunto do processo

**Qualidade documental:**
- Alta para processos de tribunais que alimentam o DataJud
- Cobertura não é universal — tribunais têm cronograma de adesão
- Partes com CPF: disponível em muitos casos mas não todos
- Segredo de justiça: processos sigilosos não aparecem

**Confiabilidade histórica:** `MÉDIA`
- DataJud é sistema relativamente novo (2020+)
- API Elasticsearch tem características específicas — não é REST convencional
- CNJ pode mudar estrutura de dados

**O que pode ser cruzado:**
- Com candidaturas TSE: CPF do político como parte de processo
- Com CNPJ Receita: empresa como parte de processo

**O que NÃO pode ser inferido:**
- Réu em processo ≠ culpado (presunção de inocência)
- Processo em andamento não tem resultado definido
- Ação popular ou civil pública não implica procedência da acusação
- Quantidade de processos não é indicador de culpabilidade
- Processos cíveis (divórcio, dívida, etc.) são diferentes de processos criminais — o sistema deve distinguir claramente

**Relações fortes:**
- `Politician ↔ LegalCase` via CPF como parte (quando disponível)

**Relações que exigem cautela:**
- Identificação por nome: risco de homônimos em processos cíveis
- Status do processo deve ser atualizado — decisão pode mudar com recursos
- Natureza do processo deve ser sempre exibida (criminal vs. cível vs. eleitoral vs. trabalhista)

**Risco LGPD:** `MÉDIO`
- Processos públicos são dados públicos
- Mas agregação de processos de uma pessoa pode criar perfil investigativo sensível
- Atenção: processos que envolvam terceiros privados (cônjuges em divórcio, por exemplo)
- Base legal: publicidade processual (Lei de Acesso à Informação + Código de Processo)
- REPBrasil deve exibir apenas processos em que o político é parte, com natureza do processo explícita

**Dificuldade técnica:** `ALTA`
- Elasticsearch API com sintaxe específica
- Volume muito alto (todo o judiciário brasileiro)
- Identificação de pessoas por CPF nem sempre disponível
- Normalização de classe processual e assunto requer tabela de domínio do CNJ

**Custo jurídico:** `MÉDIO`
- Uso de dados processuais requer atenção especial à contextualização
- Exibir processo sem resultado definitivo requer nota metodológica clara

**Prioridade estratégica:** `P1`

**Dependências:** nenhuma técnica, mas requer policy de exibição definida

**Valor para:** `perfil` (muito alta), `score` (muito alta), `grafo` (média), `evidência` (muito alta)

---

## 11. Tribunais Eleitorais (TREs)

**Formato:** variado por estado — alguns com download, poucos com API
**Autenticação:** variada

### 11.1 Candidaturas e Resultados Estaduais

**O que contém:**
- Dados regionais complementares ao TSE
- Candidaturas estaduais com dados adicionais em alguns TREs
- Histórico eleitoral estadual em alguns estados

**Qualidade documental:**
- Variável por estado — TRE-SP tem melhor estruturação que TRE-AC, por exemplo
- Muitos dados já estão consolidados no TSE — sobreposição significativa

**Confiabilidade histórica:** `BAIXA-MÉDIA`
- Altamente variável por TRE
- Sem padrão de API entre estados
- Risco de quebra muito alto — não há compromisso de manutenção de APIs nos TREs

**O que NÃO pode ser inferido:** idem TSE

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `MUITO ALTA`
- 27 sistemas diferentes (um por estado + DF)
- Sem padronização de formato, endpoint ou schema
- Alguns requerem scraping, não têm API

**Prioridade estratégica:** `P2` — somente após esgotamento das fontes federais

**Dependências:** TSE consolidado

**Valor para:** `perfil` (baixa — dados já no TSE), `grafo` (baixa)

---

## 12. Diários Oficiais

### 12.1 Diário Oficial da União (DOU)

**URL base:** `https://www.in.gov.br/` + API Imprensa Nacional
**Formato:** HTML, PDF, e API JSON (recente)
**Autenticação:** API key para acesso estruturado

**O que contém:**
- Atos do executivo, nomeações, exonerações, portarias, contratos
- Publicações obrigatórias de órgãos federais
- Diário completo desde 1862 (digitalizado parcialmente)

**Qualidade documental:**
- Altíssima autoridade — o DOU é a publicação oficial
- Texto livre — extração de dados estruturados requer NLP ou parsing específico
- Cobertura histórica digital varia (pré-2010 em PDF; pós-2010 com melhor estruturação)

**Confiabilidade histórica:** `ALTA` (para o conteúdo em si), `BAIXA` (para extração estruturada)
- DOU existe desde 1862 — autoridade histórica máxima
- API estruturada da Imprensa Nacional é relativamente nova e pode mudar
- Extração de entidades do texto depende de NLP — resultado não é determinístico

**O que pode ser cruzado:**
- Nomeações: político nomeado para cargo → vínculo com órgão (forte quando estruturado)
- Contratos publicados: CNPJ de contratado

**O que NÃO pode ser inferido:**
- Publicação no DOU não é avaliação de mérito do ato
- Nomeação não implica nepotismo

**Risco LGPD:** `BAIXO` — publicação oficial pública por definição

**Dificuldade técnica:** `MUITO ALTA`
- Texto livre — requer parsing específico por tipo de ato
- Volume histórico enorme
- NLP necessário para extração de entidades com qualidade suficiente

**Prioridade estratégica:** `P2` — complexidade alta, requer infraestrutura de NLP

**Dependências:** infraestrutura de processamento de texto

**Valor para:** `perfil` (alta), `grafo` (alta), `evidência` (muito alta)

---

### 12.2 Querido Diário (Open Knowledge Brasil)

**URL base:** `https://queridodiario.ok.org.br/`
**Formato:** API e texto processado
**Autenticação:** pública

**O que contém:**
- Diários oficiais municipais de centenas de municípios brasileiros
- Texto processado (OCR + indexação)
- Cobertura: capitais e municípios médios (cobertura crescente)

**Qualidade documental:**
- Qualidade variável por município — depende da qualidade do PDF original
- OCR com erros em documentos antigos ou de baixa qualidade

**Confiabilidade histórica:** `BAIXA-MÉDIA`
- Projeto em expansão — cobertura muda continuamente
- Processamento de texto é probabilístico (OCR, NLP)
- API pode mudar com evolução do projeto

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `ALTA` — texto livre com OCR

**Prioridade estratégica:** `P2`

**Valor para:** `perfil` (média — municipal), `grafo` (média)

---

## 13. Transparência Municipal e Estadual

### 13.1 Portais de TCEs (Tribunais de Contas Estaduais)

**Formato:** completamente variável — 26 TCEs + TCM-SP + TCM-RJ
**Autenticação:** variada

**O que contém:**
- Contas de gestão municipal e estadual
- Sanções por irregularidade em contas municipais
- Inabilitações de gestores

**Qualidade documental:**
- Altamente variável por TCE
- Alguns TCEs (TCE-SP, TCE-MG) têm dados bem estruturados
- Outros não têm API ou dados abertos

**Confiabilidade histórica:** `MUITO BAIXA a ALTA` (depende do TCE)

**O que NÃO pode ser inferido:**
- Rejeição de contas municipais ≠ crime
- Gestor com contas rejeitadas pode ter recurso em andamento

**Risco LGPD:** `BAIXO`

**Dificuldade técnica:** `MUITO ALTA`
- 26+ sistemas diferentes sem padrão
- Maioria sem API — requer scraping
- Altíssimo risco de quebra

**Prioridade estratégica:** `P2` — foco inicial nos TCEs com melhor estruturação (SP, MG)

**Dependências:** infraestrutura de scraping + normalização

**Valor para:** `perfil` (média — para políticos estaduais/municipais), `score` (alta)

---

## 14. CGU PEP — Pessoas Expostas Politicamente

**URL base:** `https://api.portaldatransparencia.gov.br/api-de-dados/pep/`
**Formato:** JSON via API Portal da Transparência
**Autenticação:** chave de API gratuita

### 14.1 Cadastro de PEPs

**O que contém:**
- Lista de Pessoas Expostas Politicamente conforme Resolução BACEN 4.753/2019
- Nome, CPF, cargo, nível de PEP, órgão

**Qualidade documental:**
- Alta — alimentado por obrigação regulatória
- Definição de PEP inclui cônjuges e familiares próximos (até 2º grau) de agentes políticos

**Confiabilidade histórica:** `ALTA`
- Dataset com schema estável
- Atualização regular por obrigação regulatória bancária

**O que pode ser cruzado:**
- Com candidaturas TSE: CPF do PEP
- Com CNPJ Receita: PEP como sócio de empresa

**O que NÃO pode ser inferido:**
- Ser PEP é status regulatório, não indicação de irregularidade
- Familiar de político como PEP não implica envolvimento do político em atos do familiar
- Ser PEP não equivale a suspeita de lavagem de dinheiro

**Relações fortes:**
- `Person ↔ Flag[PEP]` via CPF

**Relações que exigem cautela:**
- Familiares de políticos como PEP: vínculo familiar documentável, sem implicação de responsabilidade compartilhada

**Risco LGPD:** `MÉDIO`
- Dado tornado público por regulação bancária
- Inclui familiares que não são figuras públicas — exibição deve ser contextualizada
- REPBrasil deve exibir PEP apenas quando relacionado diretamente ao perfil do político, com nota explicativa

**Dificuldade técnica:** `BAIXA`

**Prioridade estratégica:** `P1`

**Dependências:** nenhuma técnica

**Valor para:** `perfil` (média), `score` (média), `grafo` (alta), `evidência` (alta)

---

## Resumo de Prioridades

| Fonte | Prioridade | Dificuldade Técnica | Valor Investigativo | Confiabilidade Histórica |
|---|---|---|---|---|
| TSE Candidaturas | P0 | Média | Muito Alta | Média-Alta |
| TSE Bens Declarados | P0 | Baixa | Alta | Média |
| TSE Resultados Eleitorais | P0 | Média | Alta | Alta |
| Câmara — Deputados | P0 | Baixa-Média | Muito Alta | Alta |
| Câmara — CEAP | P0 | Média | Alta | Alta |
| Portal da Transparência | P0 | Média-Alta | Alta | Média |
| Receita Federal CNPJ | P0 | Muito Alta | Muito Alta | Alta |
| SIOP/TransfereGov | P0 | Alta | Alta | Média |
| CEIS/CNEP | P0 | Baixa | Muito Alta | Alta |
| Senado — Senadores | P0 | Média | Muito Alta | Média |
| TSE Filiações Partidárias | P1 | Alta | Alta | Alta |
| TSE Doações de Campanha | P1 | Média | Muito Alta | Média |
| Câmara — Votações | P1 | Média | Alta | Alta |
| Senado — Gastos | P1 | Média | Alta | Média |
| PNCP | P1 | Baixa-Média | Alta | Baixa |
| CNJ DataJud | P1 | Alta | Muito Alta | Média |
| TCU Sanções | P1 | Alta | Muito Alta | Média |
| CGU PEP | P1 | Baixa | Alta | Alta |
| TREs | P2 | Muito Alta | Baixa | Baixa-Média |
| DOU | P2 | Muito Alta | Muito Alta | Alta |
| Querido Diário | P2 | Alta | Média | Baixa-Média |
| TCEs Estaduais | P2 | Muito Alta | Alta | Variável |
