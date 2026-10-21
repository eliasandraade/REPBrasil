# PR H — Conta, favoritos, watchlist, alertas e API comercial

## Objetivo

Adicionar identidade e recursos pessoais ao REPBrasil sem transformar dados públicos em conteúdo fechado e sem introduzir serviço SaaS pago obrigatório.

## Autenticação

- Google OAuth/OIDC direto com o Google.
- Magic link por e-mail, enviado pela API HTTPS do Resend (ver "Entrega do magic link").
- Nenhuma senha local.
- Sessão aleatória em cookie `HttpOnly`; somente SHA-256 do token fica no Postgres.
- `SameSite=Lax` é o padrão para frontend/API no mesmo site; deployments cross-site usam `Auth__CookieSameSite=None`, sempre com `Secure`.
- Mutações autenticadas exigem `X-RepBrasil-CSRF`, cujo valor é vinculado à sessão.
- Magic links e `state` do Google são one-shot, expiram e são persistidos somente por hash.
- O `state` OAuth também é vinculado ao navegador que iniciou o login por um cookie de correlação `HttpOnly`; o callback exige correspondência e apaga o cookie antes de prosseguir.
- O magic link é vinculado da mesma forma ao navegador que o pediu (`repbrasil_magic_link`, `HttpOnly`, `SameSite=Lax`, caminho `/api/v1/auth/magic-link`): aberto em outro navegador, em outro aplicativo ou depois de pedido um link mais novo, ele falha fechado com `/entrar?erro=link-invalido`, sem consumir o desafio.
- Links usados, expirados ou recusados sempre voltam para `/entrar?erro=...`, que explica o motivo (`link-invalido`, `estado-invalido`, `google-cancelado`, `google-falhou`, `google-indisponivel`).
- `returnTo` aceita apenas caminho local iniciado por uma única `/`, sem `\` e sem caracteres de controle; `//`, `/\` e URLs externas voltam para `/`.
- `Auth__MagicLink__Delivery=log` (link no log) só funciona em `Development`; em qualquer outro ambiente o pedido é recusado com 503, porque o link é uma credencial de login.

## Entrega do magic link

- Fora de desenvolvimento, a única entrega é `Auth__MagicLink__Delivery=resend`: `POST https://api.resend.com/emails` (HTTPS, porta 443) com a chave da API no cabeçalho `Authorization`. Não há SMTP no fluxo: o Railway bloqueia SMTP de saída fora do plano Pro, e foi isso que travou o login por e-mail no smoke humano de 20/10/2026 (conexões a `smtp.resend.com:587` descartadas, pedido preso por até 269 s).
- O envio tem prazo próprio de 10 s (`Auth__MagicLink__TimeoutSeconds`, de 1 a 15; valor ilegível usa 10 s, com aviso no log). Ao fim do prazo a chamada ao provedor é cancelada.
- Tempo esgotado, falha de rede ou resposta de erro do Resend terminam em **503** ("O login por e-mail está temporariamente indisponível."). A mesma resposta vale para entrega ausente, não suportada (inclusive o antigo `smtp`) ou sem chave/remetente.
- Na recusa (erro HTTP, rede, configuração) o cookie de correlação é apagado. No tempo esgotado ele é mantido: o Resend pode ter aceitado o e-mail sem responder a tempo, e o link precisa continuar válido neste navegador.
- Chave e remetente são lidos sem espaços ou quebras de linha nas pontas. O cliente HTTP do Resend redige o cabeçalho `Authorization` nos logs do `HttpClient`.
- Se o próprio pedido for cancelado (o navegador desistiu), o cancelamento é propagado e não vira 503.
- O frontend aborta o pedido em 20 s, mais que o prazo da API para o 503 chegar antes. A tela sempre sai de "Enviando…": confirmação em caso de sucesso, mensagem de indisponibilidade em caso de falha.
- Logs do envio: só provedor, motivo (`timeout`, `network`, `http_status`), status HTTP, código de erro do Resend (ex.: `validation_error`; a mensagem de erro, que pode citar o destinatário, é descartada) e duração. Nunca e-mail (destinatário ou remetente), token, link ou chave; configuração ausente é registrada só pelo nome da variável.
- O remetente precisa ser de um domínio verificado no Resend.

