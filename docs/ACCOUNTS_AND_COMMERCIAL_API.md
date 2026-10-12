# PR H — Conta, favoritos, watchlist, alertas e API comercial

## Objetivo

Adicionar identidade e recursos pessoais ao REPBrasil sem transformar dados públicos em conteúdo fechado e sem introduzir serviço SaaS pago obrigatório.

## Autenticação

- Google OAuth/OIDC direto com o Google.
- Magic link por SMTP configurável.
- Nenhuma senha local.
- Sessão aleatória em cookie `HttpOnly`; somente SHA-256 do token fica no Postgres.
- `SameSite=Lax` é o padrão para frontend/API no mesmo site; deployments cross-site usam `Auth__CookieSameSite=None`, sempre com `Secure`.
- Mutações autenticadas exigem `X-RepBrasil-CSRF`, cujo valor é vinculado à sessão.
- Magic links e `state` do Google são one-shot, expiram e são persistidos somente por hash.
- O `state` OAuth também é vinculado ao navegador que iniciou o login por um cookie de correlação `HttpOnly`; o callback exige correspondência e apaga o cookie antes de prosseguir.
- `returnTo` aceita apenas caminho local iniciado por `/`; `//` e URLs externas voltam para `/`.

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
Auth__MagicLink__Delivery=smtp                    # `log` somente em desenvolvimento
Auth__MagicLink__Smtp__Host=...
Auth__MagicLink__Smtp__Port=587
Auth__MagicLink__Smtp__EnableSsl=true
Auth__MagicLink__Smtp__From=...
Auth__MagicLink__Smtp__Username=...               # opcional, conforme relay
Auth__MagicLink__Smtp__Password=...               # opcional, conforme relay
Alerts__PublishToken=...
```

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

Entrega `in_app` é nativa. O campo `email` já faz parte do contrato de assinatura; o envio assíncrono de notificações por e-mail deve usar a mesma infraestrutura SMTP e não altera o fato armazenado.

## Entitlements

Entitlements são pares `key/value` temporais. Não há tabela de preços, nome de plano ou inferência de cobrança no código.

Exemplo operacional:

- `api.daily_quota = 10000`

Na ausência desse entitlement, uma nova chave recebe quota técnica padrão de 1000 requisições/dia. Alterar quota comercial é operação administrativa explícita, não conclusão do produto.

## API comercial

Chaves têm formato `rep_live_...`. O segredo completo aparece uma única vez no frontend; o servidor persiste somente SHA-256 e um prefixo para identificação.

Scopes iniciais:

- `read:public`
- `read:account`

O primeiro gate é `GET /api/v1/commercial/ping`, que valida chave, scope, expiração/revogação e quota diária antes de responder. O contrato público reafirma:

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
4. entrar por magic link e confirmar expiração/one-shot;
5. `/account/me` sem cookie → 401;
6. mutação sem CSRF → 401; com CSRF → sucesso;
7. em deployment cross-site, confirmar `SameSite=None; Secure` e chamadas `credentials: include` funcionando;
8. favoritar e adicionar à watchlist uma página; recarregar e validar persistência;
9. salvar duas variantes filtradas de `/rankings`, `/dados` ou drill-down eleitoral e confirmar itens distintos;
10. criar chave de API, copiar segredo e validar `/api/v1/commercial/ping`;
11. repetir até a quota configurada em ambiente de teste e confirmar bloqueio sem contador negativo;
12. revogar a chave e confirmar recusa;
13. publicar duas vezes o mesmo `eventKey` e confirmar uma única notificação por usuário;
14. desktop/mobile e light/dark em `/entrar`, `/conta` e dock global;
15. Console/Network sem 500 inesperado e sem token em URL depois do callback.
