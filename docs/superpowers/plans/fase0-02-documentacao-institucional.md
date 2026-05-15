# REPBrasil Fase 0 — Bloco 2: Documentação Institucional

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (estrutura de pastas criada).

**Objetivo:** Escrever toda a documentação institucional, metodológica e técnica do projeto — o "porquê" e o "como" do REPBrasil, em português, antes de qualquer linha de código de produto.

---

## Arquivos criados

```
docs/
├── manifesto.md
├── governanca.md
├── auditoria.md
├── contestacao.md
├── lgpd.md
├── roadmap.md
├── master-spec.md
├── ux/
│   ├── home.md
│   └── perfil-politico.md
└── adrs/
    ├── ADR-001-linguagens-e-stacks.md
    ├── ADR-002-banco-de-dados.md
    ├── ADR-003-arquitetura-backend.md
    ├── ADR-004-grafo-neo4j.md
    ├── ADR-005-etl-python.md
    ├── ADR-006-frontend-nextjs.md
    └── ADR-007-licenca-open-source.md

methodology/
├── score-publico-v1.md
├── pilares.md
├── flags.md
└── changelog.md
```

---

## Decisões arquiteturais

- **Idioma PT-BR** para toda documentação institucional e metodológica.
- **Manifesto sem alteração editorial**: o texto do manifesto é o texto do manifesto.
- **Metodologia versionada desde v1.0.0**: o `changelog.md` começa aqui. Toda alteração futura gera nova versão.
- **ADRs no formato padrão** (Título / Status / Contexto / Decisão / Consequências): legível por qualquer engenheiro sem contexto prévio.
- **Score não é julgamento moral**: disclaimers explícitos obrigatórios no topo de `score-publico-v1.md`.
- **Flags não são culpa**: nota obrigatória no topo de `flags.md`.
- **LGPD documentada desde o início**: o projeto trata dados de pessoas públicas — a base legal precisa estar clara antes da Fase 1.
- **UX documentada antes do código**: `home.md` e `perfil-politico.md` servem como spec de produto para o desenvolvedor de frontend na Fase 3.

---

## Steps

### docs/manifesto.md

- [ ] **Criar `docs/manifesto.md`**

```markdown
# Manifesto REPBrasil

## Origem

O REPBrasil nasce para combater a desinformação com clareza documental.

O projeto não é partido, imprensa, tribunal ou movimento ideológico.

O projeto não existe para dizer em quem o eleitor deve votar.

O projeto existe para organizar dados públicos verificáveis, mostrar conexões,
expor padrões documentais e devolver ao cidadão a capacidade de enxergar.

## O que somos

Uma plataforma open source de transparência política e reputação pública documental.

Reunimos, organizamos, cruzamos e apresentamos dados públicos oficiais sobre políticos
brasileiros — para que qualquer cidadão compreenda, de forma simples e verificável,
quem são os representantes e candidatos que disputam ou exercem poder público.

## Compromisso central

- Com a verdade verificável.
- Com a transparência.
- Com a neutralidade.
- Com o povo brasileiro.
- Com a auditoria pública.

## O que usamos

Apenas:

- APIs governamentais
- Bases públicas oficiais
- Documentos públicos verificáveis
- Dados eleitorais oficiais
- Dados legislativos oficiais
- Registros administrativos oficiais
- Decisões judiciais oficiais

## O que não usamos

Jamais:

- Notícias
- Imprensa
- Redes sociais
- Rumores
- Denúncias não verificadas
- Vazamentos
- Opinião editorial
- Avaliação ideológica

## O que o sistema mostra

- Dados
- Fontes
- Score
- Flags
- Conexões
- Histórico
- Metodologia

## O que o sistema nunca diz

- "Este político é corrupto."
- "Este político é bom."
- "Este político é ruim."
- "Vote neste candidato."
- "Não vote neste candidato."

O juízo de valor pertence ao cidadão.

## Assinatura filosófica

**Sem medo. Sem lados. Sem joelhos no chão.**
```

### docs/governanca.md

- [ ] **Criar `docs/governanca.md`**

```markdown
# Governança REPBrasil

## Estrutura do projeto

O REPBrasil é:

- Open source
- Público
- Auditável
- Neutro
- Sem vínculo partidário, governamental ou empresarial

## Financiamento

O projeto poderá aceitar doações, desde que:

- Toda doação seja pública (valor, origem e data exibidos)
- Doadores não tenham poder de interferência editorial ou metodológica
- Não haja remoção ou inclusão de dados por pressão financeira
- A prestação de contas seja pública e atualizada

## Conflito de interesses

### Doadores

Nenhum doador pode:
- Solicitar remoção de dados de qualquer político
- Solicitar inclusão de dados não verificados
- Influenciar o cálculo do Score Público
- Alterar flags existentes
- Acessar dados antes da publicação

### Colaboradores e mantenedores

Colaboradores que possuam vínculo comprovado com partidos políticos, campanhas eleitorais
ou assessorias de políticos devem declarar esse vínculo publicamente antes de contribuir
com código que afete o score, flags ou metodologia.

### Políticos e assessorias

Políticos, assessores e representantes não podem:
- Solicitar alteração de dados fora do processo formal de contestação
- Interferir na metodologia de cálculo do score
- Pressionar por remoção de histórico
- Contatar mantenedores de forma privada sobre dados de seu perfil

Todo contato deve ser feito pelo processo público de contestação documentado em
[contestacao.md](contestacao.md).

### Regra fundamental de não interferência

**A metodologia do Score Público só pode ser alterada por:**
1. ADR documentado publicamente
2. Revisão da equipe de mantenedores
3. Registro no changelog da metodologia

Nenhuma pressão externa — financeira, política ou jurídica — justifica alteração
silenciosa ou não documentada.

## Processo de revisão

A equipe poderá revisar:

- Contestação formal de dados
- Erro comprovado de coleta
- Falha de pipeline
- Duplicidade de registro
- Homônimo identificado
- Vínculo incorreto por erro de fonte
- Fonte desatualizada ou inativa

### Regra de preservação de histórico

**Nenhuma correção pode apagar histórico sem registro.**

Toda alteração relevante gera:
- Entrada no changelog
- Log de auditoria
- Notificação pública se o dado for de alto impacto

## Limites de poder editorial

Nenhum mantenedor individual pode:
- Alterar o score de um político manualmente sem processo documentado
- Remover flags sem contestação formal aceita
- Modificar a metodologia sem ADR aprovado

Decisões de alto impacto requerem revisão de pelo menos dois mantenedores.
```

