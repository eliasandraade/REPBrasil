# Rodada de evolução — inteligência política, territorial e conta (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** levar o REPBrasil de portal de dados a produto de inteligência política e territorial em cinco frentes: UX de dados, experiência territorial (mapa), motion, conta/monetização e administração. Cada frente deve terminar implementada, testada e validada, sem dado ou função cenográfica.

**Architecture:**
- **Backend .NET 8:** é a autoridade de autorização.
  - O catálogo de planos e capabilities, a resolução do entitlement efetivo e o RBAC de Super Admin ficam centralizados no backend.
  - O frontend lê esse catálogo pela API e só faz UX.
- **`/dados`:** vira um explorador territorial (Brasil → UF → município) com o mapa MapLibre como protagonista.
  - Modos Socioeconômico, Eleitoral e Emendas, sobre APIs reais.
  - A disponibilidade do recorte vem dos próprios dados.
- **Motion:** estende `src/motion` (tokens, CSS, View Transitions, WAAPI), sem nova biblioteca de animação.

**Tech Stack:** .NET 8 + ADO.NET/EF Core + PostgreSQL 18/PostGIS 3.6 · Next.js 15 / React 19 / TypeScript / Tailwind / TanStack Query · MapLibre GL 6.13 · Vitest · xUnit · Playwright (validação local).

**Execução:** inline nesta sessão (`superpowers:executing-plans`), com checkpoints por PR. O usuário pediu autonomia total, então não há pausa para escolha de preferência. Merge e deploy ficam fora deste plano: dependem de autorização expressa.

---

## 0. Auditoria (o que orienta o plano)

Auditoria feita em 20/10/2026 sobre a `main` `8a4cf68`, em três frentes (frontend, backend, mapa/motion/dados).

### Frontend

- **Rotas:** 23. Sem `loading.tsx` nem `global-error.tsx`.
- **Navegação:** desktop e mobile são iguais (mesmo `Sidebar`). Problemas:
  - **Conta/Entrar** não estão na navegação; só aparecem numa pílula flutuante que refaz `/account/me` a cada rota.
  - **`/parlamento`** não está na navegação (só há um botão em `/dados`) e falta no sitemap.
  - **Nenhum link de admin.**
- **Honestidade:**
  - O formulário de `/suporte` não envia nada, mas diz "Solicitação recebida".
  - O perfil mostra falha de API como ausência ("Nenhuma declaração de bens", "Fontes serão vinculadas").
  - "Fontes vinculadas" lista todas as fontes do sistema.
  - Há selos sem lastro ("Triagem em 24h").
- **Conta pela metade:** alertas não podem ser criados nem removidos; notificações não podem ser marcadas como lidas; ações sem tratamento de erro; títulos em inglês.
- **Acessibilidade:**
  - Sem skip link.
  - `<nav>` sem rótulo.
  - Drawer móvel não modal (o Tab escapa para trás).
  - Contrastes reprovados: `bg-accent text-white` ≈ 2,4:1; `text-accent-contrast` inexistente; `red/emerald/amber-500` crus.
  - Rótulos ausentes em `/politicos`.
- **Estado na URL:** `/pesquisas` e `/parlamento` não guardam estado. `SearchInput` perde filtros. `/dados` refaz o catálogo a cada mudança de URL.
- **Recortes fixos:** CE e 2026 fixos no frontend (`/dados`, `/parlamento`, `/pesquisas`, partidos, rankings, comparador).

### Backend

- **Autorização:** sem middleware de autenticação; cada ação valida o cookie. Superadmin vem de `Auth:SuperadminEmails` ou do entitlement `account.role = superadmin`. Só existe `GET /admin/me`.
- **Esquema `account`:** em SQL bruto (sem entidades EF).
  - `entitlement(key, value, source, starts_at, expires_at)` existe, mas não há código que grave nela.
  - `disabled_at` existe, mas nada o define.
- **Sem conceito de plano e sem billing.**
- **Alertas:** o endpoint de publicação existe, mas nenhum produtor o chama.
- **OpenAPI:** Swashbuckle, mas o gerador só é registrado quando o Swagger está ligado (desligado em produção). Sem comentários XML nem esquemas de segurança.
- **CORS:** só GET/POST/DELETE/OPTIONS, então mutações de admin usam POST/DELETE.
- **CI:** `dotnet format --verify-no-changes`, `TreatWarningsAsErrors` e migrations zero → up → down (`AddMandate`) → up.

