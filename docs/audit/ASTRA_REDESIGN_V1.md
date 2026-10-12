# REPBrasil — snapshot Astra v1 para auditoria

Preparação em 12/10/2026 (America/Fortaleza). Este documento descreve o código congelado, sem aprovar a direção visual ou propor correções.

## Identidade e procedência

```text
BASELINE_BEFORE_REDESIGN=3e97d8d43b5ca053d3cfba290a55380a32959392
ASTRA_REDESIGN=c56dabf5bd4178ed92573300555f48996b14c8cb
snapshot curto=c56dabf
mensagem=chore: preserve Astra redesign state for audit
data do commit=2026-10-12T14:34:19-03:00
pai=3e97d8d43b5ca053d3cfba290a55380a32959392
branch de origem=codex/repbrasil-experience
branch de auditoria=audit/astra-redesign-v1
repositório=C:\Users\Elias\Documents\REPBrasil
worktree=C:\Users\Elias\Documents\REPBrasil-astra-audit
remote=https://github.com/eliasandraade/REPBrasil.git
```

A branch de auditoria foi criada exatamente no snapshot acima. Um commit posterior contém somente esta documentação e evidências; o snapshot visual continua identificado pelo SHA imutável. Para identificar o commit documental: `git log --format=fuller -- docs/audit/ASTRA_REDESIGN_V1.md`. Seu SHA é também fornecido na entrega. Não há squash, rebase, alteração de commits anteriores ou merge.

### Limite essencial do baseline

O reflog registra a troca de `feat/product-readiness-review` para `codex/repbrasil-experience` em 3e97d8d. Antes da preservação, não havia commits do redesign: todas as mudanças estavam no working tree. O baseline é o último commit anterior à frente, não um snapshot exato do working tree recebido.

O estado inicial já continha alterações não commitadas em: `app/glossario/page.tsx`, `app/politicos/page.tsx`, `components/elections/{CompareTools,ComparisonView,ElectionsExplorer}.tsx`, `components/layout/AppShell.tsx`, `components/politicians/ProfileHeader.tsx`, `components/politicians/tabs/AssetsTab.tsx`, `components/ui/DataState.tsx`, `components/xray/CandidacyPanels.tsx`, `tailwind.config.ts`, além da exclusão staged de `components/ui/button.tsx` (caminhos sob frontend/src, salvo tailwind). Elas foram preservadas no snapshot porque integram o resultado executável recebido e final. Não há um commit intermediário que permita atribuir cada hunk dessas áreas apenas ao Astra. Essa lista vem do registro da sessão, e não é reconstruível só pelo histórico Git. O revisor deve tratar o diff como delta agregado, não autoria exclusiva.

Na inspeção inicial, HEAD e `origin/feat/product-readiness-review` apontavam para 3e97d8d. `origin/HEAD` identifica `main` como principal. Após fetch, `origin/main` era de462beea1cd719913523a41f7061b7ed760ae7e; a `main` local era 45f8686b5237429c930a15c209f8e8edc631ec6b. Nenhuma delas foi movida. A versão atual de main não é o baseline desta frente. Branches e últimos commits estão em `evidence/branches.txt` e `evidence/history.txt`.

## Escopo e diff

O snapshot agrega 72 arquivos: 25 adicionados, 45 modificados e 2 removidos; 2.638 inserções e 686 exclusões de linhas, além de binários. Inventário completo por categoria em [INVENTORY.md](INVENTORY.md), lista Git em [diff-name-status.txt](evidence/diff-name-status.txt) e estatística em [diff-stat.txt](evidence/diff-stat.txt).

Backend, ETL, infraestrutura, package.json e package-lock.json não diferem do baseline. Os ZIPs locais REPBrasil.zip e etl.zip, logs temporários anteriores, builds, caches, node_modules e .env não entraram no commit. Pranchas oficiais, fonte/licença, recortes e capturas de UI são evidências/ativos intencionais. A busca de padrões de chaves privadas e tokens conhecidos não encontrou correspondências no conteúdo versionado; isso não equivale a uma auditoria especializada de segredos ou do histórico inteiro.

## Arquitetura visual e design system

Shell claro institucional e área de análise escura. Paleta oficial: navy #0B2D5B, verde #0F9D58, teal #00BAA6; canvas #071A2E, surfaces #0D2744 e #102F50. Tokens Tailwind e CSS em `frontend/tailwind.config.ts`, `app/globals.css` e `motion/motion.css`; ainda existem cores/classes locais nos componentes, portanto não há uniformização total por tokens semânticos.

Inter Variable local com font-display swap. BrandMark usa recortes PNG dos pixels da prancha oficial; não usa novos vetores da marca. Script e provenance.json registram retângulos e hash. O material fornecido não continha masters separados. Icon SVG anterior foi removido e substituído por PNG. A remoção de ui/button.tsx já era anterior à intervenção.

