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
