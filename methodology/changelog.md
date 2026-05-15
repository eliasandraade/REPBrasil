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