Perfis passaram a usar cabeçalho documental e faixa de fatos; visão geral em duas colunas no desktop. Listas e registros têm divisores e menor número de caixas. Eleito/não eleito usa badge neutro. Bordas Tailwind inválidas foram substituídas em vários componentes. A comparação preserva matriz, CSV, URL e avisos de comparabilidade; o cabeçalho mudou. Não se alteraram fórmulas de domínio nesta frente.

## Navegação: antes e Astra

ANTES (commit-base): sidebar desktop de 224px, grupos Geral e Suporte; Início, Políticos, Eleições, Manifesto, Glossário e Central de Suporte. Barra mobile com marca, busca e botão que abre drawer de 256px. Busca global já existia, incluindo Ctrl/Cmd+K e atalho `/`.

ASTRA: sidebar substituída por header superior claro; Explorar, Eleições, Pessoas e Comparar. Marca, busca e acesso Sobre os dados no topo; Princípios, Glossário e Suporte no rodapé. No celular há barra inferior com quatro destinos, safe area e header compacto. Skip link para conteúdo. A busca existente foi mantida; hint mostra Ctrl K e o foco é aplicado depois de showModal. O drawer anterior não permanece no shell.

## Map experience: verdade técnica

### Renderização e geometria

MapLibre GL JS 6.13, canvas WebGL, fontes GeoJSON locais IBGE. O mapa implementado é **vetorial 2D**, visto de cima no estado inicial; WebGL não o torna um mapa de sólidos 3D. Há camadas `fill`, `line` e `circle`, triangulação interna do renderer e feature-state. Não há Three.js, React Three Fiber, CSS perspective, mapa SVG, shaders autorais, terreno elevado ou `fill-extrusion`. O renderer usa os shaders internos do MapLibre.

Estados e municípios são features poligonais, não meshes individuais modeladas pela aplicação. Não possuem altura, espessura, normais de sólidos, materiais físicos, iluminação ou sombras de volume definidos pelo produto. A cor e a opacidade são paint properties. Malhas de UF abrangem o Brasil; malha municipal disponível somente para CE. Locais de votação só usam coordenadas oficiais, sem pontos inventados.

### Câmera

Existe câmera geográfica real do MapLibre, com center/zoom/bearing/pitch e matriz perspectiva interna (ver `mercator_transform.ts` da versão instalada). Isso não significa geometria 3D na cena. A aplicação não define posição XYZ, target de objeto ou câmera ortográfica própria. O código deixa pitch e bearing iniciais nos defaults 0, desativa dragRotate, pitchWithRotate e rotação de toque/teclado. Não implementa orbit, dolly cinematográfico ou transição de tilt. O código não chama `touchPitch.disable()` nem fixa maxPitch=0; portanto não se afirma bloqueio universal de todo gesto de inclinação do engine.

`fitBounds` enquadra limites reais, com padding assimétrico, maxZoom 5 no país e 13 nos demais enquadramentos; o engine tem maxZoom 15. `easeTo` aproxima/afasta pelo zoom. Transição survey de 360ms (antes 560ms), zero em reduced motion. ResizeObserver recalcula enquadramento respeitando interação do usuário.

### Interação e persistência

Hover altera opacidade e contorno; seleção é contorno teal separado do preenchimento de cobertura. Clique/lista muda rota e contexto. Brasil → UF → município → zona → local/seção usa as APIs e URLs existentes. Geografia estadual permanece como contexto quando município é exibido. Falta de malha municipal tem aviso e alternativa por lista.

Camadas já existentes incluem intensidade, percentual válido, mais votado, crescimento, queda e A × B. O redesign adiciona seletor compacto mobile; não cria modelos de cálculo. Ausência de candidatura/resultado continua explícita. Painéis refletem queries TanStack; resultados de seção são sobrepostos ao mapa com inert/aria-hidden no fundo. A instância do explorador foi elevada ao layout de ano/turno para persistir entre segmentos territoriais. Trocar ano/turno pode remontar o layout; não se promete uma instância única por toda a aplicação.

## Motion e reduced motion

Abstrações prévias em `src/motion`: NavigationProvider, TransitionLink, direção de navegação, identidade compartilhada, reveal e reduced-motion. Usam CSS, Web Animations API e View Transitions quando suportado; não se introduziu Framer Motion, GSAP ou biblioteca 3D. O redesign muda tokens survey e regras CSS. `matchMedia`/useSyncExternalStore acompanha prefers-reduced-motion; câmera usa duração zero e CSS reduz/desativa animação. Verificação automatizada existe, mas não há certificação em leitores de tela ou hardware físico.

## Rotas, home e login

```text
HOME ROUTE: /
status: existente e substituída internamente
implementation: app/page.tsx → components/home/BrazilWorkspace.tsx
changes: hero explicativo e HomeCoverage substituídos por atlas, busca,
         seleção de UF, catálogo temporal e cobertura obtida da API.

LOGIN ROUTE: ausente
status: não existe no baseline nem no snapshot
implementation: nenhuma tela /login ou /auth no App Router
reason if absent: produto público de consulta; autenticação fora desta frente.
```