### docs/auditoria.md

- [ ] **Criar `docs/auditoria.md`**

```markdown
# Política de Auditoria e Antimanipulação

## Princípio fundamental

O REPBrasil é auditável por design. Toda decisão, coleta e cálculo deve ser
rastreável, verificável e reproduzível por qualquer pessoa com acesso ao repositório.

## Mecanismos técnicos

### Logs imutáveis

- Toda operação de escrita no banco gera entrada em log estruturado
- Logs não podem ser deletados — apenas arquivados
- Logs incluem: timestamp, operação, entidade, valor anterior, valor novo, origem

### Snapshots versionados

- Cada dataset coletado é armazenado com hash SHA-256
- Snapshots são imutáveis: uma nova coleta gera novo snapshot, não sobrescreve
- `ScoreSnapshot` é histórico permanente: novos cálculos geram novos registros

### Hash de datasets

- Todo arquivo de dados processado recebe hash SHA-256 calculado após coleta
- O hash é armazenado junto com o snapshot para verificação posterior
- Divergência entre hash esperado e real dispara alerta de pipeline

### Rastreamento de origem por item

- Todo dado exibido no perfil possui referência à `Source` de origem
- `Source` contém: `SourceType`, `OriginalUrl`, `CollectedAt`, `Hash`, `License`
- Não existe dado sem fonte no sistema

### Trilha de contestação

- Toda contestação recebida é registrada permanentemente
- Status histórico é preservado mesmo após resolução
- Ver processo completo em [contestacao.md](contestacao.md)

## Correções sem apagamento

**Erros podem e devem ser corrigidos. O histórico nunca é apagado.**

Quando um dado incorreto é identificado:

1. O dado incorreto recebe flag `corrigido` com data e justificativa
2. O dado correto é inserido como novo registro
3. O score é recalculado com o dado correto (novo `ScoreSnapshot`)
4. O histórico do dado incorreto permanece visível com marcação clara
5. A correção é registrada no changelog público

Isso garante que:
- Nenhum dado some silenciosamente
- Qualquer pessoa pode auditar o que mudou e por quê
- Manipulação retroativa é detectável

## Revisão comunitária

O repositório é público. Qualquer pessoa pode:
- Inspecionar o código de coleta
- Verificar os schemas de dados
- Auditar a metodologia do score
- Abrir Issue com suspeita de manipulação
- Submeter Pull Request com correção documentada

## Proteção contra alteração manual silenciosa

- Deployments são rastreados por hash de imagem
- Alterações em produção sem deploy documentado disparam alerta
- O código de cálculo do score é testado automaticamente em CI
- Toda alteração na metodologia requer ADR antes do merge
```

### docs/contestacao.md

- [ ] **Criar `docs/contestacao.md`**

```markdown
# Processo Público de Contestação

## O que pode ser contestado

- Dado incorreto ou desatualizado no perfil
- Vínculo incorreto (empresa, familiar, cargo)
- Processo judicial com status errado
- Score com fator baseado em dado incorreto
- Flag sem base documental verificável
- Homônimo (confusão com outra pessoa)

## O que não pode ser contestado

- Metodologia de cálculo (requer ADR separado)
- Dados corretos que sejam desfavoráveis
- Ausência de informações que não existem nas fontes oficiais
- Interpretação de dados (o sistema não interpreta — apenas exibe)

## Como enviar uma contestação

1. Acesse o perfil em questão no REPBrasil
2. Clique em "Contestar dado" ao lado do item específico
3. Preencha o formulário com:
   - Dado contestado (campo e valor atual)
   - Valor correto alegado
   - Documentação de suporte (obrigatório)
   - Fonte oficial que comprova a correção

**Contestações sem documentação de suporte serão rejeitadas automaticamente.**

## Documentação aceita

- Documentos oficiais (certidões, decisões judiciais, publicações no DOU)
- Links para fontes governamentais verificáveis
- Declarações oficiais de órgãos públicos

Não são aceitos:
- Notícias
- Declarações pessoais sem base documental
- Prints de redes sociais

## Status padronizados

| Status | Significado |
|--------|-------------|
| **Recebida** | Contestação registrada no sistema, aguardando triagem |
| **Em análise** | Equipe analisando documentação e verificando fontes |
| **Aceita** | Dado corrigido; histórico preservado com marcação |
| **Parcialmente aceita** | Parte do dado corrigido; justificativa documentada |
| **Rejeitada** | Contestação sem base documental suficiente; motivo registrado |
| **Atualizada por decisão oficial posterior** | Dado atualizado em função de nova decisão judicial ou administrativa |

## Preservação de histórico

**Toda contestação é permanente no sistema, independente do resultado.**

- Contestações aceitas: dado corrigido + histórico do dado anterior marcado
- Contestações rejeitadas: registro da contestação + justificativa da rejeição
- Nenhuma contestação some do sistema

## Prazo de análise

- Triagem inicial: até 5 dias úteis
- Análise completa: até 30 dias úteis
- Casos complexos: até 60 dias úteis com comunicação pública

## Transparência do processo

Toda contestação com status diferente de "Recebida" tem justificativa pública.
O número de contestações por político e por status é exibido no perfil.
```