## Variáveis do backend

```text
AllowedOrigins=https://SEU_FRONTEND
Auth__FrontendBaseUrl=https://SEU_FRONTEND
Auth__PublicBaseUrl=https://SEU_BACKEND
Auth__CookieDomain=.seudominio.com.br            # opcional
Auth__CookieSameSite=Lax                         # use None quando frontend/API forem cross-site
Auth__Google__ClientId=...
Auth__Google__ClientSecret=...
Auth__Google__RedirectUri=https://SEU_BACKEND/api/v1/auth/google/callback
Auth__MagicLink__Delivery=resend                  # `log` somente em desenvolvimento
Auth__MagicLink__Resend__ApiKey=...               # segredo: chave da API do Resend
Auth__MagicLink__From=REPBrasil <acesso@SEU_DOMINIO>  # remetente de domínio verificado no Resend
Auth__MagicLink__TimeoutSeconds=10                # opcional: prazo do envio, de 1 a 15 s
Auth__SuperadminEmails=pessoa@exemplo.com          # lista separada por vírgulas
Alerts__PublishToken=...
Alerts__Publisher__Enabled=true                    # opcional: publicador de alertas (padrão: ligado)
Alerts__Publisher__IntervalSeconds=300             # opcional: intervalo entre ciclos, de 30 a 86400 s
Alerts__Publisher__InitialDelaySeconds=60          # opcional: espera antes do primeiro ciclo
```

As antigas `Auth__MagicLink__Smtp__*` não são mais lidas e podem ser removidas depois do deploy.

O frontend continua usando `NEXT_PUBLIC_API_URL` e envia `credentials: include` apenas nos endpoints de conta. Se frontend e API forem cross-site, `AllowedOrigins` precisa conter a origem exata do frontend e `Auth__CookieSameSite=None` deve ser configurado no backend.

## Dados pessoais

Schema `account`:

- `user_account`: identidade mínima da conta e perfil (nome, nome de exibição, UF, município, tipo de uso, preferência de avatar);
- `identity`: provedores `magic_link` e `google`;
- `login_challenge`: desafios temporários por hash;
- `session`: sessões revogáveis;
- `saved_item`: `favorite` ou `watchlist` com referência lógica, sem FK para as fontes oficiais;
- `alert_subscription`: recurso + evento + canal;
- `notification`: caixa de entrada idempotente por `event_key`/usuário;
- `entitlement`: capacidade concedida, sem preço hard-coded;
- `api_key`: chave comercial por hash, prefixo visível, scopes, quota e revogação;
- `api_usage_daily`: contador diário por chave;
- `subscription`: vínculo da conta com um plano pago (`manual` enquanto não houver cobrança online), status e fim do período;
- `alert_edition`: edições oficiais já vistas pelo publicador de alertas (uma linha por edição, com o instante em que apareceu);
- `alert_publisher_state`: marca a linha de base do publicador (primeiro ciclo).

O perfil nunca coleta CPF, partido, candidato, ideologia, religião ou intenção de voto. UF e município servem só à personalização territorial; o tipo de uso (eleitor, estudante/pesquisador, jornalista, assessor político, profissional do setor público, outro) é opcional.

Favoritos/watchlist usam `resource_type + resource_key` para não acoplar a conta à modelagem interna do TSE/IBGE. Rotas filtradas e drill-downs eleitorais preservam o caminho/query reproduzível na identidade salva. As entidades oficiais continuam sendo a fonte de verdade.

## Alertas

Só existem os alertas que o sistema sabe disparar (`AlertCatalog`, listado em `GET /api/v1/account/alert-kinds`). Cada tipo tem um produtor que observa uma tabela de edições oficiais:

| Recurso | Evento | Chave | Dispara quando |
|---|---|---|---|
| `indicator` | `new_edition` | código do indicador (`ibge.population`) | uma nova fonte do indicador é gravada em `socioeconomic_source` |
| `state` | `amendments_update` | UF (`CE`) | uma nova versão da base oficial de emendas da UF é gravada em `parliament_source` (UF de `metadata.uf`) |
| `election` | `polls_update` | `ano:cargo:UF` ou `ano:cargo:BR` | uma fonte de pesquisas traz registro que nenhuma fonte anterior tinha para o escopo |
| `election` | `live_count_update` | `ano:cargo:UF` ou `ano:cargo:BR` | a totalização oficial começa, passa de 25%, 50% e 75% das seções e termina |
| `municipality` | `live_count_update` | código IBGE (7 dígitos) | o mesmo, para a apuração do município |

O publicador (`DataEditionAlertPublisher`) roda dentro da API em intervalo fixo. A cada ciclo:
1. registra as edições novas em `account.alert_edition`, uma vez por edição (chave estável, ex.: `socioeconomic_source:<id>`);
2. entrega cada edição a quem **já assinava** quando ela apareceu (assinar hoje não traz aviso de edição antiga), no máximo uma vez por pessoa;
3. não entrega a conta suspensa.

No primeiro ciclo de todos (`account.alert_publisher_state` vazio), o histórico existente vira linha de base, sem aviso: ligar o publicador depois do deploy não dispara notificações de edições antigas.

Uma trava consultiva no banco garante um só publicador por vez. Falha num ciclo vai para o log e espera o próximo; valor malformado nas variáveis `Alerts__Publisher__*` vira o padrão com aviso no log. Nada disso derruba a API.

Os links das notificações abrem o recorte certo: `/parlamento?uf=`, `/pesquisas?ano=&turno=&cargo=&uf=` (`uf=BR` é o Brasil) e `/dados?x=&periodo=`; essas páginas guardam o recorte na URL.

O endpoint interno continua disponível para rotinas auditáveis externas:

`POST /api/v1/internal/alerts/publish` (cabeçalho obrigatório: `X-Alerts-Token`)

Ele recebe `eventKey`, recurso, tipo de evento, título e payload, e cria no máximo uma notificação por `eventKey`/usuário. Não inventa fatos: só distribui um evento já produzido.

A entrega é na conta (`in_app`). **O envio de alertas por e-mail não existe**, então assinatura nova com `delivery = email` é recusada com mensagem explicativa (as antigas continuam recebendo na conta).

## Planos

O catálogo de planos, capabilities e limites é código (`PlanCatalog`) e é servido em `GET /api/v1/plans`, junto com a base pública (o que é de todos, em qualquer plano) e a disponibilidade do pagamento online. O frontend nunca decide acesso sozinho: lê `capabilities` e `limits` de `GET /api/v1/account/me`.

| Capability | Gratuito | Avançado | Profissional |
|---|---|---|---|
| `limit.favorites` | 10 | 200 | 1000 |
| `limit.watchlist` | 5 | 100 | 500 |
| `limit.alerts` | 3 | 50 | 200 |
| `account.saved_folders` | — | — | ✓ |
| `limit.compare_candidacies` | 5 | 5 | 10 |
| `map.advanced_modes` (relevo 3D, intensidade, antes/depois) | — | ✓ | ✓ |
| `data.map_series` (linha do tempo do mapa numa consulta) | — | ✓ | ✓ |
| `data.correlation_matrix` (todos os pares da UF de uma vez) | — | ✓ | ✓ |
| `data.export_csv` (CSV do recorte, com proveniência por linha) | — | ✓ | ✓ |
| `data.export_bulk` (todos os indicadores da UF em CSV) | — | — | ✓ |

Preços mensais: Gratuito R$ 0; Avançado R$ 24,90 (recomendado); Profissional R$ 69,90. Não há plano anual.