URLs públicas preservadas: `/`, `/eleicoes`, `/eleicoes/[year]/[round]/[[...path]]`, `/eleicoes/comparar`, `/politicos`, `/politicos/[slug]`, `/manifesto`, `/glossario`, `/suporte`. Nenhuma nova URL de página foi criada/removida. Foi criado layout persistente em `[year]/[round]`; validação de eleição passou para ele, e a catch-all mantém metadata. Redirect legado `/politico/:id` permanece. Não foi criada nem removida autenticação.

## Dependências e performance

Nenhuma dependência npm introduzida exclusivamente pelo redesign; manifest e lockfile idênticos ao baseline. Fonte Inter e PNGs são novos ativos locais. MapLibre dinâmico, worker local gerado pelo prebuild existente e retenção de instância evitam remontagem entre territórios. A home agora carrega um mapa, custo novo em relação à home anterior. Não houve benchmark comparativo baseline/redesign. First Load JS, testes e logs locais não provam CWV, FPS/GPU ou performance em aparelho físico. O script de recorte usa sharp disponível na árvore do Next; os recortes já estão versionados e não precisam ser regenerados para executar.

## Mobile

Barra inferior direta, mapa antes do painel, camadas por select, controles cartográficos de 44px, perfil em uma coluna e comparação com rolagem horizontal interna. As capturas anteriores estão em docs/audits/screenshots e são evidência da sessão anterior, não desta worktree. Teste visual isolado desta preparação é registrado abaixo.

## Estrutura principal

```text
frontend/
├── package.json / package-lock.json / tailwind.config.ts
├── public/{brand,fonts,geo}/
├── scripts/{copy-maplibre-worker,extract-official-brand}.mjs
├── src/
│   ├── app/
│   │   ├── page.tsx / layout.tsx / globals.css / providers.tsx
│   │   ├── eleicoes/[year]/[round]/layout.tsx
│   │   ├── eleicoes/[year]/[round]/[[...path]]/page.tsx
│   │   ├── eleicoes/comparar/
│   │   ├── politicos/[slug]/
│   │   └── {manifesto,glossario,suporte}/
│   ├── components/{brand,layout,home,search,elections,politicians,xray,ui}/
│   ├── lib/elections/{geo,map-layers,route}.ts
│   └── motion/{tokens,navigation,reduced-motion,reveal,identity,depth,motion.css}
└── tests/
```

## Reprodução e isolamento

Nova worktree criada no diretório irmão solicitado, que não existia. No início: branch audit/astra-redesign-v1, HEAD c56dabf, status limpo, sem submódulos. Documentação e lockfiles estão versionados; node_modules não é copiado da principal. Node 22.19.0 e npm 10.9.3. Não foram copiados .env, certificados, cookies, dumps ou chaves. `.env.local.example` é referência de URL pública.

Na worktree, executar:

```powershell
cd frontend
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test
$env:NEXT_PUBLIC_API_URL = 'http://localhost:5400'
npm run build
npm run start -- --hostname 127.0.0.1 --port 3400
```

Foi iniciada uma segunda instância da API do mesmo snapshot em 5400, sem modificar a API principal em 5000. Ela acessa o PostgreSQL local preexistente em 5435. Credenciais só em variáveis de ambiente do processo, obtidas da configuração local existente; não são parte da entrega. Para reproduzir, configure `ConnectionStrings__Postgres` por mecanismo local autorizado; nesta preparação foi acrescentado `Options=-c default_transaction_read_only=on` à conexão. Defina `PORT=5400`, `AllowedOrigins=http://127.0.0.1:3400,http://localhost:3400`, `MigrateOnStartup=false` e rode `dotnet run --project backend/src/RepBrasil.API`. Nenhuma migration ou ETL foi executada. A base de dados não é distribuída: outra máquina precisa de backend compatível autorizado; sem ele, os estados de indisponibilidade são parte do comportamento observável.

URLs públicas são compiladas no bundle; trocar NEXT_PUBLIC_API_URL requer novo build. A principal permanece na branch original e com seus arquivos locais; somente o commit de preservação autorizado alterou seu HEAD/index. ZIPs e logs locais anteriores permaneceram nela. Não se alteraram código, configurações do produto ou dependências durante a preparação.

## Validação desta worktree

Resultados e limitações finais serão registrados em `VALIDATION.md`, junto dos logs em evidence. Warnings de dependências descontinuadas durante npm ci são mantidos como observação, sem upgrade. Logs locais de servidor não são versionados. Os quatro espaços finais Markdown da prancha oficial aparecem em git diff --check; foram preservados, pois são quebras de linha do documento fornecido e esta missão não altera os originais.