### docs/lgpd.md

- [ ] **Criar `docs/lgpd.md`**

```markdown
# LGPD — Política de Tratamento de Dados

## Enquadramento legal

O REPBrasil trata dados pessoais de **pessoas públicas no exercício de função pública**,
com base nas seguintes hipóteses legais da Lei nº 13.709/2018 (LGPD):

- **Art. 7º, II**: tratamento necessário para o cumprimento de obrigação legal ou regulatória
- **Art. 7º, III**: tratamento pela administração pública para políticas públicas (base aplicada por analogia para fins de interesse público)
- **Art. 7º, IX**: legítimo interesse do controlador para fins de transparência, prestação de contas e controle social
- **Art. 11, §1º**: dados pessoais tornados manifestamente públicos pelo próprio titular ou pela natureza do cargo

## Finalidade

O tratamento de dados tem finalidade única e específica:

> Organizar, cruzar e apresentar publicamente dados públicos oficiais sobre
> pessoas que exercem ou disputam mandatos públicos, para fins de transparência
> política, controle social e prestação de contas democrática.

Não há finalidade comercial, publicitária ou de perfilagem para fins privados.

## Dados tratados

### O que tratamos

- Dados eleitorais públicos (TSE): candidaturas, resultados, bens declarados, filiação
- Dados legislativos públicos (Câmara, Senado): presença, produção, gastos, emendas
- Dados patrimoniais declarados publicamente
- Dados de processos judiciais públicos (DataJud/CNJ)
- Dados de contratos e compras públicas (PNCP, Portal da Transparência)
- Dados de empresas vinculadas (Receita Federal/CNPJ)

### O que não tratamos

- Dados de vida privada não relacionados ao exercício da função pública
- Dados de saúde
- Dados biométricos
- Dados de familiares que não ocupam função pública
- Dados obtidos de fontes não oficiais

## Princípios aplicados

### Finalidade
Os dados são usados exclusivamente para a finalidade declarada acima.

### Necessidade e minimização
Coletamos apenas o mínimo necessário para cumprir a finalidade. Dados desnecessários
para o perfil público não são armazenados.

### Transparência
- Toda informação exibida possui fonte visível
- A metodologia de cálculo do score é pública
- O código de coleta e processamento é open source

### Segurança
- Dados são armazenados em banco relacional com acesso controlado
- Pipelines de coleta rodam com credenciais de leitura apenas
- Sem armazenamento de senhas ou dados de autenticação de terceiros

## Dados públicos vs. dados pessoais sensíveis

Políticos, candidatos e servidores públicos em cargo de relevância têm **expectativa
reduzida de privacidade** quanto ao exercício de suas funções, conforme reconhecido
pela jurisprudência brasileira e pela própria LGPD (art. 11, §1º).

Os dados tratados pelo REPBrasil são, em sua totalidade:
1. Disponibilizados voluntariamente pelos próprios titulares (declarações de bens)
2. Produzidos no exercício de função pública (votações, emendas, gastos)
3. Publicados em bases governamentais de acesso público

## Direitos dos titulares

Qualquer titular pode:
- **Contestar** dado incorreto pelo processo em [contestacao.md](contestacao.md)
- **Solicitar esclarecimento** sobre como um dado é utilizado
- **Verificar** a fonte de qualquer informação exibida

**Não é possível solicitar exclusão de dados que são registros públicos.**
A exclusão de um dado verdadeiro e público contraria a finalidade do projeto
e a base legal do tratamento.

## Limites do tratamento

O REPBrasil **não**:
- Infere dados não disponíveis publicamente
- Cruza dados públicos com dados privados
- Atribui características pessoais não documentadas
- Faz perfilagem preditiva ou comportamental
- Compartilha dados com terceiros para fins comerciais
```

### docs/roadmap.md

- [ ] **Criar `docs/roadmap.md`**

```markdown
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
```

### docs/master-spec.md

- [ ] **Criar `docs/master-spec.md`**

Copiar o conteúdo integral do arquivo `REPBRASIL_MASTER_SPEC.md` fornecido pelo fundador do projeto.
Este arquivo é o documento-mãe — referência canônica para todas as decisões de produto e arquitetura.

Cabeçalho a adicionar no topo:

```markdown
# REPBrasil — Master Spec

> **Documento canônico.** Este é o documento-mãe do projeto.
> Todas as decisões de produto, arquitetura e metodologia derivam deste spec.
> Alterações requerem revisão dos mantenedores e registro no changelog.

**Versão:** 1.0
**Data:** 2026-05-15
**Status:** Vigente

---

[conteúdo integral do REPBRASIL_MASTER_SPEC.md a seguir]
```