### Mapa, dados e motion

- **MapLibre 6.13:**
  - Sem basemap e sem glyphs, então não há rótulos de texto no mapa.
  - Fronteiras estáticas do IBGE: `br-uf.json` (27 UFs) e só `ce-municipios.json`.
  - Câmera apenas `fitBounds` (560 ms); hover e seleção instantâneos; tooltip sem limite de borda.
- **Dados em produção:**
  - Socioeconômico: só CE (184 municípios), só 2022, 3 dos 6 indicadores.
  - Eleições: só CE (2022/1, 2022/2, 2024/1, 2026/1 completas; 2024/2 parcial).
  - Emendas: CE por ano, de 2015 a 2026.
  - Locais de votação com coordenadas oficiais.
  - **Não há:** fluxos entre territórios, capitais, centroides, snapshots de apuração, série socioeconômica.
- **Motion:** `src/motion/tokens.ts` + `motion.css` (paridade testada), `TransitionLink` + View Transitions, elemento compartilhado do político, `reveal.tsx` pronto e sem uso. Não há biblioteca de animação.

---

## 1. Decisões

### 1.1 Princípio de monetização

- **Tudo o que é público hoje continua gratuito:** consulta, mapas atuais, comparador com até 5 itens, exports do comparador, indicadores, metodologia e fontes. Isso coincide com o princípio que entra no Manifesto.
- **Os planos pagos acrescentam:**
  - capacidades novas desta rodada;
  - limites maiores nas ferramentas de conta.
- Proveniência, fonte e data de atualização **nunca** são pagas: são auditoria pública.

### 1.2 Capabilities (fonte única: `PlanCatalog`, servido em `GET /api/v1/plans`)

| Capability | Gratuito | Avançado | Profissional | Autoridade |
|---|---|---|---|---|
| `limit.favorites` | 10 | 200 | 1000 | API (`POST /account/saved`) |
| `limit.watchlist` | 5 | 100 | 500 | API |
| `limit.alerts` | 3 | 50 | 200 | API (`POST /account/alerts`) |
| `account.saved_folders` (organizar recortes salvos em pastas) | — | — | ✓ | API |
| `data.map_series` (série completa de uma camada, ex.: emendas por ano, para a linha do tempo) | — | ✓ | ✓ | API |
| `data.correlation_matrix` (cruzamento de vários indicadores) | — | ✓ | ✓ | API |
| `data.export_csv` (export do recorte com proveniência) | — | ✓ | ✓ | API |
| `data.export_bulk` (todos os indicadores da UF em CSV) | — | — | ✓ | API |
| `limit.compare_candidacies` | 5 | 5 | 10 | API (`/elections/compare`) |
| `map.advanced_modes` (relevo 3D, intensidade, comparador antes/depois) | — | ✓ | ✓ | interface (dado público) |
| `account.territorial_default` (abrir análises no território do perfil) | — | ✓ | ✓ | interface |

Cada capability entra no catálogo no mesmo PR que entrega a função e a regra de acesso dela: o PR 1 publica só os limites, as pastas e a comparação ampliada; as capabilities `data.*`, `map.*` e `account.territorial_default` chegam com os PRs 3 e 4. Assim, nenhum PR anuncia um recurso que ainda não existe.

Modos visuais sobre dado público são autorizados na interface. A API já entrega esse dado de graça, e o relatório declara isso. Toda **operação** ou **dado** pago é recusado pela API com `403 {"error":"plan_required","capability":…,"requiredPlan":…}`; anônimo recebe `401`.

### 1.3 Plano efetivo

O plano efetivo é o **máximo** entre:
1. Assinatura viva: `active`, `past_due`, ou `canceled` com `current_period_end` no futuro.
2. Override manual: entitlement `plan` com fonte `admin`, ativo.
3. `PROFESSIONAL` para Super Admin.

Entitlements `capability:<chave>` e `limit:<chave>` concedidos pelo admin sobrepõem o catálogo.

### 1.4 Billing

Não há provedor. O sistema faz o seguinte:
- **`IBillingProvider`:** a implementação `NoBillingProvider` responde `503 billing_unavailable` no checkout. Nada é cobrado nem simulado.
- **Assinaturas `manual`:** só o Super Admin cria ou corrige, com auditoria.
- **Na interface:** "Pagamento online ainda não disponível".

