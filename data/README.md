# data/

Esta pasta contém schemas de referência e exemplos mínimos de dados.

## Regra fundamental

**Nunca versionar datasets grandes ou com dados pessoais sensíveis no Git.**

Datasets reais devem ser armazenados em Object Storage (Cloudflare R2, AWS S3 ou equivalente)
e referenciados por URL ou path de configuração.

## O que pode entrar aqui

- Schemas JSON/Pydantic de referência
- Exemplos mínimos anonimizados (< 10 registros)
- Fixtures de teste

## O que nunca entra aqui

- Dumps completos de fontes oficiais
- Arquivos CSV/Parquet com dados reais de políticos
- Qualquer dado que exceda alguns KB
