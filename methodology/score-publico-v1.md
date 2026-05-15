# Score Público REPBrasil — Metodologia v1.0.0

**Versão:** 1.0.0
**Data:** 2026-05-15
**Status:** Vigente

---

## O que o Score Público NÃO é

- O score **não** mede honestidade.
- O score **não** mede ideologia política.
- O score **não** recomenda voto.
- O score **não** julga o caráter moral do político.

## O que o Score Público É

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
