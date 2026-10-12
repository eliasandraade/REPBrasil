# Auditoria e direção de experiência · 11/10/2026

## Estado inspecionado antes da implementação

Branch de origem: feat/product-readiness-review, com alterações locais preexistentes. Trabalho continua em codex/repbrasil-experience, preservando essas alterações. Backend, ETL, banco e contratos permanecem como fonte de verdade.

| Área | Evidência e decisão |
| --- | --- |
| Arquitetura | Next 15 / React 19 / TypeScript / Tailwind / TanStack Query. Preservar caches, queries e separação domínio/apresentação. |
| Rotas | Home, catálogo eleitoral, rota territorial persistente, comparação, busca de políticos, perfil por slug, manifesto, glossário, suporte. Preservar URLs e deep links; reorganizar navegação por tarefa. |
| Dados | API .NET 8 read-only, PostgreSQL/PostGIS, ETL com proveniência. Pessoa, candidatura e voto são entidades distintas. Não produzir inferências novas no frontend. |
| Home | Hero centralizado, grid decorativo, listas explicativas e cards repetidos. Reconstruir como entrada territorial com cobertura e tempo derivados da API. |
| Marca | BrandMark atual desenha uma urna, usa wordmark tipográfico e verde #0dd48e. Substituir pela arte fornecida e tokens oficiais. O ZIP só contém pranchas PNG, não masters separados. Usar recortes de exibição da própria prancha, sem redesenho ou recoloração; registrar limitação de entrega vetorial. |
| Mapas | MapLibre 6.13 já instalado; instância persistente, fitBounds, feature-state, import dinâmico, listas alternativas. Preservar engine e geometria IBGE. Malha municipal somente CE. Melhorar hierarquia, contexto e falha de inicialização. Não extrudar votos: altura introduziria leitura quantitativa não solicitada. |
| Câmera | Bounds reais; enquadramento responsivo; reduced motion. Coordenar seleção e contexto sem remount em cada rota. Manter zoom geográfico real. |
| Busca | Command palette com Ctrl/Cmd K, debounce, cancelamento, grupos e teclado. Preservar lógica e promover acesso no shell. |
| Perfis | Cabeçalho eleitoral, histórico, território, patrimônio, contas, fontes; estados explícitos. Reconstruir hierarquia como documento de investigação, evitando caixas dentro de caixas. |
| Comparação | Até cinco candidaturas, CSV, URL compartilhável, estados de comparabilidade da API. Promover a tarefa na navegação, preservar cálculo e semântica. |
| Motion | Tokens, View Transitions, tabs, reduced motion e testes de paridade já existem. Refinar tempos e cores; não adicionar GSAP/Three/Motion redundantes. |
| Responsividade | Sidebar 224px e drawer; mapa fica abaixo da lista no mobile. Substituir por navegação superior e navegação mobile direta; mapa primeiro e painel contextual acessível. |
| Estados | DataState separa erro, vazio, sem cobertura e carregamento. Preservar; home deve funcionar também sem API, com geografia explicitamente separada de resultados. |
| Integridade | Texto estático de 1.000 políticos não consulta catálogo. Remover a afirmação fixa. Destaque cromático de eleito/não eleito não deve sugerir aprovação. |
| Performance | Nenhuma medição de campo disponível. Node 22 presente, dependências ainda não instaladas no início. Medir build e executar suite local; não alegar CWV/GPU de produção. |

## Nova arquitetura de experiência

Explorar (território como entrada), Eleições (tempo e cobertura), Pessoas (identidade e investigação), Comparar (diferenças documentadas). Fontes, metodologia, glossário e suporte ficam no contexto de leitura. Marca clara em barra institucional; área de análise em azul profundo oficial, bordas discretas, teal apenas para interação. Cena: leitor alterna pesquisa textual e mapas em monitor de trabalho; uma barra clara orienta a navegação e a superfície cartográfica escura mantém limites territoriais e seleções legíveis sem brilho decorativo.

Mapa e lista são caminhos equivalentes. Nenhum ano, resultado ou contagem será inventado para preencher a composição. A geografia pode continuar visível durante falha da API, identificada como geografia sem confirmação de cobertura. Zero só aparece se fornecido pela API.

## Decisão técnica

MapLibre oferece câmera geográfica, GPU e continuidade já integradas. Three/R3F duplicariam renderização e gestão de contexto; Deck.gl adicionaria custo sem volume de pontos que o justifique; D3 é útil para gráficos, mas as visualizações atuais não exigem outra dependência. Motion nativo/CSS e View Transitions continuam suficientes. Fontes primárias consultadas: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/ e https://rsms.me/inter/.

## Budgets e validação

Metas, não medições: LCP ≤2,5s, INP ≤200ms, CLS ≤0,1 em campo; respostas visuais de controles ≤180ms; câmera ≤360ms; sem loops de renderização permanentes; uma instância MapLibre por explorador; import pesado sob demanda; fonte local com swap. Registrar bundle do build, testes, lint, typecheck, inspeção browser desktop/mobile e limitações de ambiente ao encerrar.

## Implementação e evidências