### docs/matriz-de-fontes.md

- [ ] **Criar `docs/matriz-de-fontes.md`**

```markdown
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
|------|-------|---------|------|---------------|-----|------------|----------------|------------|--------|----------------|------------|-------------|
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
```

### docs/ux/home.md

- [ ] **Criar `docs/ux/home.md`**

```markdown
# UX — Home REPBrasil

## Inspiração

A experiência da home é inspirada no CSRep: busca central, sem distração,
com acesso imediato a estatísticas e links institucionais.

## Elementos obrigatórios

### Topo
- Logo REPBrasil
- Slogan: "Apenas dados. Sem discursos."

### Busca central (elemento principal)
- Campo de busca grande, centralizado
- Placeholder: "Buscar político, partido, estado ou cargo..."
- Aceita: nome, nome de urna, partido, estado, cargo, cidade
- Auto-complete futuro (Fase 3)

### Estatísticas gerais (abaixo da busca)
- Total de políticos cadastrados
- Total de eleições cobertas
- Total de fontes ativas
- Data da última atualização

### Explicação curta
- 2–3 frases explicando o que é o REPBrasil
- Link para o manifesto completo
- Link para a metodologia

### Rodapé institucional
- Link: Manifesto
- Link: Metodologia
- Link: API / Documentação
- Link: GitHub
- Link: Contribuir
- Licença AGPL-3.0

## Regras de design

- Mobile first (funcionar em 3G, celular simples)
- Primeiro carregamento deve ser leve (< 100KB HTML+CSS)
- Sem JavaScript obrigatório para ver a busca
- Grafo e análises avançadas: apenas sob demanda
- Sem animações pesadas

## O que NÃO deve aparecer na home

- Rankings políticos (induz interpretação)
- Notícias ou feeds externos
- Publicidade
- Chamadas para doação no primeiro fold
- Gráficos pesados no carregamento inicial
```

### docs/ux/perfil-politico.md

- [ ] **Criar `docs/ux/perfil-politico.md`**

```markdown
# UX — Perfil do Político

## Inspiração

A experiência do perfil é inspirada no CSRep: card lateral com identidade,
score grande e visível, abas de navegação, breakdown expansível do score,
módulos com informações profundas sob demanda, fonte em todos os blocos.

## Topo do perfil

### Card de identidade
- Foto (quando disponível)
- Nome completo
- Nome de urna
- Cargo atual ou disputado
- Partido
- Estado
- Cidade / base eleitoral

### Score Público
- Nota 0–10 em destaque
- Status textual neutro (ex: "Baixa presença de sinais críticos documentais")
- Resumo documental curto (máx. 5 bullets):
  - Ex: "Sem condenações transitadas em julgado"
  - Ex: "Patrimônio parcialmente compatível com renda estimada"
  - Ex: "2 flags patrimoniais identificadas"
- Principais flags

## Abas de navegação

| Aba | Conteúdo |
|-----|----------|
| Visão Geral | Resumo, score, timeline curta, principais conexões |
| Score Público | Breakdown completo, pilares, evolução histórica |
| Patrimônio | Bens declarados, evolução, compatibilidade |
| Partido | Histórico partidário, filiações, mudanças |
| Eleições | Candidaturas anteriores, resultados, votação |
| Conexões | Grafo político, empresas, municípios |
| Processos | Processos judiciais, status, condenações |
| Gastos | Cota parlamentar, fornecedores, padrões |
| Emendas | Valores, municípios, concentração |

## Score Público — breakdown expansível

Cada fator do score pode ser expandido.
Ao expandir, exibe:
- Dado bruto
- Origem (fonte)
- Cálculo e impacto no score
- Data de coleta
- Status de verificação

## Regras de interface

- Fonte visível em todos os blocos de dado
- "Atualizado em: [data]" em cada seção
- Comparação com média do cargo/estado disponível
- Grafo carrega progressivamente (não no primeiro render)
- Flags têm tooltip explicando o que significa
- Linguagem neutra em todos os elementos
- Nenhum julgamento moral implícito no texto da interface

## O que nunca aparece no perfil

- Adjetivos morais ("corrupto", "honesto", "bom político")
- Recomendação de voto
- Comparação ideológica
- Fontes não oficiais
```

### docs/adrs/ — 7 ADRs

- [ ] **Criar `docs/adrs/ADR-001-linguagens-e-stacks.md`**

```markdown
# ADR-001 — Idioma da documentação e nomenclatura de código

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O REPBrasil é uma plataforma voltada ao cidadão brasileiro, com documentação
institucional que precisa ser acessível para jornalistas, pesquisadores e
colaboradores sem formação técnica. Ao mesmo tempo, o código precisa ser legível
para desenvolvedores internacionais que possam contribuir com o projeto open source.

## Decisão

- **Documentação institucional e metodológica em Português (BR):** README, manifesto,
  metodologia, ADRs, governança, auditoria, contestação, LGPD, UX docs.
- **Código, entidades e nomenclaturas técnicas em Inglês:** nomes de classes, métodos,
  variáveis, schemas Pydantic, nós e arestas do Neo4j, colunas de banco de dados.
- **Futuramente:** `README.en.md` e CONTRIBUTING em inglês para colaboradores internacionais.

## Consequências

- Colaboradores brasileiros sem inglês fluente podem contribuir com documentação.
- Desenvolvedores internacionais podem ler e contribuir com código sem barreira.
- Entidades de domínio (`Politician`, `Election`, `ScoreSnapshot`) são universalmente legíveis.
- ADRs em português garantem que decisões técnicas sejam compreensíveis para o time fundador.
```