Consulta, mapas, fontes, metodologia, proveniência e data de atualização nunca são pagos: o dado público essencial não fica atrás de paywall. No explorador territorial (`/dados`), o mapa, a tabela, cada valor, cada ano, cada par de indicadores (`/data/correlation`) e os agrupamentos são de todos. O plano acrescenta conveniência e profundidade: a série inteira numa consulta, a matriz de uma vez, as exportações e os modos avançados do mapa (`docs/DADOS_EXPLORADOR.md`).

Rotas do plano no explorador, todas com `401` sem sessão, `403 plan_required` com o plano mínimo e sem cache compartilhado (`Cache-Control: private, no-store`):

| Rota | Capability |
|---|---|
| `GET /api/v1/data/correlation-matrix?uf=&period=` | `data.correlation_matrix` |
| `GET /api/v1/data/export?indicator=&uf=&period=` | `data.export_csv` |
| `GET /api/v1/data/export/bulk?uf=&period=` | `data.export_bulk` |
| `GET /api/v1/parliament/amendments/map-series?uf=` | `data.map_series` |

`map.advanced_modes` é decidido na interface: os modos desenham dado que a API já entrega a todos.

### Plano efetivo

O plano efetivo é o maior entre:
- Gratuito;
- a assinatura viva: `active`/`past_due` dentro do período, ou `canceled` até o fim do período pago (`expired` nunca conta);
- o entitlement `plan` (concessão manual);
- Profissional para Super Admin.

`/account/me` informa também a origem (`planSource`: `default`, `subscription`, `manual` ou `role`).

### Limites

Item novo além do limite responde `403 {"error":"plan_limit_reached","limit":…,"max":…,"requiredPlan":…}`. Recurso fora do plano responde `403 {"error":"plan_required","capability":…,"requiredPlan":…}`. Sem sessão, `401`.

A contagem é feita com a conta travada até o fim da transação, então pedidos simultâneos não passam juntos do limite. Itens que já existem nunca são apagados quando o limite diminui; só a criação de itens novos para.

A comparação acima de 5 candidaturas usa `GET /api/v1/elections/compare/extended` (sessão + limite do plano). A resposta depende da conta e nunca passa pelo cache compartilhado. O teste de contrato `Protected_actions_never_use_the_shared_output_cache` impede que uma ação protegida ganhe cache compartilhado.

## Cobrança

Não há provedor de pagamento contratado. A implementação atual de `IBillingProvider` é `NoBillingProvider`:
- `POST /api/v1/billing/checkout` responde `503 billing_unavailable`;
- nada é cobrado nem simulado;
- a interface mostra "Pagamento online ainda não disponível".

Assinaturas existem como registro `manual` (ex.: concessão do Super Admin). Nenhum dado de cartão passa pelo REPBrasil nem é guardado.

Para ativar a cobrança, é preciso:
1. contratar um provedor;
2. implementar o `IBillingProvider` dele (checkout + webhook que grava `account.subscription`);
3. configurar os segredos do provedor no backend.

## Entitlements

Entitlements são pares `key/value` temporais (`starts_at`/`expires_at`). Chaves reconhecidas:

- `plan = ADVANCED | PROFESSIONAL`: plano manual;
- `account.role = superadmin`: papel de Super Admin;
- uma capability do catálogo (ex.: `account.saved_folders = true|false`, `limit.favorites = 500`): sobrepõe o plano para a conta; havendo mais de uma para a mesma chave, vale a de início mais recente;
- `api.daily_quota = 10000`: quota da API comercial legada.

Chaves fora dessa lista são ignoradas pela resolução de acesso.

Na ausência desse entitlement, a quota técnica padrão é de 1000 requisições/dia. A quota é **da conta**: o uso diário de todas as chaves do usuário é somado, então criar ou rotacionar chaves não multiplica a cota. Alterar quota comercial é operação administrativa explícita, não conclusão do produto.

## Super Admin