Nenhum dado de cartão é armazenado.

### 1.5 RBAC

- **Papéis:** `user`, `super_admin`.
- **Fontes do `super_admin`:** a configuração (`Auth:SuperadminEmails`, que não é editável pela interface) ou o entitlement `account.role = superadmin` (compatível com o atual).
- **Filtro `[SuperAdmin]`:** em todo `/api/v1/admin/*`, valida sessão, papel e, em mutações, CSRF.
- **Proteções:** não se rebaixa o último Super Admin efetivo; ninguém suspende a si mesmo.
- **Conta suspensa:**
  - `disabled_at` + `disabled_reason`;
  - sessões revogadas na suspensão;
  - login recusado.

### 1.6 Perfil

- **Campos:** `full_name`, `display_name` (já existe), `state_code`, `municipality_ibge_code` (validado no catálogo de municípios), `usage_type` (eleitor, estudante_pesquisador, jornalista, assessor_politico, servidor_publico, outro).
- **Avatar:** `avatar_hidden`, para usar as iniciais em vez da foto do provedor. Não há upload, porque o projeto não tem armazenamento de objetos.
- **E-mail:** somente leitura, porque é a identidade do login.
- **Login Google:** deixa de sobrescrever um `display_name` editado (`profile_customized_at`).
- **Nunca coletado:** CPF, partido, candidato, ideologia, religião, intenção de voto.

### 1.7 Alertas reais

O hosted service `DataEditionAlertPublisher` observa novas edições oficiais gravadas e publica notificações idempotentes (`event_key` único por usuário):
- `socioeconomic_source` → indicador;
- `parliament_source` de emendas → UF;
- `poll_source` → pleito, cargo e UF;
- `totalization_snapshot` → apuração.

Sem isso, um alerta nunca dispararia.

Cada edição é registrada uma vez em `account.alert_edition` (`first_seen_at`) e entregue só a quem já assinava antes dela aparecer: assinar hoje não traz aviso de edição antiga. A apuração é notificada por marcos (início, 25%, 50%, 75%, encerramento), não a cada snapshot. A assinatura só aceita os tipos do catálogo (`AlertCatalog`), e a entrega é só na conta: e-mail de alerta não existe, então não é oferecido.

### 1.8 `/suporte`

O formulário passa a gravar de verdade:
- endpoint `POST /api/v1/support/requests` com limite por IP;
- caixa no Super Admin.

Saem os selos sem lastro e o FAQ desatualizado.

### 1.9 `/dados`

O explorador territorial terá:
- **Mapa protagonista** e trilha Brasil › UF › município.
- **Estado na URL:** `uf`, `municipio`, `modo`, `x`, `y`, `periodo`, `ano`, `cargo`, `vista`.
- **Modos:** Socioeconômico, Eleitoral (vencedor por cargo; comparação entre pleitos do mesmo cargo) e Emendas (por ano; linha do tempo).
- **Disponibilidade real:** a cobertura por UF vem da API. Onde não há dado, a interface diz "sem dados carregados".
- **Geometria:** fronteiras municipais oficiais do IBGE para as 27 UFs, para navegar e identificar territórios. Valores, só onde existem.

### 1.10 Os 20 efeitos (decisão)