- [ ] **Criar `docs/adrs/ADR-002-banco-de-dados.md`**

```markdown
# ADR-002 — Estratégia de armazenamento de dados

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O REPBrasil precisa armazenar: dados relacionais (políticos, eleições, partidos),
cache de respostas frequentes, grafo de conexões políticas e dados de busca.
Cada necessidade tem características diferentes de acesso e escala.

## Decisão

- **PostgreSQL 16**: banco relacional principal. Armazena todas as entidades do domínio,
  snapshots de score, flags, fontes. Full Text Search para busca no MVP.
- **Redis 7**: cache de respostas da API (perfis, scores) e sessões futuras.
  Sem senha em desenvolvimento local; autenticação obrigatória em produção.
- **Neo4j 5 Community**: grafo de conexões políticas. Armazena nós e arestas tipadas
  com evidências e temporalidade. Expandido progressivamente conforme dados crescem.

## Alternativas consideradas

- **MongoDB**: descartado. Dados relacionais fortes (políticos ↔ partidos ↔ eleições)
  se beneficiam de schema rígido e joins.
- **Elasticsearch**: descartado para MVP. PostgreSQL FTS é suficiente para Fase 1–2.
  OpenSearch/Meilisearch a avaliar na Fase 5.
- **DynamoDB**: descartado. Sem justificativa de escala; adiciona complexidade operacional.

## Consequências

- Ambiente local exige três containers (docker-compose).
- Railway gerencia PostgreSQL e Redis como serviços nativos.
- Neo4j roda como Neo4j Aura (cloud) ou container dedicado em produção.
- Migrações do PostgreSQL via EF Core; schema do Neo4j versionado manualmente.
```

- [ ] **Criar `docs/adrs/ADR-003-arquitetura-backend.md`**

```markdown
# ADR-003 — Arquitetura do backend

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O backend precisa ser sustentável a longo prazo, com separação clara de
responsabilidades, testável sem dependência de infraestrutura, e extensível
para novos casos de uso sem refatorações destrutivas.

## Decisão

**Clean Architecture com .NET 8**, organizada em quatro projetos:

- `RepBrasil.Domain`: entidades, value objects, enums, interfaces de repositório.
  Zero dependências externas. É o núcleo do sistema.
- `RepBrasil.Application`: use cases, DTOs, interfaces de serviço.
  Depende apenas de `Domain`. Não conhece EF Core, HTTP ou banco de dados.
- `RepBrasil.Infrastructure`: implementações de repositório, EF Core, Redis, contexto.
  Depende de `Domain` e `Application`.
- `RepBrasil.API`: controllers, middleware, configuração, Swagger.
  Depende de `Application` e `Infrastructure`.

**Convenções de domínio:**
- `Guid` como identificador interno universal (independente de IDs externos do TSE/Câmara).
- IDs externos armazenados em campos separados (`TseId`, `CamaraId`).
- Todas as entidades herdam de `AuditableEntity` (`CreatedAt`, `UpdatedAt`, `DeletedAt`, `SourceUpdatedAt`).
- `ScoreSnapshot` é imutável: novos cálculos geram novos registros.
- Versionamento de API: `/api/v1/`.

## Consequências

- Alta testabilidade: `Application` pode ser testada sem banco de dados.
- Curva de aprendizado moderada para novos contribuidores.
- Adição de novos casos de uso não requer mudanças nas camadas inferiores.
- Swagger habilitado apenas em `Development`.
```

- [ ] **Criar `docs/adrs/ADR-004-grafo-neo4j.md`**

```markdown
# ADR-004 — Grafo de conexões políticas com Neo4j

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

Conexões políticas (político ↔ empresa ↔ partido ↔ município ↔ familiar)
são naturalmente um grafo. Consultas como "quais empresas receberam contratos
de municípios onde este político concentrou emendas?" são complexas em SQL
mas naturais em Cypher.

## Decisão

**Neo4j 5 Community** para o grafo de conexões políticas.

- Expansão progressiva: o grafo começa com conexões diretas e confirmadas.
- Níveis de confiança por aresta: `Confirmado` / `Provável` / `Inconclusivo`.
- Somente relações `Confirmado` impactam o score diretamente.
- Conexões indiretas aparecem visualmente no grafo mas **NÃO** impactam diretamente o score.
- Evidências são propriedades das arestas (fonte, data, URL).
- Temporalidade: cada aresta tem `startDate` e `endDate`.

## Alternativas consideradas

- **PostgreSQL com tabela de adjacências**: funciona para grafos pequenos, mas
  consultas de múltiplos saltos tornam-se impraticáveis.
- **Apache AGE (PostgreSQL extension)**: promissor, mas menos maduro e com menor
  ecossistema de ferramentas de visualização.

## Consequências

- Ambiente local requer Neo4j no docker-compose.
- Em produção: Neo4j Aura (opção gerenciada) ou container dedicado no Railway.
- Schema de grafo versionado manualmente em `graph/schema.md`.
- Visualização no frontend usa carregamento progressivo para não bloquear o render.
```

- [ ] **Criar `docs/adrs/ADR-005-etl-python.md`**