O papel é decidido no servidor, pela mesma resolução de acesso dos planos (`AccountAccessService`): a conta precisa estar em `Auth:SuperadminEmails` (configuração, não editável pela interface) ou ter o entitlement ativo `account.role = superadmin`. Toda rota `/api/v1/admin/*` passa pelo filtro `[SuperAdmin]`: sem sessão → 401; sessão sem CSRF em escrita → 401; conta comum → 403 (`{"error":"forbidden"}`). Nada no estado da conta comum concede o papel.

Rotas (escrita só por POST/DELETE, que o CORS do site libera):

| Rota | Função |
|---|---|
| `GET /admin/me` | identidade do Super Admin |
| `GET /admin/overview` | diagnóstico: API (ambiente, revisão, uptime, última migration), banco (latência, versão), migrations pendentes, lake e frontend quando configurados, frescor das bases oficiais, visões derivadas, ingestões recentes (erros mascarados), contas, assinaturas, alertas, suporte e métricas HTTP por rota desde o início do processo |
| `GET /admin/users` | busca por e-mail/nome, filtros de plano, papel e status, ordenação e paginação (até 5.000 contas por consulta) |
| `GET /admin/users/{id}` | perfil, acesso efetivo, concessões, assinaturas, uso e histórico administrativo |
| `POST /admin/users/{id}/suspend` · `/reactivate` | suspende (encerra sessões e recusa login por qualquer provedor) ou reativa |
| `POST /admin/users/{id}/role` | `user` ou `superadmin` (o da configuração não muda pela interface) |
| `POST /admin/users/{id}/plan` | plano manual com validade opcional; `FREE` remove a concessão |
| `POST /admin/users/{id}/entitlements` · `DELETE …/{key}` | concede ou revoga capability do catálogo (ou `api.daily_quota`) |
| `POST /admin/users/{id}/subscription` | cria ou corrige a assinatura manual |
| `GET /admin/subscriptions` · `GET /admin/audit` | assinaturas e trilha de auditoria |
| `GET /admin/support` · `POST /admin/support/{id}/status` | caixa de suporte |
| `GET /admin/openapi` | documento OpenAPI gerado do código (com `x-repbrasil-access` por rota) e métricas por rota |

Regras:
- toda alteração grava `account.admin_audit_log` (quem, ação, alvo, antes, depois, contexto, quando) na mesma transação; a tabela é só de inserção (gatilho recusa UPDATE/DELETE) e não guarda segredo;
- ninguém suspende nem rebaixa a própria conta; uma trava única impede zerar os Super Admins capazes de entrar;
- conta suspensa não entra por nenhum provedor, e um login novo não cria conta duplicada para o mesmo e-mail (`/entrar?erro=conta-suspensa`);
- nenhuma resposta leva cadeia de conexão, token, chave ou variável sensível.

O documento OpenAPI é sempre gerado (com os comentários XML); a interface pública do Swagger (`/swagger`) continua só em desenvolvimento ou com `Swagger:Enabled`. A sonda do frontend no diagnóstico pode ser desligada com `Admin__Diagnostics__ProbeFrontend=false`.

Interface: `/admin` (visão geral, contas, detalhe com ações confirmadas, assinaturas, auditoria, API, suporte), `noindex`, com guarda no servidor.

## Suporte

`POST /api/v1/support/requests` grava o pedido (`account.support_request`): categoria (dúvida, contestação, correção de dado, institucional, erro técnico, conta), e-mail para a resposta, nome/organização/assunto/fonte opcionais e a mensagem (30–5.000 caracteres). Com sessão, o pedido fica ligado à conta. O IP não é guardado, só o hash do prefixo. Limite técnico por origem: `RateLimit__SupportPerHour` (padrão 6/h). A página `/suporte` mostra o protocolo devolvido; não há confirmação sem gravação.

## API comercial

Chaves têm formato `rep_live_...`. O segredo completo aparece uma única vez no frontend; o servidor persiste somente SHA-256 e um prefixo para identificação.

