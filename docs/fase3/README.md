# Fase de Expansão — REPBrasil

> Documento-mestre da Fase de Expansão do REPBrasil.
> **Versão:** 1.0 | **Data:** 2026-05-17 | **Status:** Vigente

---

## O que muda nesta fase

O REPBrasil atingiu sua fundação técnica e visual: staging ativo no Railway, 1.000+ políticos importados do TSE, perfil funcional, redesign Investor Preview concluído, 6 migrações aplicadas.

A partir desta fase, o foco se desloca completamente para:

```
infraestrutura documental
modelagem política
conectores de dados
relações entre entidades
evidências rastreáveis
inteligência de dados estruturados
```

**O que deixa de ser foco desta fase:**

- UI, redesign visual, landing
- Features de frontend
- Deploy e infraestrutura de servidor
- Score e algoritmos
- Novas páginas ou componentes visuais

---

## Princípio da Não Acusação

**Este é o princípio mais importante da Fase de Expansão.**

> O REPBrasil não acusa.
> O REPBrasil não presume culpa.
> O REPBrasil não produz juízo penal, eleitoral ou moral.
>
> O sistema apenas:
> - organiza dados públicos documentais;
> - rastreia a origem e transformação de cada dado;
> - relaciona entidades quando há evidência documental suficiente;
> - apresenta evidências de forma verificável e auditável.
>
> **O juízo pertence ao cidadão.**

**O que isso significa na prática:**

Nenhum conector, entidade, relação, flag ou derivação pode:

- implicar culpa sem sentença transitada em julgado;
- presumir má-fé a partir de vínculos documentais;
- produzir narrativa política ou editorial;
- inferir intenção a partir de dados estruturais;
- qualificar relacionamentos como "suspeitos" sem evidência formal documentada;
- cruzar dados de forma a sugerir conclusões não suportadas pelos documentos originais.

**O REPBrasil apresenta o que documentos oficiais registram. Nada além disso.**

---

## Princípios da Expansão

### 1. Rastreabilidade total

Todo dado exibido deve ser rastreável até sua fonte primária. Nenhuma informação pode existir no sistema sem referência à `Source` de origem, timestamp de coleta, e hash do dataset. Ver [`camada-de-evidencia.md`](camada-de-evidencia.md).

### 2. Auditabilidade por design

Toda transformação de dados — extração, normalização, derivação, agregação — deve ser registrada. Qualquer pessoa com acesso ao repositório deve conseguir reproduzir o caminho entre o dado exibido e o documento original. Ver Chain of Transformation em [`camada-de-evidencia.md`](camada-de-evidencia.md).

### 3. Conservadorismo metodológico

Na dúvida, o sistema não afirma. Relações incertas são marcadas com grau de confiança adequado. Ausência de evidência não é evidência de ausência. Conflitos entre fontes são expostos publicamente, não ocultados. Ver [`ontologia-repbrasil.md`](ontologia-repbrasil.md).

### 4. Neutralidade radical

O REPBrasil não é ferramenta partidária, opositora, governista ou editorial. A mesma metodologia se aplica a todos os políticos sem exceção. Nenhum conector pode ser ativado para um grupo e não para outro. Nenhuma fonte pode ser selecionada com viés de resultado.

### 5. Explicabilidade

Todo dado exibido ao cidadão deve ser acompanhado de:
- de onde veio (fonte);
- quando foi coletado (timestamp);
- como foi processado (método de coleta, transformações);
- qual é o grau de confiança;
- se há contestação aberta.

### 6. Expansão segura

Novos conectores entram pela ordem definida no [`roadmap-conectores.md`](roadmap-conectores.md). Conectores com maior complexidade jurídica ou risco LGPD requerem avaliação antes de implementação. Entidades novas requerem ADR documentado antes de migração.

---

## Os 4 Documentos da Fase de Expansão

```
docs/fase3/
├── README.md                     ← este documento (mapa estratégico)
├── matriz-nacional-de-fontes.md  ← Bloco 1: análise arquitetural de fontes
├── ontologia-repbrasil.md        ← Bloco 2: modelagem conceitual de entidades e relações
├── camada-de-evidencia.md        ← Bloco 3: infraestrutura de evidências e rastreabilidade
└── roadmap-conectores.md         ← Bloco 4: ordem e prioridade de implementação
```

### Como os documentos se relacionam

```
MATRIZ DE FONTES
  ↓ define quais dados existem e sua qualidade
ONTOLOGIA
  ↓ define como modelar as entidades e relações derivadas das fontes
CAMADA DE EVIDÊNCIA
  ↓ define como rastrear cada dado desde a fonte até a apresentação
ROADMAP DE CONECTORES
  ↓ define a ordem de implementação baseada nos três anteriores
```

### Dependências entre documentos

| Documento | Depende de | Alimenta |
|---|---|---|
| Matriz de Fontes | — | Ontologia, Roadmap |
| Ontologia | Matriz de Fontes | Camada de Evidência, Roadmap |
| Camada de Evidência | Ontologia | Roadmap, Implementação |
| Roadmap de Conectores | Todos os anteriores | Implementação |

---

## Ordem de Implementação Recomendada

### Fase de Leitura (antes de qualquer implementação)
1. Ler [`matriz-nacional-de-fontes.md`](matriz-nacional-de-fontes.md) — entender o universo de fontes e suas limitações
2. Ler [`ontologia-repbrasil.md`](ontologia-repbrasil.md) — entender o modelo conceitual e graus de certeza
3. Ler [`camada-de-evidencia.md`](camada-de-evidencia.md) — entender os requisitos de rastreabilidade

### Fase de Implementação (após aprovação da fundação conceitual)
4. Seguir [`roadmap-conectores.md`](roadmap-conectores.md) — implementar conectores na ordem definida
5. A cada novo conector: criar ADR correspondente
6. A cada nova entidade: migração com spec aprovada

---

## O que esta fase NÃO é

| Não é | Por quê |
|---|---|
| Portal opinativo | Não produzimos análise editorial de dados |
| Sistema de acusações | Não presumimos culpa a partir de vínculos documentais |
| IA política | Não usamos inferência generativa ou modelos de linguagem sobre dados políticos |
| Ferramenta partidária | A metodologia se aplica igualmente a todos |
| Máquina de narrativa | Não construímos histórias — apresentamos documentos |
| Sistema de scoring reputacional subjetivo | O score futuro será documental e explicável, não opinativo |

---

## Glossário Essencial

| Termo | Definição no contexto REPBrasil |
|---|---|
| **Fonte** | Órgão público ou dataset oficial que origina os dados |
| **Evidência** | Registro documental que suporta um fato ou relação no sistema |
| **Vínculo documental** | Relação entre entidades suportada por registro oficial |
| **Relação indireta** | Relação inferível por cruzamento de fontes com identificador compartilhado |
| **Grau de confiança** | Nível formal de certeza sobre um dado ou relação (escala 1-6) |
| **Confiabilidade histórica** | Estabilidade de schema e continuidade histórica de uma fonte ao longo do tempo |
| **Chain of Transformation** | Trilha auditável desde o dado original até a apresentação ao usuário |
| **Conflito de evidência** | Estado em que duas ou mais fontes oficiais divergem sobre o mesmo fato |
| **Inferência** | Conclusão não diretamente suportada por documento — **não utilizada no REPBrasil** |
| **Normalização** | Processo de padronizar dados de diferentes fontes para um modelo comum |
| **Conector** | Pipeline ETL responsável por coletar, transformar e carregar dados de uma fonte |
| **Score** | Métrica composta, explícita e auditável — sempre em desenvolvimento, nunca como julgamento |