```markdown
# ADR-005 — ETL em Python com uv e Polars

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O ETL precisa coletar dados de dezenas de fontes governamentais com formatos
heterogêneos (CSV, JSON, XML, API REST), transformar e carregar no PostgreSQL
e Neo4j. A equipe fundadora tem familiaridade com Python para data engineering.

## Decisão

- **Python 3.12** como linguagem do ETL.
- **uv** como gerenciador de pacotes e ambientes virtuais (mais rápido que pip/poetry).
- **Polars** para transformação de dados (mais rápido que Pandas para datasets grandes).
- **Pydantic v2** para validação de schema de dados coletados.
- **httpx** para chamadas HTTP assíncronas às APIs governamentais.
- **Loguru** para logs estruturados nos pipelines.
- **Tenacity** para retry automático em falhas de rede.
- **pytest + ruff + mypy** para qualidade do código.

## Estrutura dos pipelines

Cada fonte implementa `BasePipeline` com três métodos: `collect()`, `transform()`, `load()`.

## Consequências

- Pipelines são independentes: falha em uma fonte não afeta outras.
- `uv sync` instala todas as dependências de forma determinística.
- Versão Python fixada em `.python-version` (3.12).
- Airflow/Dagster a avaliar na Fase 5 para orquestração.
```

- [ ] **Criar `docs/adrs/ADR-006-frontend-nextjs.md`**

```markdown
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
```

- [ ] **Criar `docs/adrs/ADR-007-licenca-open-source.md`**

```markdown
# ADR-007 — Licença AGPL-3.0

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O REPBrasil é um projeto open source. A escolha da licença afeta como terceiros
podem usar, modificar e redistribuir o código — especialmente em cenário onde
alguém hospede uma versão modificada como serviço web sem devolver as modificações.

## Decisão

**GNU Affero General Public License v3.0 (AGPL-3.0)**

## Justificativa

1. **Proteção de uso como serviço (SaaS)**: a AGPL exige que quem rode uma versão
   modificada como serviço web publique o código-fonte modificado. Isso previne
   que um ator crie um fork fechado do REPBrasil.

2. **Compatibilidade com br/acc**: o projeto br/acc, do qual podemos reaproveitar
   estrutura de ETL e grafo, também usa AGPL-3.0. Licenças incompatíveis impediriam
   reuso de código.

3. **Missão de transparência**: uma plataforma de transparência que não é transparente
   no próprio código seria contraditória.

## Alternativas consideradas

- **MIT**: permissiva demais para o caso de uso. Permitiria forks fechados.
- **GPL-2.0**: não cobre uso como serviço web (a "brecha SaaS").
- **CC-BY-SA**: inadequada para software (projetada para conteúdo).

## Consequências

- Contribuidores precisam aceitar que suas contribuições serão AGPL.
- Dados públicos (não código) não são afetados pela licença de software.
- Forks que rodam como serviço devem publicar o código-fonte modificado.
```

### methodology/score-publico-v1.md

- [ ] **Criar `methodology/score-publico-v1.md`**

```markdown
# Score Público REPBrasil — Metodologia v1.0.0

**Versão:** 1.0.0
**Data:** 2026-05-15
**Status:** Vigente

---

## ⚠️ O que o Score Público NÃO é

- O score **não** mede honestidade.
- O score **não** mede ideologia política.
- O score **não** recomenda voto.
- O score **não** julga o caráter moral do político.

## ✅ O que o Score Público É

O Score Público mede a **presença de sinais críticos documentais verificáveis**
em fontes públicas oficiais.

Quanto **menor** a presença de sinais críticos, **maior** o score.

O score é uma ferramenta de transparência documental — não um veredicto.
O juízo de valor pertence ao cidadão.

---

## Definição

O Score Público é um índice documental de:

- Transparência
- Integridade pública (documental)
- Responsabilidade administrativa
- Coerência patrimonial

Baseado **exclusivamente** em dados públicos oficiais verificáveis.

---

## Escala

| Faixa | Significado |
|-------|-------------|
| 0,0 – 2,0 | Presença extrema de sinais críticos documentais |
| 2,0 – 4,0 | Presença alta de sinais críticos documentais |
| 4,0 – 6,0 | Presença moderada de sinais críticos documentais |
| 6,0 – 8,0 | Presença baixa/moderada de sinais críticos documentais |
| 8,0 – 10,0 | Presença baixa de sinais críticos documentais |

Cores não são usadas no MVP para evitar leitura emocional excessiva.

---

## Pilares e pesos

| Pilar | Peso |
|-------|------|
| Integridade Pública | 35% |
| Transparência e Coerência Patrimonial | 25% |
| Responsabilidade Fiscal | 15% |
| Estrutura de Poder e Conexões | 15% |
| Atividade Pública | 10% |

Detalhamento em [pilares.md](pilares.md).

---

## Fórmula base

```
Score = Σ (Pilar_i × Peso_i) × FatorDeReducao
```

Onde `FatorDeReducao` é calculado a partir de penalidades por sinais críticos confirmados.

O cálculo detalhado por pilar está em [pilares.md](pilares.md).

---

## Regras fundamentais

1. **Condenações transitadas em julgado impactam o score** com peso máximo.
2. **Processos sem condenação NÃO reduzem o score** — geram apenas flag de atenção.
3. **Absolvições atualizam o score** imediatamente após processamento.
4. **Conexões indiretas não impactam diretamente o score** — aparecem no grafo como informação.
5. **Notícias não entram** em nenhuma etapa do cálculo.
6. **Redes sociais não entram** em nenhuma etapa do cálculo.
7. **Opinião ideológica não entra** em nenhuma etapa do cálculo.
8. **Voto "certo" ou "errado" não entra** — o sistema não avalia mérito político.
9. **Produção legislativa é quantitativa** — número de projetos, presenças. Nunca qualitativa.
10. **Mudança partidária não é ruim por si só** — o sistema mede frequência e consistência documental, não escolha ideológica.
11. **Todo fator tem fonte** — nenhum fator de score existe sem evidência rastreável.
12. **ScoreSnapshot é imutável** — novos cálculos geram novos registros. O histórico é preservado.

---

## Versionamento

Esta metodologia é versionada publicamente. Toda alteração:

1. Requer novo número de versão (semver: `v1.0.0`, `v1.1.0`, `v2.0.0`)
2. Requer entrada no [changelog.md](changelog.md)
3. Requer ADR se for alteração de peso ou pilar
4. Mantém histórico de scores calculados com versões anteriores

Ver [changelog.md](changelog.md).
```