Scopes iniciais:

- `read:public`
- `read:account`

O primeiro gate é `GET /api/v1/commercial/ping`, que valida chave, scope, expiração/revogação e quota diária antes de responder:

| Situação | Resposta |
|---|---|
| chave válida, com scope e quota | 200 |
| chave ausente, desconhecida, revogada, expirada ou de conta desativada | 401 `invalid_api_key` |
| chave sem o scope exigido | 403 `insufficient_scope` |
| quota diária da conta esgotada | 429 `daily_quota_exhausted` |

O contrato público reafirma:

- ausência de dado não é zero;
- proveniência é obrigatória;
- fatos eleitorais sintéticos são proibidos.

Novos endpoints comerciais devem entrar atrás do mesmo gate, sem criar uma segunda fonte de verdade.

## UX

- `/entrar`: Google ou magic link.
- `/conta`: hub autenticado, uma rota por seção (link direto):
  - `/conta` (visão geral: plano e uso, território, notificações recentes);
  - `/conta/perfil`, `/conta/plano`, `/conta/favoritos`, `/conta/watchlist`, `/conta/alertas`, `/conta/notificacoes`;
  - `/conta/seguranca` (sessão, saída e o acesso programático legado, recolhido).
  Sem sessão, qualquer seção volta a `/entrar?returnTo=<seção>`.
- `/planos`: comparação lida de `GET /api/v1/plans`, com a base pública gratuita e o estado real da cobrança.
- Dock global: login/conta e ações contextuais de favorito/watchlist em políticos, partidos, municípios, estados, eleições, rankings e dados. O limite do plano aparece como mensagem com caminho para `/planos`.

O frontend lê a sessão em `GET /api/v1/account/session` (200 `{"authenticated":false}` sem sessão, para a checagem de toda página não virar erro no console). `GET /api/v1/account/me` continua respondendo 401 sem sessão; se o frontend for publicado antes da API, ele usa `/account/me` enquanto `/account/session` não existir. Um único hook (`useAccount`) guarda a conta no cliente; recursos e limites vêm sempre da API.

O conteúdo público existente continua navegável sem autenticação.

## Segurança / privacidade

- e-mail é normalizado em lowercase;
- nenhum token de sessão, magic link ou API key é armazenado em claro;
- API key é exibida apenas na criação;
- cookie de sessão é `Secure` fora do ambiente de desenvolvimento; `SameSite=None` também força `Secure`;
- Google só entra se `email_verified=true`;
- OAuth state é validado no banco e contra cookie de correlação do navegador;
- CORS de conta aceita credenciais somente para `AllowedOrigins` explícitos;
- endpoint de publicação de alertas responde 404 quando o segredo interno não confere;
- `returnTo` não permite open redirect;
- logins simultâneos que colidem na transação `Serializable` (SQLSTATE 40001) são repetidos (até 4 tentativas) em vez de virar 503; o desafio só é consumido na tentativa que conclui.

## Smoke após deploy

1. aplicar migration `AddAccountsAndCommercialApi`;
2. entrar por Google e confirmar retorno ao caminho original;
3. copiar um callback OAuth iniciado em outro navegador e confirmar rejeição por correlação inválida;
4. entrar por magic link; reabrir o mesmo link e abri-lo em outro navegador → `/entrar` explica "link inválido" (nunca erro 500);
5. `/account/me` sem cookie → 401;
6. mutação sem CSRF → 401; com CSRF → sucesso;
7. em deployment cross-site, confirmar `SameSite=None; Secure` e chamadas `credentials: include` funcionando;
8. favoritar e adicionar à watchlist uma página; recarregar e validar persistência;
9. salvar duas variantes filtradas de `/rankings`, `/dados` ou drill-down eleitoral e confirmar itens distintos;
10. criar chave de API, copiar segredo e validar `/api/v1/commercial/ping` (200);
11. repetir até a quota configurada em ambiente de teste e confirmar 429, inclusive com outra chave da mesma conta;
12. revogar a chave e confirmar 401;
13. publicar duas vezes o mesmo `eventKey` e confirmar uma única notificação por usuário;
14. desktop/mobile e light/dark em `/entrar`, `/conta` e dock global;
15. Console/Network sem 500 inesperado e sem token em URL depois do callback.