- Shell reconstruído com quatro destinos, busca global e navegação inferior mobile.
- Home substituída por atlas WebGL, seleção de UF por mapa/lista, pesquisa local sem acentos, régua de eleições e cobertura retornadas pelas APIs existentes.
- Instância territorial movida para o layout de ano/turno, acima do segmento geográfico variável. Resultados de seção sobrepostos sem desmontar o mapa; canvas fica inert e aria-hidden enquanto o resultado está aberto.
- Contexto estadual permanece visível; malha municipal ausente tem aviso. Câmera usa bounds IBGE, 360ms ou zero em reduced motion.
- Perfis com hierarquia documental, registros eleitorais, visão geral em duas colunas no desktop e uma no mobile. Nenhuma mudança de cálculo.
- Catálogo em linhas temporais; comparação promovida na navegação, preservando matriz, CSV, URL e alertas de comparabilidade.
- Paleta oficial, Inter Variable hospedada localmente, estados de foco, mapa em escala sequencial neutra, resultado eleito/não eleito sem cor de aprovação.
- Bordas inválidas border-white/8 corrigidas para opacidade explícita. Controles cartográficos de 44px. Seletor compacto de camadas em mobile.
- Busca: foco aplicado após abertura do diálogo, corrigindo Ctrl+K que focava o botão de fechar.
- Marca: extração de pixels originais da prancha oficial para símbolo micro sem mapa, wordmark e favicon. Script e manifesto de coordenadas/hash em frontend/scripts/extract-official-brand.mjs e frontend/public/brand/provenance.json. Nenhuma geração, traçado, recoloração ou recomposição tipográfica. Masters SVG/PNG separados continuam ausentes do material fornecido.

### Verificação local

106 testes passaram em 8 arquivos, incluindo retenção do contêiner cartográfico ao abrir/fechar seção, troca temporal sem mostrar a cobertura de outra eleição, integridade de seção e reduced motion. A suite emite um aviso conhecido de navegação não implementada no jsdom; não é falha de teste.

TypeScript e lint passaram. Build Next de produção concluído antes da última revisão mobile e repetido após os ajustes finais; consultar registro final abaixo. Nenhuma dependência de runtime adicionada.

API .NET iniciada contra o contêiner local preexistente repbrasil-pg-dev, com migração desabilitada. Nenhum backend, banco, ETL ou contrato alterado; nenhum mock substitui as integrações do produto. Dados observados são da base local, não uma auditoria independente dos arquivos do TSE.

Browser: home e seleção do Ceará; Ceará → Fortaleza → Zona 094; busca por Ctrl+K, consulta e Enter para perfil; histórico e comparação de duas candidaturas; aviso de cargos diferentes; navegação inferior mobile. Viewports 1440×900 e 390×844. Na comparação mobile, documento com 375px de conteúdo em viewport de 390px, tabela de 640px contida em área rolável de 343px. Console sem erros/avisos na passagem inspecionada.

Contraste calculado dos tokens opacos: texto secundário #A9BBCB entre 6,90:1 e 8,91:1; texto auxiliar #9CAFC1 entre 6,03:1 e 7,79:1; teal #00BAA6 entre 5,55:1 e 7,17:1 sobre as três superfícies oficiais escuras. Isso não constitui auditoria automática de cada pixel/estado.

Malhas locais: 99.412 bytes (UFs) e 101.123 bytes (municípios CE). Inter Variable: 352.240 bytes. Os recortes de marca carregados são menores que a prancha de 1,46MB, que não é usada como imagem no shell final.

### Limites de evidência

Sem medição de CWV em campo, FPS/GPU em aparelho físico, TalkBack/VoiceOver ou dispositivos reais. Reduced motion coberto pela suite e regras CSS/JS; preferência do sistema não foi alterada durante a inspeção de navegador. Malhas municipais seguem disponíveis somente para CE. Demais estados dependem da cobertura existente. Sem publicação, merge ou push.

### Registro final — 12/10/2026

Build final de produção aprovado, incluindo lint e verificação de tipos. Logs preservados em `validation-build.log` e `validation-tests.log`: 106 testes aprovados em 8 arquivos. First Load JS informado pelo Next: home 129 kB, catálogo 120 kB, comparação 127 kB, perfil 145 kB; o valor do segmento territorial isolado não representa todo o mapa carregado dinamicamente.

Na retomada, frontend reiniciado em http://127.0.0.1:3000. Ctrl+K confirmado com foco no INPUT de role combobox; fechar retorna o foco ao botão de busca. Home mobile verificada em 390×844, com scrollWidth de 390px (sem transbordamento horizontal). Capturas: [desktop](screenshots/repbrasil-desktop.jpg) e [mobile](screenshots/repbrasil-mobile.jpg).

O Docker Desktop falhou ao iniciar nesta retomada: `initializing Ingest server ... sailor-ingest.sock ... The file cannot be accessed by the system`. A API e o banco local não puderam ser restabelecidos. As capturas finais mostram geografia oficial e indisponibilidade explícita de cobertura, sem dados substitutos. As passagens de perfil, comparação e navegação territorial descritas acima foram verificadas anteriormente com a API ativa; a revisão final do seletor mobile de camadas com dados permanece pendente da recuperação do Docker. Nenhum reset, remoção de volumes ou alteração do banco foi realizado.

### Recuperação e fechamento da pendência — 12/10/2026

Após o usuário informar que o Docker voltou, o contêiner existente `repbrasil-pg-dev` foi iniciado e a API reconectada com migrações desabilitadas. Home voltou a carregar catálogo e cobertura da base local. A navegação home → Ceará e a troca para “Intensidade de votos” foram verificadas em 390×844: seletor compacto funcional, contexto municipal visível e orientação para escolher candidatura antes de mapear votos. Documento com 375px em viewport de 390px, sem transbordamento horizontal. Console sem erros ou avisos na passagem. A pendência do seletor mobile está encerrada.

Evidências adicionais: [camadas mobile](screenshots/repbrasil-camadas-mobile.jpg) e [home desktop com dados](screenshots/repbrasil-desktop-com-dados.jpg). Capturas anteriores foram preservadas como registro do estado de indisponibilidade. Frontend e API deixados ativos para revisão local. Permanecem apenas os limites de validação em dispositivos físicos, leitores de tela e métricas de campo já descritos.
