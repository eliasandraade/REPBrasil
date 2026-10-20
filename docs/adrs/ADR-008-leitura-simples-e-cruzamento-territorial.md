# ADR-008 — Leitura simples e cruzamento candidatura × perfil territorial no `/dados`

**Status:** Aceito
**Data:** 2026-10-20 (proposto e aceito pelo mantenedor, Elias, no mesmo dia)

Implementado no #51 (`feat/dados-territorial`), mantendo o `SocioElectoralCrossing`. Na aceitação, as frases do cruzamento passaram a descrever só o resultado observado, sem tom preditivo (Decisão 2).

## Contexto

- **Pedido do smoke humano do Ceará (item 10).** O `/dados` estava técnico demais para o usuário médio (Pearson, Spearman, N). O pedido foi simplificar os indicadores e trazer leituras prontas, como:
  - "qual o grau de instrução médio do eleitor do município X";
  - "se os analfabetos votam mais no candidato X ou Y".
- **Exigência já registrada.** `docs/CEARA_PRODUCT_COMPLETION.md` condicionou esse modo simples a um ADR:
  - frases por regras determinísticas e versionadas;
  - sem IA generativa em runtime;
  - sem falácia ecológica.
- **Dois limites dos dados:**
  1. **O voto é secreto.** O TSE publica votos por seção, zona e município, nunca por pessoa nem pela escolaridade de quem votou. "Analfabetos votam mais em X" não é observável em nenhuma fonte oficial. Só a leitura territorial é observável: "nos municípios com mais analfabetismo, X teve parcela maior dos votos válidos".
  2. **A escolaridade do eleitorado ainda não é ingerida** (perfil do eleitorado do TSE). O indicador carregado é a taxa de analfabetismo da população de 15 anos ou mais, do Censo 2022 (IBGE/SIDRA). Não é o mesmo universo do eleitorado.
- **O cruzamento já existia.** A API (`GET /api/v1/data/correlation?...&candidacyId=`) e a aba "Perfil socioeleitoral" do político já o mostravam, uma candidatura por vez (`docs/DATA_INTELLIGENCE.md`). O novo é a apresentação no `/dados`: duas candidaturas lado a lado, em frases.
- **Risco de uso.** Esse cruzamento também é insumo de segmentação de campanha. O REPBrasil não é ferramenta de campanha (`AGENTS.md`, `docs/manifesto.md`), então a forma de apresentá-lo precisa de decisão explícita.

## Decisão (proposta)

1. **Leitura simples por regras determinísticas.**
   - As frases são montadas no cliente a partir dos números da API, por regras fixas no código (`frontend/src/lib/territory/insights.ts`), sem IA generativa.
   - Força da associação pelo |ρ| de Spearman (postos, robusto a extremos como a capital):

     | \|ρ\| | Rótulo |
     |---|---|
     | < 0,1 | sem associação clara |
     | 0,1 a 0,3 | fraca |
     | 0,3 a 0,5 | moderada |
     | 0,5 a 0,99 | forte |
     | ≥ 0,99 | praticamente perfeita (a frase avisa que costuma ser construção: um indicador calculado a partir do outro) |

   - Com menos de 10 municípios com os dois dados, a força não é rotulada: a frase diz que são poucos, e a matriz mostra o coeficiente sem cor.
   - Classes do mapa: quantis, com os limites reais na legenda.
   - "Pontas": 20% dos municípios com menor e 20% com maior valor do indicador (desempate pelo código IBGE), comparadas pela média simples.
   - O modo técnico continua disponível como detalhe: coeficientes, N, dispersão, tabela e metodologia.
2. **Cruzamento só territorial.**
   - Toda frase fala de municípios, nunca de pessoas, e descreve o resultado observado, no passado, sem tom preditivo. Exemplo: "nos municípios com maior taxa de analfabetismo, A teve, em média, parcela maior dos votos válidos".
   - A direção ("maior" ou "menor") vem do sinal de ρ e só é afirmada quando as médias das pontas (a tabela ao lado) vão no mesmo sentido. Quando não vão, a frase diz que não houve diferença consistente.
   - A tela traz "Correlação não implica causalidade" e "leitura por município, não por pessoa".
3. **Simetria.**
   - Por padrão aparecem as duas candidaturas mais votadas no recorte, lado a lado, com a mesma métrica, a mesma frase e a mesma tabela.
   - A escolha é sempre entre as quatro mais votadas com voto. Nenhuma candidatura ganha uma moldura só dela.
   - Empate na primeira colocação aparece como empate, nunca como candidatura vencedora.
4. **Mesmo ano.** O indicador precisa ser do mesmo ano do pleito. Sem isso, a tela diz que falta o dado em vez de reaproveitar outro período.
5. **Só disputas estaduais ou nacionais.** Cargos municipais ficam de fora, porque cada município tem a própria disputa.
6. **Aberto a todos.**
   - O cruzamento não fica atrás de plano (Manifesto, seção Sustentabilidade).
   - As ferramentas pagas do `/dados` (matriz, exportação, série de emendas, modos visuais) não incluem o cruzamento.
7. **Fora do produto:**
   - ferramenta de segmentação ("encontre municípios com perfil X para a candidatura Y");
   - recomendação de alvo, previsão de voto ou ranking de municípios por "potencial";
   - exportação do resultado do cruzamento (a exportação do plano cobre só indicadores);
   - cruzamento com dado individual.

## Alternativas consideradas

- **Manter o cruzamento só no perfil do político (estado anterior).** É seguro, mas não responde à pergunta do smoke, que é comparar candidaturas.
- **Uma candidatura por vez no `/dados`.** Cria uma moldura sobre uma candidatura e obriga a comparar de cabeça.
- **Plano pago.** Rejeitada: seria vender exatamente o insumo de segmentação, e contraria a seção Sustentabilidade do Manifesto.
- **Frases geradas por IA.** Rejeitada: não é reprodutível nem auditável, e traz risco de inferência individual.

## Consequências

- O #51 entra com o cruzamento.
- Qualquer mudança nas regras (limiares, pontas, textos das frases) atualiza este ADR.
- **Para reverter no futuro:**
  - sai o `SocioElectoralCrossing` do modo eleitoral (um import e um bloco em `frontend/src/components/data/modes/useElectoralMode.tsx`) e o trecho correspondente de `docs/DADOS_EXPLORADOR.md`;
  - o resto do explorador não depende dele;
  - a aba do perfil do político continua como estava.
- **Pendência de dado.**
  - "Qual o grau de instrução médio do eleitor do município X" pede o perfil do eleitorado do TSE (escolaridade declarada no cadastro eleitoral, por município). A ingestão não existe.
  - Quando existir, entra como indicador próprio, com fonte, data de coleta e hash, sem substituir o do Censo.
