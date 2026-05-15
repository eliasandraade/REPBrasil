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
