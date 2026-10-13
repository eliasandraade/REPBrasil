# Ceará — smoke humano de fechamento

Roteiro que o Elias executa em produção **depois** do merge e do deploy do fechamento (#38 → #44).
Nenhum item é marcado `DONE` em [`CEARA_PRODUCT_COMPLETION.md`](CEARA_PRODUCT_COMPLETION.md) sem
este roteiro. Cada item diz a URL exata, os passos, o resultado esperado e o que conta como falha.
Valores conferidos em produção em 13/10/2026 estão indicados; depois das operações de ingestão os
números podem mudar, mas a forma do resultado não.

## Antes de começar

1. O workflow **Production smoke** do commit de merge na `main` terminou verde (GitHub → Actions →
   "Production smoke"). Ele já confere automaticamente: revisão implantada em front e API, APIs
   parlamentares, seções arquivadas servidas pelo lake, `/sw.js?v=<SHA>`, headers, contratos
   anônimos de auth (401/redirects de recusa), PWA offline com corte real de rede, páginas sem
   erro de console/5xx em desktop e celular e os quatro exports do comparador. Se ele falhou, pare
   aqui: o smoke humano não substitui o automático.
2. Para os itens 9 e 10, as operações pós-merge foram executadas (ver "Operações" em
   [`CEARA_PRODUCT_COMPLETION.md`](CEARA_PRODUCT_COMPLETION.md)). Sem elas, a página precisa mostrar
   a ausência explicitamente — e isso também é verificado.
3. Material: um computador com Chrome, um segundo navegador (Firefox ou janela anônima), um celular
   e acesso à caixa de entrada de `oeliasandraade@gmail.com` e de uma segunda conta comum.

Registre cada item como **OK** ou **FALHA** (com captura de tela e horário) na tabela do fim.

## 1. Login com Google

- **URL:** https://www.apprepbrasil.com.br/entrar
- **Passos:** sem sessão, clicar em "Continuar com Google"; escolher `oeliasandraade@gmail.com`;
  concluir no Google.
- **Esperado:** volta para `https://www.apprepbrasil.com.br/conta` já autenticado, com o e-mail da
  conta. Em DevTools → Application → Cookies de `api.apprepbrasil.com.br`, `repbrasil_session` está
  `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Falha:** erro do Google, página de erro do REPBrasil, retorno para `/entrar?erro=…` depois de
  concluir no Google, HTTP 500, ou sessão aberta com e-mail diferente.

## 2. Magic link no mesmo navegador

- **URL:** https://www.apprepbrasil.com.br/entrar
- **Passos:** sem sessão, informar o e-mail e clicar em "Receber link de acesso"; abrir o e-mail
  **no mesmo navegador** e clicar no link.
- **Esperado:** o e-mail chega em até 5 minutos; o link abre `/conta` autenticado. Clicar de novo no
  mesmo link (já usado) leva a `/entrar?erro=link-invalido` com a explicação, sem erro 500.
- **Falha:** e-mail não chega em 5 minutos; o primeiro clique não autentica; qualquer HTTP 500.

## 3. Magic link aberto em outro navegador (correlação)

- **URL:** https://www.apprepbrasil.com.br/entrar
- **Passos:** sair da conta; pedir um link novo no navegador A; copiar o link do e-mail e abri-lo no
  navegador B (outro navegador ou janela anônima); depois abrir o **mesmo** link no navegador A.
- **Esperado:** em B, `/entrar?erro=link-invalido` com um aviso explicando que o link foi aberto em
  um navegador diferente; B **não** fica autenticado. Em A, o mesmo link ainda autentica (a recusa
  em B não consome o link).
- **Falha:** B fica autenticado (**falha de segurança — interromper e reportar**); A não consegue
  usar o link depois da recusa em B; nenhuma explicação em B.

## 4. Conta, favoritos e saída

- **URL:** https://www.apprepbrasil.com.br/municipios/ce/fortaleza
- **Passos:** autenticado, marcar "Favorito" (☆) na página; abrir https://www.apprepbrasil.com.br/conta;
  clicar em "Sair".
- **Esperado:** o favorito aparece em `/conta` com o rótulo da página **sem** o sufixo " · REPBrasil";
  depois de "Sair", `/conta` pede login e o favorito não é mais acessível.
- **Falha:** favorito não aparece, rótulo termina com " · REPBrasil", ou a sessão continua ativa
  depois de "Sair".

## 5. Superadmin

- **URL:** https://api.apprepbrasil.com.br/api/v1/admin/me (abrir direto na barra de endereço)
- **Passos:** (a) autenticado como `oeliasandraade@gmail.com`; (b) autenticado com a conta comum;
  (c) em janela anônima, sem sessão.
- **Esperado:** (a) HTTP 200 com `"role":"superadmin"` e o e-mail; (b) HTTP 403 `{"error":"forbidden"}`;
  (c) HTTP 401.
- **Falha:** 200 para a conta comum (**falha de segurança**); 500 em qualquer caso; 403 em (a) — nesse
  caso conferir se o e-mail está em `Auth__SuperadminEmails` do `back-v2` (configuração, sem expor o
  valor em lugar nenhum) ou se a conta tem o entitlement `account.role = superadmin`.

## 6. Pesquisas e apuração

- **URL:** https://www.apprepbrasil.com.br/pesquisas
- **Passos:** com "1º turno", "Governador" e "Ceará"; depois alternar turno, cargo e abrangência
  (Brasil/Presidente); abrir links de proveniência de um registro. Seguir também o "Smoke manual" de
  [`ELECTORAL_LIVE.md`](ELECTORAL_LIVE.md).
- **Esperado:** cartões de pesquisa com instituto, número de registro (ex.: `CE074472026`), período de
  campo, "Fonte auditada em …" e link oficial — 53 registros para Governador/CE 2026 em 13/10/2026;
  registro sem percentual continua visível sem números inventados. Painel de apuração: sem snapshot
  capturado, texto explícito de ausência (nunca zeros); com snapshot, selo `FINAL`/`PARCIAL`/`NÃO
  INICIADA`, horários "Gerado" e "Capturado" e link "Abrir JSON oficial do TSE".
- **Falha:** "Não foi possível carregar pesquisas e totalização para este recorte."; zero onde não há
  dado; percentual sem fonte; snapshot parcial exibido como `FINAL`.

## 7. Comparador

- **URL:** https://www.apprepbrasil.com.br/comparar?tipo=municipio&uf=CE&itens=2304400,2312908&periodo=2022
- **Passos:** conferir Fortaleza e Sobral em 2022; ler os insights; copiar a URL para outra aba;
  trocar o período ou incluir um terceiro município.
- **Esperado:** a outra aba reproduz exatamente o mesmo estado; ausência aparece "—"; insights iguais a
  cada recarga, com regra/metodologia e sem linguagem causal; no máximo cinco itens do mesmo tipo.
- **Falha:** erro de carregamento; zero onde o indicador não existe; insight diferente para o mesmo
  estado; mistura de tipos.

## 8. Exports (CSV, XLSX, PDF, PNG)

- **URL:** a mesma do item 7.
- **Passos:** clicar em CSV, XLSX, PDF e PNG; abrir cada arquivo (CSV e XLSX no Excel ou LibreOffice).
- **Esperado:** arquivos `repbrasil-municipios-2022.csv`, `.xlsx`, `.pdf` e `.png`. CSV com acentos
  corretos, primeira linha "REPBrasil — Comparação de municípios" e linhas `Fonte;…`,
  `Metodologia;…` e `URL reproduzível;<URL da página>`; nenhuma célula vira fórmula. XLSX abre sem
  pedido de reparo e traz o mesmo conteúdo. PDF e PNG trazem título, fontes e data.
- **Falha:** arquivo não abre, Excel pede reparo, acentos corrompidos, contexto ausente (fonte,
  metodologia, URL) ou valores alterados (ex.: ausência virando 0).

## 9. Parlamento

- **URL:** https://www.apprepbrasil.com.br/parlamento
- **Passos:** conferir os três cartões; escolher um parlamentar em "Parlamentar — atos"; abrir o link
  "documento oficial" de um ato; escolher um ano em "Ano — emendas"; passar o mouse/tocar em
  municípios do mapa.
- **Esperado (após a ingestão):** "Parlamentares do CE carregados" com os deputados federais do CE da
  57ª legislatura (34 na execução local de 13/10/2026); atos com fonte, data de coleta e link para a
  Câmara; emendas com valores publicados ou "—"; no mapa, só totais completos coloridos e municípios
  com "soma parcial: N emendas sem valor publicado" sem cor. Nenhum parlamentar aparece vinculado a
  perfil de candidato.
  **Antes da ingestão:** "Nenhum ato oficial carregado para este recorte." e "Nenhuma emenda oficial
  carregada para este recorte." — nunca "0 atos" como se fosse atividade nula.
- **Falha:** parlamentar ligado a perfil do TSE por nome; zero exibido como atividade; soma parcial
  colorida como total; link oficial quebrado; erro de carregamento.

## 10. Dados (Data Intelligence)

- **URL:** https://www.apprepbrasil.com.br/dados?x=ibge.literacy_rate_15_plus&y=ibge.population&periodo=2022
- **Passos:** conferir o resumo, o mapa socioeconômico, o gráfico de dispersão e o aviso; trocar os
  indicadores e copiar a URL para outra aba.
- **Esperado:** "Correlação não implica causalidade." visível; Pearson, Spearman e "N observado"
  (em 13/10/2026: 0,370 · 0,453 · 184); mapa do Ceará colorido pelo indicador X na malha oficial do
  IBGE; a outra aba reproduz o mesmo estado; município sem dado fica fora do gráfico e sem cor no
  mapa, nunca como zero.
- **Falha:** aviso ausente; coeficiente sem N; zero no lugar de ausência; URL não reproduz o estado.

## 11. Seção arquivada (lake em TLS)

- **URLs:** https://www.apprepbrasil.com.br/eleicoes/2022/1/ce/fortaleza/zona/1/secao/33 e
  https://www.apprepbrasil.com.br/eleicoes/2024/1/ce/fortaleza/zona/1/secao/33
- **Passos:** abrir as duas seções e trocar o cargo.
- **Esperado:** votos da urna com proveniência do Boletim de Urna (2022: Presidente com 7 linhas;
  2024: Prefeito com 8 linhas em 13/10/2026). Esses votos só existem no lake: a página prova o RPC
  privado em TLS.
- **Falha:** "indisponível" ou 503 mais de 10 minutos depois do fim do deploy de `back-v2` e
  `electoral-etl-ce2026`; votos vazios.

## 12. Celular

- **URLs:** https://www.apprepbrasil.com.br/, `/pesquisas`, `/parlamento`, `/dados`, a URL do item 7
  e a primeira URL do item 11.
- **Passos:** abrir cada uma no celular, em pé; abrir e fechar o menu; usar os seletores; arrastar e
  ampliar os mapas.
- **Esperado:** nenhuma rolagem horizontal; menu, formulários e mapas utilizáveis; texto legível.
- **Falha:** rolagem lateral, elementos sobrepostos, controles impossíveis de tocar.

## 13. PWA / offline

- **URL:** https://www.apprepbrasil.com.br/dados (no celular)
- **Passos:** com rede, abrir a página duas vezes e esperar carregar; ativar o modo avião; observar o
  topo; navegar pelo menu para `/parlamento`; recarregar ainda sem rede; desativar o modo avião e tocar
  em "Tentar novamente".
- **Esperado:** com a página aberta, aparece "Sem conexão. As informações desta página foram
  carregadas antes da queda e podem estar desatualizadas. Reconecte-se para consultar a versão
  atual."; ao navegar ou recarregar sem rede, a tela "Você está sem conexão" **sem nenhum dado
  factual**; com a rede de volta, a página real carrega e o aviso some.
- **Falha:** qualquer página factual (números, nomes, resultados) exibida sem rede depois de navegar
  ou recarregar; tela de erro do próprio navegador (worker não ativo); aviso que não aparece ou não
  some ao reconectar.

## Registro

| # | Item | Resultado | Horário | Evidência / observação |
|---|---|---|---|---|
| 1 | Login com Google | | | |
| 2 | Magic link no mesmo navegador | | | |
| 3 | Magic link em outro navegador | | | |
| 4 | Conta, favoritos e saída | | | |
| 5 | Superadmin | | | |
| 6 | Pesquisas e apuração | | | |
| 7 | Comparador | | | |
| 8 | Exports | | | |
| 9 | Parlamento | | | |
| 10 | Dados | | | |
| 11 | Seção arquivada | | | |
| 12 | Celular | | | |
| 13 | PWA / offline | | | |

Com todos os itens OK, o Elias atualiza os status correspondentes para `DONE` em
[`CEARA_PRODUCT_COMPLETION.md`](CEARA_PRODUCT_COMPLETION.md). Uma falha de segurança (itens 3 e 5)
bloqueia o selo Ceará até a correção.