| # | Efeito | Decisão |
|---|---|---|
| 01 | Extrusão | Sim: altura ∝ indicador real (modo Relevo, Avançado), com legenda de altura |
| 02 | Hover com elevação | Sim: destaque + véu sobre os demais (opacidade com transição) |
| 03 | Câmera Brasil → UF → município | Sim: `fitBounds`/`flyTo` com `survey`/`traverse`; Reduced Motion vira corte seco |
| 04 | Fronteiras progressivas | Sim: contorno da seleção revelado (largura/opacidade com transição) |
| 05 | Choropleth animado | Sim: cross-fade entre duas camadas (equivale à interpolação RGB por território) + legenda acompanhando |
| 06 | Pulso por dado | Sim, só em indicadores de contagem: anel único na chegada, nos N maiores valores; nunca em laço |
| 07 | Arcos/fluxos | **Omitido:** não existe dado de fluxo |
| 08 | Pontos semânticos | Locais de votação já existem no explorador eleitoral; capitais omitidas (sem dado de capital) |
| 09 | Heatmap | Sim, só para contagens, a partir de centroides calculados da malha oficial (modo Intensidade, Avançado) |
| 10 | Tooltip inteligente | Sim: limitado à viewport, evita cobrir a seleção, com unidade e período; clique fixa |
| 11 | Spotlight | Sim: território selecionado forte, resto do Brasil com contraste reduzido |
| 12 | Morph entre modos | Sim: troca de modo por cross-fade, mantendo câmera e seleção |
| 13 | Timeline | Sim para emendas (2015–2026); socioeconômico omitido (um período só) |
| 14 | Replay de apuração | **Omitido:** zero snapshots em produção |
| 15 | Antes/depois | Sim: divisor arrastável e acessível por teclado (`input range`), mesmo cargo em dois pleitos ou dois indicadores |
| 16 | Enquadramento automático | Sim: `fitBounds` da seleção, com padding dos painéis |
| 17 | Mapa ↔ interface | Sim: hover na tabela/ranking destaca o território no mapa e vice-versa |
| 18 | Text reveal | Sim, seletivo, com `reveal.tsx` existente: títulos e números de destaque, mudança de contexto |
| 19 | Shared element | Estende o existente: nome do território do painel → perfil do município |
| 20 | Microinterações | Vocabulário ampliado em `motion.css` (segmentado, chips, toggles, drawer, carregamento/sucesso/erro) |

Ressalvas do contrato de motion:
- Números oficiais **não contam** (`docs/MOTION_SYSTEM.md` §1.3). A mudança de valor é feita por troca com máscara (`value-arrive`), não por contagem interpolada.
- Não há springs: compressão de clique discreta só em CTA principal, efeito magnético só em CTA principal com ponteiro fino.

### 1.11 Manifesto

O texto é mantido. Mudam dois pontos:
- **Nova seção curta "Sustentabilidade"**, com o princípio do paywall. Sem ela, os planos pagos não teriam compromisso público.
- **Assinatura de `docs/manifesto.md`:** alinhada à da página e à citada pelo proprietário, "Sem se ajoelhar para ninguém". É correção de consistência, não editorial.

---

## 2. PRs (empilhados)

1. `feat/conta-planos` → `main`: perfil, planos, entitlements, billing (abstração), limites, alertas reais, `/conta` hub e `/planos`.
2. `feat/super-admin` → PR 1: RBAC, `/admin`, usuários, assinaturas, auditoria, diagnóstico, catálogo OpenAPI, caixa de suporte, `/suporte` real.
3. `feat/dados-territorial` → PR 2: geometria das 27 UFs, motor do mapa, `/dados`, endpoints pagos de série/matriz/export, extensão do motion.
4. `feat/navegacao-a11y` → PR 3: navegação autenticada, Parlamento na navegação, a11y, contrastes, honestidade do perfil, URL em `/pesquisas` e `/parlamento`, Manifesto, "Meu estado".

Migrations (SQL bruto, inline, esquema `account`, com `Down` exato):

| Migration | Conteúdo |
|---|---|
| `20261020120000_AddAccountProfileAndPlans` | Perfil, assinatura, pasta em `saved_item` |
| `20261020130000_AddAdminAuditAndSupport` | Auditoria, suporte, `disabled_reason` |

---

## 3. PR 1 — Conta, perfil, planos e entitlements

### Task 1.1: migration de perfil e planos
**Files:** Create `backend/src/RepBrasil.Infrastructure/Migrations/20261020120000_AddAccountProfileAndPlans.cs`

- [ ] Em `account.user_account`, adicionar as colunas `full_name`, `state_code`, `municipality_ibge_code`, `usage_type`, `avatar_hidden` (default `false`) e `profile_customized_at`, com `CHECK` de formato e de domínio.
- [ ] Criar `account.subscription`:
  - campos: `id`, `user_id`, `plan` (`ADVANCED`/`PROFESSIONAL`), `status` (`active`, `past_due`, `canceled`, `expired`), `provider` (`manual`), `provider_reference`, `current_period_end`, `cancel_at_period_end`, `notes`, `created_at`, `updated_at`, `canceled_at`;
  - índice único parcial: uma assinatura viva por usuário.
- [ ] Em `account.saved_item`, adicionar `folder text NULL` (1–60 caracteres).
- [ ] Escrever o `Down` exato (drop das colunas e da tabela).
- [ ] Rodar zero → up → down (`AddMandate`) → up no PostGIS 18 local e conferir.

