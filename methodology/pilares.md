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