### methodology/pilares.md

- [ ] **Criar `methodology/pilares.md`**

```markdown
# Pilares do Score Público — Detalhamento

**Versão da metodologia:** 1.0.0

---

## Pilar 1 — Integridade Pública (35%)

Mede a presença de sinais críticos de comprometimento da integridade pública
em registros oficiais.

### Fatores que reduzem o score

| Fator | Peso | Fonte |
|-------|------|-------|
| Condenação transitada em julgado por crime contra administração pública | Alto | DataJud/CNJ |
| Condenação transitada em julgado por improbidade administrativa | Alto | DataJud/CNJ |
| Condenação transitada em julgado por corrupção | Alto | DataJud/CNJ |
| Inclusão em CEIS (Cadastro de Empresas Inidôneas e Suspensas) | Médio | CGU |
| Inclusão em CNEP (Cadastro Nacional de Empresas Punidas) | Médio | CGU |
| Condenação em acórdão do TCU com débito/multa | Médio | TCU |
| Conflito de interesse documentado por órgão oficial | Médio | CGU/AGU |

### Fatores que NÃO reduzem o score (apenas geram flag)

| Fator | Tipo de flag |
|-------|-------------|
| Processo judicial sem condenação | Atenção |
| Inquérito policial sem indiciamento | Atenção |
| Investigação parlamentar (CPI) sem conclusão | Atenção |
| Ação de improbidade sem condenação transitada | Atenção Alta |

---

## Pilar 2 — Transparência e Coerência Patrimonial (25%)

Mede a compatibilidade entre o patrimônio declarado e as fontes de renda públicas conhecidas.

### Fatores analisados

| Fator | Fonte |
|-------|-------|
| Crescimento patrimonial entre eleições | TSE — bens declarados |
| Compatibilidade com renda pública estimada no período | TSE + Câmara/Senado + SIAPE |
| Variação patrimonial acima do padrão do cargo | TSE — análise histórica |
| Empresas vinculadas com contrato público | Receita Federal + PNCP |
| Bens sem declaração de origem clara | TSE |

### Cálculo de compatibilidade

A renda pública estimada é calculada com base nos subsídios/salários públicos conhecidos
no período (fontes oficiais). A variação patrimonial é comparada com essa estimativa.

**Linguagem neutra obrigatória**: o sistema nunca diz "patrimônio incompatível" de forma
acusatória. Usa: "variação patrimonial acima do padrão observado para o cargo no período."

---

## Pilar 3 — Responsabilidade Fiscal (15%)

Mede o uso de recursos públicos em comparação com normas e médias do cargo.

### Fatores analisados

| Fator | Fonte |
|-------|-------|
| Gastos de cota parlamentar acima da média | Câmara/Senado |
| Uso recorrente próximo ao teto da cota | Câmara/Senado |
| Concentração de gastos em fornecedor único | Câmara/Senado |
| Valores repetidos de forma incomum (mesmo fornecedor, mesmo valor) | Câmara/Senado |
| Aumento abrupto de gastos sem justificativa aparente | Câmara/Senado |

---

## Pilar 4 — Estrutura de Poder e Conexões (15%)

Mede vínculos documentados que podem indicar uso do cargo para benefício de rede relacionada.

### Fatores analisados

| Fator | Fonte |
|-------|-------|
| Nepotismo documental (familiar em cargo público indicado) | SIAPE + Câmara/Senado |
| Empresa do político ou familiar com contrato público | Receita Federal + PNCP |
| Alta concentração de emendas em municípios da rede relacionada | SIOP + TransfereGov |
| Emendas destinadas a empresas com vínculo documentado | SIOP + Receita Federal |

**Regra importante:** conexões indiretas aparecem visualmente no grafo mas NÃO
impactam diretamente este pilar. Apenas vínculos **Confirmado** afetam o score.

---

## Pilar 5 — Atividade Pública (10%)

Mede a participação institucional e produção pública quantitativa.

### Fatores analisados

| Fator | Fonte |
|-------|-------|
| Presença em votações do plenário | Câmara/Senado |
| Número de projetos de lei apresentados | Câmara/Senado |
| Participação em comissões | Câmara/Senado |
| Presenças em sessões ordinárias | Câmara/Senado |

**Regra importante:** este pilar é **puramente quantitativo**. O sistema não avalia
se um projeto de lei é "bom" ou "ruim". Apenas conta.
```

### methodology/flags.md