## Testes automatizados

- `backend/tests/RepBrasil.Tests/Api/AccountSecurityTests.cs` (sem banco): `returnTo`, comparação em tempo constante, link nunca no log fora de desenvolvimento.
- `backend/tests/RepBrasil.Tests/Api/MagicLinkCorrelationTests.cs` (sem banco): link sem correlação falha antes de tocar o banco.
- `backend/tests/RepBrasil.Tests/Api/AccountFlowTests.cs` (banco de teste do CI, Google simulado por stub HTTP, nenhum e-mail enviado): magic link só no navegador que pediu e uma única vez, cookies `HttpOnly`/`Secure`/`SameSite=Lax`, só hashes no banco, CSRF da própria sessão, logout revoga, `state` do Google ligado ao navegador e one-shot, `email_verified` obrigatório, superadmin 401/403/200, quota somada entre chaves (200/429), chave revogada/desconhecida 401, scope 403, publicação de alertas com token interno e idempotente.
- `backend/tests/RepBrasil.Tests/Api/PlanCatalogTests.cs` (sem banco): catálogo e preços, plano maior contém o menor, resolução do plano efetivo (assinatura viva, cancelada no período, vencida, manual, Super Admin), concessões e expirações, catálogo de alertas, ação protegida sem cache compartilhado.
- `backend/tests/RepBrasil.Tests/Api/AccountFlowPlansTests.cs` (banco de teste): `/account/me` com plano e limites decididos no servidor, catálogo público e checkout 503 sem cobrança, perfil validado e persistido (e mantido após login Google), limites de favoritos/watchlist com concorrência e sem apagar itens, pastas só no Profissional, alertas do catálogo com limite, comparação ampliada 401/403/404 sem cache compartilhado, catálogo territorial.
- `backend/tests/RepBrasil.Tests/Api/AccountFlowAlertPublisherTests.cs` (banco de teste): edição nova notifica uma vez quem já assinava; quem assina depois e conta suspensa não recebem; emendas pela UF da ingestão.
- `backend/tests/RepBrasil.Tests/Api/AccountFlowAdminTests.cs` (banco de teste): RBAC 401/403/200 e sem segredo no diagnóstico; suspensão que encerra sessões e recusa login sem criar conta; último Super Admin protegido mesmo contra admin concorrente; plano, concessões, assinatura e papel refletidos no acesso e na auditoria (que recusa UPDATE); suporte gravado, limitado e triado; catálogo OpenAPI só para Super Admin, com a regra de acesso de cada rota.
- `backend/tests/RepBrasil.Tests/Api/AdminUnitTests.cs` (sem banco): regra de acesso do catálogo lida dos atributos, mascaramento de erros de ingestão, métricas por rota.
- `backend/tests/RepBrasil.Tests/Api/AccountFlowDataToolsTests.cs` (banco de teste, UF fictícia própria): cobertura por UF diz só o que está carregado; matriz, exportações e série do mapa com 401/403/200 pelo plano, CSV com proveniência e sem cache compartilhado.
- `backend/tests/RepBrasil.Tests/DataIntelligence/DataExplorerUnitTests.cs` (sem banco): cobertura, matriz por pares (ausência fora do N), formato do CSV e proteção contra fórmula.
- `frontend/tests/admin.test.tsx`: guarda do `/admin` (401/403), ação confirmada com CSRF, recusa do último Super Admin, catálogo da API e `/suporte` real (protocolo, 429, FAQ acessível).
- `frontend/tests/account-signin.test.tsx`: mensagens de `/entrar?erro=...` e destino local após o login.
