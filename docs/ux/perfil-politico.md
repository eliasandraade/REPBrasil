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
