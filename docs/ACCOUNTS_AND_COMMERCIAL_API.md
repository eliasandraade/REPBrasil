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
- O envio tem prazo próprio de 10 s (`Auth__MagicLink__TimeoutSeconds`, de 1 a 30). Ao fim do prazo a chamada ao provedor é cancelada.
- Tempo esgotado, falha de rede ou resposta de erro do Resend terminam em **503** ("O login por e-mail está temporariamente indisponível."), e o cookie de correlação é apagado. A mesma resposta vale para entrega ausente, não suportada (inclusive o antigo `smtp`) ou sem chave/remetente.
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
Auth__MagicLink__TimeoutSeconds=10                # opcional: prazo do envio, de 1 a 30 s
Auth__SuperadminEmails=pessoa@exemplo.com          # lista separada por vírgulas
Alerts__PublishToken=...
```

As antigas `Auth__MagicLink__Smtp__*` não são mais lidas e podem ser removidas depois do deploy.

O frontend continua usando `NEXT_PUBLIC_API_URL` e envia `credentials: include` apenas nos endpoints de conta. Se frontend e API forem cross-site, `AllowedOrigins` precisa conter a origem exata do frontend e `Auth__CookieSameSite=None` deve ser configurado no backend.

## Dados pessoais

Schema `account`:

- `user_account`: identidade mínima da conta;
- `identity`: provedores `magic_link` e `google`;
- `login_challenge`: desafios temporários por hash;
- `session`: sessões revogáveis;
- `saved_item`: `favorite` ou `watchlist` com referência lógica, sem FK para as fontes oficiais;
- `alert_subscription`: recurso + evento + canal;
- `notification`: caixa de entrada idempotente por `event_key`/usuário;
- `entitlement`: capacidade concedida, sem preço hard-coded;
- `api_key`: chave comercial por hash, prefixo visível, scopes, quota e revogação;
- `api_usage_daily`: contador diário por chave.

Favoritos/watchlist usam `resource_type + resource_key` para não acoplar a conta à modelagem interna do TSE/IBGE. Rotas filtradas e drill-downs eleitorais preservam o caminho/query reproduzível na identidade salva. As entidades oficiais continuam sendo a fonte de verdade.

## Alertas

O produto permite inscrição em eventos determinísticos. A emissão é separada da apresentação:

`POST /api/v1/internal/alerts/publish`

Cabeçalho obrigatório: `X-Alerts-Token`.

O publicador fornece `eventKey`, recurso, tipo de evento, título e payload. O banco cria no máximo uma notificação por `eventKey`/usuário. O endpoint interno não inventa fatos: ele somente distribui um evento já produzido por uma rotina auditável.

Entrega `in_app` é nativa. O campo `email` já faz parte do contrato de assinatura, mas **o envio de notificações por e-mail ainda não está implementado**: assinaturas `email` são guardadas e as notificações aparecem na caixa `in_app`. Quando existir, o envio usará a mesma integração HTTPS de e-mail do magic link e não alterará o fato armazenado.

## Entitlements

Entitlements são pares `key/value` temporais. Não há tabela de preços, nome de plano ou inferência de cobrança no código.

Exemplo operacional:

- `api.daily_quota = 10000`

Na ausência desse entitlement, a quota técnica padrão é de 1000 requisições/dia. A quota é **da conta**: o uso diário de todas as chaves do usuário é somado, então criar ou rotacionar chaves não multiplica a cota. Alterar quota comercial é operação administrativa explícita, não conclusão do produto.

## Superadmin

`GET /api/v1/admin/me` decide no servidor: a conta precisa estar em `Auth:SuperadminEmails` ou ter o entitlement ativo `account.role = superadmin`. Sem sessão → 401; sessão de conta comum → 403 (`{"error":"forbidden"}`); superadmin → 200 com `role: "superadmin"`. Nada no estado da conta comum concede o papel.

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

- `/entrar`: Google ou magic link;
- `/conta`: favoritos, watchlist, alertas, notificações, entitlements e chaves de API;
- dock global: login/conta e ações contextuais de favorito/watchlist em políticos, partidos, municípios, estados, eleições, rankings e dados.

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
- `returnTo` não permite open redirect.

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
- `frontend/tests/account-signin.test.tsx`: mensagens de `/entrar?erro=...` e destino local após o login.