- [ ] **Criar `methodology/flags.md`**

```markdown
# Flags do Score Público

**Versão da metodologia:** 1.0.0

---

## ⚠️ Flags não representam culpa

Flags são **sinais documentais relevantes** que merecem atenção do cidadão.

A existência de uma flag **não significa** que o político cometeu crime,
ato ilícito ou qualquer ação reprovável. Significa que há um padrão documental
que o sistema identificou e que o cidadão pode investigar com as fontes indicadas.

O juízo sobre o significado de uma flag pertence ao cidadão.

---

## Tipos de flags

| Tipo | Significado |
|------|-------------|
| **Atenção** | Sinal documental relevante, sem gravidade imediata |
| **Atenção Alta** | Sinal documental com potencial impacto no score |
| **Atenção Crítica** | Sinal documental com impacto direto no score |

---

## Exemplos por tipo

### Atenção

- Processo judicial em andamento sem condenação
- Mudança partidária em período pré-eleitoral
- Gasto de cota acima da média do cargo (único episódio)
- Empresa vinculada recém-criada (sem contrato ainda)

### Atenção Alta

- Ação de improbidade administrativa sem condenação transitada
- Crescimento patrimonial acima do padrão sem renda pública equivalente conhecida
- Alta concentração de emendas em municípios com vínculo documentado
- Contrato público com empresa vinculada (valor moderado)
- Gasto recorrente próximo ao teto da cota parlamentar

### Atenção Crítica

- Condenação transitada em julgado (qualquer tipo)
- Inclusão em CEIS ou CNEP
- Acórdão do TCU com débito ou multa
- Nepotismo documentado por órgão oficial
- Empresa do político com contrato público de alto valor

---

## Regras de exibição

- Todas as flags têm **fonte obrigatória**
- Flags têm **data de identificação** e **data de verificação**
- Flags de Atenção Crítica ficam em destaque no topo do perfil
- Flags resolvidas (ex: condenação revertida) ficam marcadas como "resolvida" com histórico
- Nenhuma flag some sem registro

---

## Flags e o score

| Tipo de flag | Impacto no score |
|-------------|-----------------|
| Atenção | Nenhum impacto direto |
| Atenção Alta | Impacto leve (varia por pilar) |
| Atenção Crítica | Impacto direto no pilar correspondente |
```

### methodology/changelog.md

- [ ] **Criar `methodology/changelog.md`**

```markdown
# Changelog da Metodologia do Score Público

Todas as alterações na metodologia são registradas aqui.
O número de versão segue semver: `MAJOR.MINOR.PATCH`.

- `MAJOR`: mudança nos pilares, pesos ou fórmula base
- `MINOR`: adição de novos fatores ou fontes
- `PATCH`: correção de erro de cálculo ou fonte desatualizada

---

## v1.0.0 — 2026-05-15

**Lançamento inicial da metodologia.**

### Pilares definidos

- Integridade Pública (35%)
- Transparência e Coerência Patrimonial (25%)
- Responsabilidade Fiscal (15%)
- Estrutura de Poder e Conexões (15%)
- Atividade Pública (10%)

### Fontes base

P0: TSE, Câmara, Senado, Portal da Transparência, CEIS/CNEP, TCU, DataJud/CNJ,
Receita Federal CNPJ, PNCP, TransfereGov, SIOP.

### Regras fundamentais estabelecidas

- Condenações transitadas em julgado impactam o score.
- Processos sem condenação geram apenas flag.
- Conexões indiretas não impactam diretamente o score.
- Nenhuma fonte não oficial é aceita.
- ScoreSnapshot é imutável.

### Documentos associados

- `score-publico-v1.md`
- `pilares.md`
- `flags.md`
- ADR-003 (arquitetura backend)
```

- [ ] **10. Commit da documentação**

```bash
git add docs/ methodology/
git commit -m "docs: documentação institucional completa — manifesto, governança, metodologia, ADRs, LGPD, UX"
git push
```

---

## Critérios de sucesso

- [ ] `docs/manifesto.md` existe e contém o manifesto integral
- [ ] `docs/governanca.md` contém seção de Conflito de Interesses
- [ ] `docs/auditoria.md` contém seção de Correções sem apagamento
- [ ] `docs/contestacao.md` contém os 6 status padronizados
- [ ] `docs/lgpd.md` contém base legal e finalidade
- [ ] `docs/matriz-de-fontes.md` contém colunas P0/P1/P2 com coluna Base legal
- [ ] `docs/roadmap.md` contém Fases 0–6 com checkboxes
- [ ] Todos os 7 ADRs existem com Status, Contexto, Decisão e Consequências
- [ ] `methodology/score-publico-v1.md` contém disclaimers explícitos no topo
- [ ] `methodology/flags.md` contém nota "flags não representam culpa" no topo
- [ ] `methodology/changelog.md` contém entrada v1.0.0

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| Manifesto com tom acusatório involuntário | Revisar com a regra: "o sistema nunca diz X é Y, apenas mostra dados" |
| LGPD mal fundamentada — base legal fraca | Revisar art. 7º incisos II, III e IX antes de finalizar |
| ADRs com consequências não documentadas | Cada ADR deve ter pelo menos 2 consequências reais |
| Score com linguagem que induz julgamento moral | Revisar todos os textos: nenhum adjetivo moral é permitido |
| `master-spec.md` desatualizado se o spec mudar | Versionar com data; não é documento vivo — é snapshot canônico |
