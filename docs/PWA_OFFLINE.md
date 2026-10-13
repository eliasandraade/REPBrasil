# PWA factual-safe — contrato e verificação

O REPBrasil é instalável, mas o cache do navegador nunca vira uma segunda fonte factual. Resultados,
apuração, pesquisas, Parlamento, emendas e indicadores só aparecem como vieram da rede; sem conexão,
o produto diz isso explicitamente.

## Contrato

| Requisição | Estratégia | Cache |
|---|---|---|
| Navegação (`mode: navigate`) | rede primeiro; sem rede → `/offline.html` | **nunca** guarda páginas |
| API (`/api/` na mesma origem ou `api.apprepbrasil.com.br`) | não interceptada | nunca |
| Payload RSC do Next (`?_rsc=`) | não interceptado | nunca |
| Métodos diferentes de GET | não interceptados | nunca |
| `/_next/static/*` (com hash), `/brand/*`, `/favicon.ico` | cache-first | cache da versão do deploy |
| Malhas `/geo/*` e demais arquivos | não interceptados | cache HTTP do navegador |

- **Fallback determinístico:** `frontend/public/offline.html` é estático e autocontido (CSS inline,
  sem JavaScript, sem dado factual), marcado com `<meta name="repbrasil-offline" content="factual-safe">`.
  "Tentar novamente" recarrega a própria URL pedida (`href=""`).
- **Uma versão por deploy:** o worker é registrado como `/sw.js?v=<revisão>`
  (`NEXT_PUBLIC_REPBRASIL_REVISION`, a mesma do header `X-RepBrasil-Revision`). Cada deploy instala um
  worker novo, que assume na hora (`skipWaiting` + `clients.claim`) e apaga os caches das versões
  anteriores (inclusive o legado `repbrasil-shell-v1`). Um worker antigo que ainda atenda um pedido
  durante a troca não recria o cache já apagado.
- **Página já carregada que perde a conexão:** `OfflineNotice` mostra, sob a barra superior,
  "Sem conexão. As informações desta página foram carregadas antes da queda e podem estar
  desatualizadas." O aviso some quando a conexão volta, e as consultas refazem a busca.
- `sw.js` é servido com `Cache-Control: no-cache, no-store, must-revalidate` e
  `Service-Worker-Allowed: /`; o registro usa `updateViaCache: "none"`.

## Verificação

- **Unitária** (`frontend/tests/service-worker.test.ts`, `frontend/tests/pwa.test.tsx`): o `sw.js`
  real roda num contexto isolado com `CacheStorage` falso — precache por versão, poda na ativação,
  navegação nunca guardada, fallback sem rede, 503 explícito sem fallback, API/RSC/POST/malhas nunca
  interceptados, estáticos cache-first, worker antigo sem recriar cache; aviso de conexão e URL
  versionada do registro.
- **Navegador real, antes do merge** (job de CI "PWA offline", `.github/scripts/pwa-local.mjs`):
  build de produção desta revisão + Chromium. "Sem conexão" é uma queda real de rede
  (`.github/scripts/network-switch.mjs`), que atinge também o `fetch` do service worker: no CI, um
  gate TCP com upstream fixo (o `next start` do job) que derruba e recusa conexões; em produção, um
  túnel só CONNECT para uma lista fechada de destinos (site e API). Nenhum dos dois é proxy aberto:
  o destino nunca vem da requisição. O ciclo de vida é esperado por eventos (`ready`,
  `controllerchange`, `statechange`), sem sleep. Cenários: primeira visita → sem rede; recarga sem
  rede; aviso numa página factual carregada; segunda visita (cache quente) → sem rede; inventário do
  cache (só fallback, ícones e estáticos com hash); próximo deploy (worker novo assume e poda o cache
  anterior), em contexto próprio e a partir de página ociosa — mesmo com `skipWaiting()` o Chrome só
  ativa o worker novo quando o anterior não atende nenhuma requisição; viewport móvel sem rolagem
  horizontal. Evidências: artefato `repbrasil-pwa-local`.
- **Produção, depois do deploy** (`.github/scripts/production-smoke.mjs`): os mesmos cenários contra
  `www.apprepbrasil.com.br`, exigindo o worker da revisão exata implantada — exceto a troca de versão,
  que só o CI simula (em produção, o deploy seguinte é a própria troca).

### Por que não a emulação offline do DevTools

`context.setOffline()` do Playwright 1.55 não se aplica ao `fetch` do service worker (só com
`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, conforme `crServiceWorker.js`). Foi o que produziu o
falso resultado do production smoke #3: com a página "offline", o worker buscava a página real na
rede. Mesmo com a variável, observamos que a emulação vale para a primeira navegação controlada e
depois se perde (recarga e navegações seguintes voltam a alcançar a rede); a causa provável é que,
com a variável, a sessão da página também se anexa ao worker sem emulação. Por isso a queda de rede
dos testes é real (proxy), e a emulação fica só para `navigator.onLine` e os eventos
`online`/`offline` da página.