### Task 1.2: `PlanCatalog` e `EntitlementResolver`
**Files:**
- Create `backend/src/RepBrasil.API/Accounts/PlanCatalog.cs` e `backend/src/RepBrasil.API/Accounts/EntitlementResolver.cs`.
- Test: `backend/tests/RepBrasil.Tests/Api/PlanCatalogTests.cs` (sem banco) e `AccountPlanFlowTests.cs` (banco).

- [ ] Teste: o catálogo tem exatamente FREE, ADVANCED (2490 centavos) e PROFESSIONAL (6990); limites e capabilities batem com a tabela 1.2; um plano maior contém o menor.
- [ ] Implementar `PlanCatalog` (planos, capabilities, limites, textos de produto em pt-BR).
- [ ] Teste: resolução do plano efetivo (assinatura viva, `canceled` dentro do período, `expired`, override `plan`, Super Admin, `capability:`/`limit:` manuais, entitlement expirado ignorado).
- [ ] Implementar `EntitlementResolver.ResolveAsync(userId)` e a variante anônima (FREE).

### Task 1.3: endpoints de plano, perfil e capabilities
**Files:**
- Create `backend/src/RepBrasil.API/Controllers/PlansController.cs` e `backend/src/RepBrasil.API/Accounts/ProfileService.cs`.
- Modify `AccountController.cs` e `AccountService.cs`.

- [ ] `GET /api/v1/plans`: catálogo público.
- [ ] `GET /api/v1/account/me`: passa a incluir `role`, `plan`, `capabilities`, `limits`, `profile` e `subscription` (sem segredo).
- [ ] `GET/POST /api/v1/account/profile`: validação do perfil; município pertence à UF (`electoral.municipality`); `profile_customized_at`.
- [ ] Login Google: não sobrescreve `display_name` quando `profile_customized_at` está preenchido.
- [ ] `POST /api/v1/billing/checkout {plan}`: `503 billing_unavailable` via `NoBillingProvider`.
- [ ] Testes de banco: persistência, validação 400, CSRF 401, sobrescrita no login.

### Task 1.4: enforcement de limites e capabilities
**Files:**
- Create `backend/src/RepBrasil.API/Accounts/RequiresCapabilityAttribute.cs`.
- Modify `AccountService.cs` (saved/alerts) e `ElectionsController.cs` (compare).

- [ ] Teste: o 11º favorito do Gratuito recebe 403 `plan_limit_reached`; com Avançado, passa; criar alerta no Gratuito recebe 403 `plan_required`; pasta só no Profissional.
- [ ] Implementar a contagem por coleção antes do insert; itens existentes acima do limite nunca são apagados.
- [ ] Compare com mais de 5 candidaturas exige `limit.compare_candidacies` ≥ N e não usa o cache de saída.

### Task 1.4b: robustez do login (achado nos testes)
- [x] Logins simultâneos em transação `Serializable` podem colidir (SQLSTATE 40001), o que virava 503. A transação inteira passa a ser repetida (até 4 tentativas); o desafio só é consumido na tentativa que conclui.

### Task 1.5: publicador de alertas
**Files:** Create `backend/src/RepBrasil.API/Accounts/DataEditionAlertPublisher.cs` (BackgroundService, intervalo configurável, desligável).

- [ ] Teste de banco: nova edição de `socioeconomic_source` gera uma notificação por inscrito; uma segunda execução não duplica.
- [ ] Implementar as varreduras das quatro fontes (janela de 14 dias, `event_key` estável por edição).

### Task 1.6: frontend — capabilities e hub `/conta`
**Files:**
- Create `frontend/src/lib/plans.ts`, `frontend/src/lib/useAccount.ts` (TanStack Query) e `frontend/src/app/conta/layout.tsx`.
- Rotas: `conta/page.tsx` (visão geral), `perfil`, `plano`, `favoritos`, `watchlist`, `alertas`, `notificacoes`, `seguranca`.
- Create `frontend/src/app/planos/page.tsx`.

- [ ] `useAccount()` como fonte única no cliente (cache e invalidação).
- [ ] `useCapability(key)` lê `capabilities`/`limits` da API, sem `if (plan === …)` espalhado.
- [ ] Perfil:
  - formulário com UF → município, com a lista vinda da API;
  - tipo de uso;
  - avatar: provedor ou iniciais;
  - e-mail somente leitura.
- [ ] Plano: plano atual e comparação; "Pagamento online ainda não disponível", sem checkout falso.
- [ ] Alertas: criar e remover, respeitando o limite; Notificações: marcar lida.
- [ ] Segurança: sessão, sair; acesso programático legado isolado (listar/revogar; criação recolhida).
- [ ] Testes Vitest de cada seção (carregando, erro com retry, vazio, limite atingido).

---

## 4. PR 2 — Super Admin

### Task 2.1: migration de auditoria e suporte
- [ ] `account.admin_audit_log`: só inserção; campos `actor_user_id`, `actor_email`, `action`, `target_user_id`, `target_label`, `before`, `after`, `context`, `created_at`.
- [ ] `account.support_request`: `id`, `category`, `name`, `email`, `message`, `status` (`novo`, `em_analise`, `respondido`, `arquivado`), `created_at`, `updated_at`, `ip_hash`.
- [ ] `user_account.disabled_reason`.

### Task 2.2: RBAC
- [ ] `SuperAdminAttribute` (filtro):
  - 401 sem sessão;
  - 403 sem papel;
  - 401 sem CSRF em mutação;
  - conta suspensa = sem sessão.
- [ ] Testes: anônimo 401, comum 403, admin 200; mutação sem CSRF 401.

### Task 2.3: operações administrativas
Endpoints POST/DELETE em `/api/v1/admin/users…`: listar/buscar/ordenar/paginar, detalhe, suspender/reativar, papel, plano manual (com validade), conceder/revogar entitlement (só chaves do catálogo e `api.daily_quota` legado), criar/corrigir assinatura manual, histórico.

- [ ] Toda ação grava auditoria (`before`/`after`, sem segredo) na mesma transação.
- [ ] Último Super Admin efetivo protegido; auto-suspensão bloqueada.
- [ ] Testes de banco para cada ação, incluindo a recusa do último admin.

### Task 2.4: diagnóstico
- [ ] `GET /api/v1/admin/overview`, com componentes **que existem**:
  - API: revisão, ambiente, início do processo;
  - banco: latência do `SELECT 1` e versão;
  - lake RPC: health com latência;
  - frontend: `GET` em `Auth:FrontendBaseUrl` com revisão e latência.
- [ ] Frescor por tabela de edição: `ingestion_run`, `open_data_source_file`, `derived_refresh`, `socioeconomic_source`, `parliament_source`, `poll_source`, `totalization_snapshot`.
- [ ] Execuções recentes de ingestão, com falhas.
- [ ] Usuários: total, ativos, suspensos, novos em 7 e 30 dias, sessões ativas, por plano, por papel.
- [ ] Assinaturas por status; overrides manuais.
- [ ] Métricas HTTP do processo (por rota: chamadas, 5xx, p95) desde o início.

### Task 2.5: catálogo OpenAPI
- [ ] Registrar sempre o `AddSwaggerGen` (a UI pública continua condicionada a `Swagger:Enabled`).
- [ ] Documentação XML (com `NoWarn` 1591) e tags por controller.
- [ ] Esquemas de segurança (sessão, CSRF, API key) derivados dos mesmos atributos que aplicam a regra (`[SuperAdmin]`, `[RequiresSession]`, `[RequiresCapability]`).
- [ ] `GET /api/v1/admin/openapi`: documento real, gerado pelo `ISwaggerProvider`, mais as métricas por rota.

### Task 2.6: suporte real
- [ ] `POST /api/v1/support/requests`: limite por IP e validação; `GET/POST /api/v1/admin/support…` para a caixa e o status.
- [ ] `/suporte` envia de verdade, com estados de envio, sucesso e erro; saem os selos sem lastro; FAQ atualizado.

### Task 2.7: frontend `/admin`
- [ ] Layout com guarda: chama `/admin/me`; 401 manda para entrar; 403 mostra "Acesso restrito"; `noindex`.
- [ ] Seções: Visão geral, Usuários (lista + detalhe + ações com confirmação), Assinaturas, Auditoria, API (catálogo agrupado por tag, parâmetros, corpo, respostas, autenticação, métricas; "Testar" só em GET público), Suporte, Dados (frescor).
- [ ] Testes Vitest das seções e das confirmações.

---

## 5. PR 3 — `/dados` territorial, mapa e motion

### Task 3.1: geometria nacional
- [ ] Generalizar `frontend/scripts/fetch-ibge-geo.mjs` para as 27 UFs: `public/geo/municipios/<UF>.json` e `meta.json` com proveniência (URL, data, SHA-256).
- [ ] `lib/elections/geo.ts`: carga sob demanda por UF; o explorador eleitoral continua igual.

### Task 3.2: motor do mapa (`components/territory/`)
- [ ] `TerritoryCanvas`: MapLibre carregado sob demanda.
- [ ] Camadas:
  - choropleth em duas camadas (cross-fade);
  - véu de spotlight;
  - destaque;
  - contorno revelado;
  - extrusão;
  - heatmap por centroides;
  - anéis de pulso.
- [ ] Câmera com tokens; tooltip inteligente; teclado (setas/Enter na lista equivalente).
- [ ] Fallbacks: sem WebGL vira tabela; Reduced Motion vira corte seco e sem pulso; celular sem extrusão.
- [ ] Testes: lógica pura (escalas, centroides, posicionamento do tooltip, seleção de modo) e renderização do fallback.

### Task 3.3: `/dados`
- [ ] `DataExplorer` reescrito como explorador.
- [ ] Ordem: trilha territorial → mapa → painel de leitura (o que estou vendo, território, indicador, período, fonte, atualização, unidade) → comparação X × Y com explicação do que a correlação significa e do que **não** significa → clusters → tabela de municípios ligada ao mapa.
- [ ] Modos Socioeconômico, Eleitoral e Emendas; cobertura por UF vinda da API.
- [ ] Endpoints pagos: `GET /parliament/amendments/map-series`, `GET /data/correlation-matrix`, `GET /data/export`, `GET /data/export/bulk`, com `[RequiresCapability]` e testes 401/403/200.
- [ ] Testes Vitest: URL ↔ estado, navegação Brasil → UF → município → volta, disponibilidade, gating de interface por capability, Reduced Motion.

### Task 3.4: motion
- [ ] `src/motion/map.ts` (câmera e transições de camada com tokens) e `src/motion/feedback.ts` (troca de valor e estados).
- [ ] `motion.css`: segmentado, chips, toggles, sucesso/erro, `.reveal-*` aplicados seletivamente.
- [ ] Atualizar `docs/MOTION_SYSTEM.md` (novas peças e regras) e o teste de paridade.

---

## 6. PR 4 — Navegação, acessibilidade, honestidade e Manifesto

- [ ] Navegação:
  - bloco de conta no rodapé da barra lateral (Entrar / avatar + nome → `/conta`; Admin só para Super Admin, vindo de `/account/me`);
  - Parlamento em "Geral";
  - ícone próprio do Glossário;
  - rótulo "Suporte";
  - a pílula flutuante fica só com salvar a página.
- [ ] Acessibilidade:
  - skip link;
  - `<nav aria-label>`;
  - drawer modal (`inert` no conteúdo, `role="dialog"`);
  - FAQ com `aria-expanded`;
  - rótulos em `/politicos`;
  - anéis de foco fortes;
  - contrastes (`bg-action`, tokens semânticos no lugar das cores cruas).
- [ ] Honestidade do perfil:
  - estados de falha com retry nas abas eleições/bens/fontes;
  - "Fontes do sistema" no lugar de "Fontes vinculadas".
- [ ] URL em `/pesquisas` (turno, cargo, UF) e `/parlamento` (membro, ano).
- [ ] Manifesto: seção Sustentabilidade (página e `docs/manifesto.md`); assinatura alinhada.
- [ ] "Meu estado": atalho para UF/município do perfil (todos os logados); abertura padrão no território (Avançado).
- [ ] Testes Vitest: navegação por estado de autenticação, drawer, skip link, URL.

---

## 7. Validação

- **Backend:**
  - `dotnet build -c Release` sem avisos;
  - `dotnet format --verify-no-changes`;
  - `dotnet test` (unidade);
  - testes de banco com `REPBRASIL_ELECTORAL_TEST_DB` no PostGIS 18 local;
  - migrations zero → up → down (`AddMandate`) → up.
- **Frontend:** `tsc --noEmit`, `next lint`, `vitest run`, `next build`.
- **Navegador local** (API local + banco local + proxy somente leitura para dados públicos de produção):
  - navegação desktop/celular;
  - `/dados` sem erro de console;
  - deep links;
  - Reduced Motion;
  - `/conta`, perfil persistido;
  - planos e gating;
  - admin autorizado × usuário comum bloqueado;
  - auditoria.
- **CI** de cada PR verde; Sonar sem issue nova.
