# Sistema de movimento do REPBrasil

> Apenas dados. Sem discursos. O movimento também não discursa: ele orienta.

Este documento descreve a linguagem de movimento do frontend do REPBrasil e serve de contrato para qualquer componente novo. A implementação vive em `frontend/src/motion/`.

## 1. Princípios

1. **Orientar antes de enfeitar.** Todo movimento responde a uma de três perguntas: *de onde eu vim*, *onde estou*, *para onde este dado me leva*. Se não responde a nenhuma, é removido.
2. **Zoom semântico.** O produto é uma sequência de camadas de informação (Brasil → UF → município → zona → seção → voto → pessoa → histórico público). Aprofundar e emergir têm gramáticas opostas e reconhecíveis; mudar de assunto no mesmo nível é lateral e curto.
3. **O movimento não mente.**
   - Nenhum número conta de 0 até X: valores oficiais aparecem prontos.
   - Nenhuma barra "enche" como se estivesse processando.
   - Nenhum dado de uma rota aparece sob o cabeçalho de outra (seção A ≠ seção B).
   - "Consultando" nunca se apresenta como "não encontrado", e falha nunca se apresenta como ausência.
   - A continuidade visual só conecta a **mesma entidade** (mesmo id). Nunca dados diferentes.
4. **Precisão, não espetáculo.** Sem quique, sem elástico, sem brilho decorativo, sem blobs, sem parallax gratuito, sem texto digitando, sem cursor customizado, sem sequestro de scroll.
5. **A ação nunca espera a animação.** A navegação acontece imediatamente; a transição acompanha. O foco nunca é atrasado.
6. **Reduced Motion é cidadão de primeira classe.** Com `prefers-reduced-motion: reduce`, nenhuma informação desaparece, nenhuma ação demora e nada depende de movimento.

## 2. Tokens

Fonte única: `src/motion/tokens.ts`. O CSS espelha os mesmos valores em `src/motion/motion.css` (`--motion-*`, `--ease-*`), e um teste (`tests/motion.test.tsx`) garante a paridade. **Não use números soltos**: use `duration.*`/`easing.*` em JS e `var(--motion-*)`/`var(--ease-*)` em CSS (inclusive em classes Tailwind: `duration-[var(--motion-acknowledge)]`).

### Duração — nomeada pelo papel, não pela velocidade

| Token | ms | Papel |
|---|---:|---|
| `acknowledge` | 90 | Confirmar um gesto: hover, foco, pressionar. |
| `settle` | 180 | Um elemento assume um novo estado: aba, filtro, seleção, dica. |
| `traverse` | 280 | Mudar de camada: rota, nível do território, drawer. |
| `reveal` | 420 | O documento se abre quando entra na leitura (scroll). |
| `survey` | 560 | Reposicionar a câmera sobre o território (mapa). |

### Curvas

| Token | cubic-bezier | Uso |
|---|---|---|
| `precise` | 0.2, 0, 0, 1 | Estados de UI (padrão). |
| `enter` | 0, 0, 0.12, 1 | Algo chega à leitura e desacelera até parar. |
| `exit` | 0.4, 0, 1, 1 | Algo sai da leitura sem demorar. |
| `traverse` | 0.65, 0, 0.35, 1 | Deslocamento espacial entre camadas; câmera do mapa. |

Nenhuma curva ultrapassa 0..1: dados oficiais não oscilam.

### Sequência

`stagger.step = 28ms`, aplicado só aos **8 primeiros** itens de uma lista (`.list-arrive`). Do nono em diante, os itens já estão lá: ninguém espera a lista "terminar de animar".

## 3. Springs

Não usamos springs. O único movimento "físico" do produto é o drawer móvel e a câmera do mapa; para ambos, uma curva de desaceleração (`enter`) com duração `traverse`/`survey` comunica massa sem oscilação. Se um dia houver manipulação direta (arrastar painel, gesto de fechar drawer), use um spring **criticamente amortecido** apenas nesse elemento, nunca em texto, números ou tabelas.

## 4. Gramática de profundidade (rotas)

`src/motion/depth.ts` define a camada de cada rota:

| Camada | Rotas |
|---:|---|
| 0 | `/` |
| 1 | `/politicos`, `/eleicoes`, `/manifesto`, `/suporte` |
| 2 | `/politico/[id]`, `/eleicoes/[ano]/[turno]` |
| 3 | UF |
| 4 | Município |
| 5 | Zona |
| 6 | Seção |

`directionBetween(de, para)` retorna `deeper`, `shallower` ou `lateral`. Exceção semântica: **do resultado eleitoral para o perfil é sempre `deeper`** (do voto para a pessoa o dado fica mais específico), e do perfil para o território é `shallower`.

| Direção | Camada que sai | Camada que entra |
|---|---|---|
| `deeper` | passa por nós (`scale 1 → 1.018`, some) | aproxima-se (`scale 0.985 → 1`) |
| `shallower` | recua (`scale 1 → 0.985`, some) | volta ao foco (`scale 1.012 → 1`) |
| `lateral` | some (`settle`) | aparece (`settle`) |

### Mecanismo

- `NavigationProvider` (em `app/providers.tsx`) expõe `navigate()`; `TransitionLink` é o `next/link` com essa gramática. Cliques modificados (nova aba, ctrl/cmd, botão do meio) seguem o comportamento nativo e o `href` continua real.
- Com suporte à **View Transitions API** e sem Reduced Motion, a troca acontece dentro de `document.startViewTransition`, com a direção em `<html data-nav-direction>` para o CSS. O push é imediato; a transição é liberada no commit da nova rota (ou após um teto de 1,2 s).
- Sem suporte (ou em voltar/avançar do navegador, que o App Router trata internamente), o quadro `[data-route-frame]` recebe uma entrada curta via WAAPI com a mesma gramática. Nada fica escondido à espera da animação.
- A navegação persistente (sidebar, topbar móvel) tem `view-transition-name` próprio e animação `none`: ela não participa da troca de conteúdo.
- **Dentro do explorador eleitoral** não há View Transition: a mudança de nível tem coreografia própria (painel + câmera do mapa), descrita na seção 7.

## 5. Elementos compartilhados

A identidade do político é o único elemento compartilhado entre telas:

- Origem: `PoliticianCard` (avatar e nome) e o nome do candidato em `SectionResults`. Elas carregam `data-vt="avatar"`/`data-vt="name"`, mas só recebem `view-transition-name` **no instante do clique** (`TransitionLink shareIdentity`). Nunca nomeie uma lista inteira.
- Destino: o cabeçalho do perfil (`IDENTITY_VT.avatar`/`IDENTITY_VT.name`), presente também no estado de carregamento.
- `rememberIdentity(id, nome)` guarda em memória o nome exibido na origem. O carregamento do perfil o usa para manter a pessoa no lugar enquanto os dados oficiais chegam. É a mesma entidade, pelo mesmo id; nenhum outro dado é antecipado (cargo, partido, números e abas aguardam a fonte).

## 6. Revelação na leitura (scroll)

`Reveal`/`useReveal` (`src/motion/reveal.tsx`) usam **um único `IntersectionObserver`** para a página e não guardam estado React (zero re-render durante o scroll). O elemento passa de `data-reveal="pending"` para `"in"`; o CSS diz o que isso significa para cada peça:

| Classe | Significado | Uso |
|---|---|---|
| `.reveal-unfold` | o documento se abre de cima para baixo (`clip-path`) | cartões de capacidade |
| `.reveal-rule` | régua traçada da esquerda (`scaleX`) | linha de base de um número |
| `.reveal-rule-out-left/right` | réguas a partir do centro | enquadrar uma afirmação |
| `.reveal-value` | o valor sobe já pronto por trás de uma máscara | números institucionais |
| `.reveal-connector` / `-v` + `.reveal-node` | uma linha percorre e acende cada nó | cadeia de procedência |

`--i` (custom property) ordena a sequência dentro de um grupo.

**Garantias:** o estado escondido só existe sob `prefers-reduced-motion: no-preference` **e** com `html.js` (marcado por um script inline antes da primeira pintura). Sem JS, sem hidratação ou com Reduced Motion, tudo está visível. Um failsafe em CSS revela qualquer peça ainda pendente após 2,5 s.

Scroll é sempre nativo. Não há animação ligada ao scroll frame a frame: nenhuma seção atual precisa disso para ser compreendida.

## 7. Coreografias por área

### Home

A página explica o produto com o que está importado, não com promessa:

1. **Busca como instrumento central.** O `<h1>` é renderizado completo no servidor (nada de texto digitando, o que preserva LCP e leitores de tela) e a busca global fica logo abaixo, com exemplos neutros (lugares e cargos).
2. **Cobertura real** (`GET /api/v1/overview`): eleições com Boletim de Urna importado, o caminho estado → municípios → zonas → seções com os números do pleito mais recente e as bases oficiais com a data do download. Enquanto carrega, esqueletos com a geometria final; os números aparecem prontos, nunca contam. Sem a cobertura, a página diz o que houve e oferece tentar de novo — o resto continua.
3. **Raio X e limitações:** texto estático e imóvel. As limitações são um compromisso, não um efeito.
4. **Microinteração:** a seta aponta o destino e pressionar escurece o tom. Nada muda de tamanho ou de lugar.

### Busca

- **Busca global** (barra lateral, ícone no celular, atalhos `/` e Ctrl/⌘+K): diálogo nativo (`<dialog>`, foco preso, Esc fecha) com combobox WAI-ARIA. A primeira opção já vem ativa, as setas percorrem os grupos e Enter abre. Enquanto a consulta pendente não chega, um traço percorre a base do campo e esqueletos ocupam o lugar das linhas — o resultado anterior some na hora.
- **Intenção:** enquanto a consulta está de fato pendente (debounce), um traço percorre a base do campo, e leitores de tela recebem o mesmo estado.
- **Consulta:** esqueletos com a geometria exata do cartão (sem CLS) e uma linha de status que diz o que acontece ("Consultando a base por …"). Nunca um spinner genérico, e nunca resultados antigos sob uma consulta nova.
- **Resultados:** os oito primeiros chegam em sequência curta.
- **Entidade:** o cartão entrega avatar e nome ao perfil.

### Perfil

- O cabeçalho (identidade) nunca se move entre abas.
- As abas são camadas do mesmo documento: o indicador desliza até a aba escolhida (só `transform`) e o conteúdo entra pelo lado da direção da escolha (`settle`). Semântica WAI-ARIA completa e teclado (←/→, Home/End).
- `?aba=eleicoes` abre direto em Desempenho, sem passar pela Visão Geral.
- Os cartões-resumo distinguem **consultando**, **indisponível** (falha) e **não encontrado** (ausência confirmada).
- Score, patrimônio e barras são estáticos: nada enche, nada conta.

### Eleições

- **Painel:** muda de nível pelo lado da direção (aprofundar entra pela direita, emergir pela esquerda). Na mesma camada (outra zona da lista), só uma troca curta de opacidade. O conteúdo anterior nunca permanece: só a entrada é animada.
- **Trilha territorial:** o segmento acrescentado se estende (`clip-path`); ao voltar, os segmentos removidos somem instantaneamente.
- **Mapa:** a câmera (`fitBounds`) usa `survey` com a curva `traverse`, e com Reduced Motion vira um corte seco. Os locais de votação surgem por transição de opacidade depois que a câmera assenta (`idle`): consequência da escolha, não explosão. Hover é instantâneo. Nada compete com zoom, arrasto ou toque.
- **Seção:** cabeçalho da seção pedida desde o primeiro quadro. O esqueleto tem a geometria real e mostra rótulos fixos (Aptos, Comparecimento…), mas nenhum número. Os valores aparecem prontos (opacidade) e os votos chegam em sequência curta. A defesa contra dado velho (identidade territorial do resultado = rota atual) continua no `ElectionsExplorer`.
- **Candidato → perfil:** o nome do candidato é o elemento compartilhado com o `<h1>` do perfil, e o perfil abre em Desempenho eleitoral. É o caminho do voto à pessoa e ao histórico público.

### Dados (explorador territorial)

Um mapa persistente de Brasil → UF → município (`src/components/territory/TerritoryCanvas.tsx`, peças em `engine.ts`). Toda transição vem de `src/motion/map.ts`, que lê os tokens:

- **Câmera:** Brasil → UF com `survey`, UF → município com `traverse`, sempre com a curva `traverse`. Reduced Motion corta seco.
- **Troca de camada** (outro indicador, ano, cargo ou modo): transição cruzada entre duas camadas de cor (A/B) por opacidade (`traverse`). A câmera e a seleção ficam onde estão.
- **Holofote:**
  - com uma UF escolhida, o resto do Brasil recua sob um véu;
  - com um município escolhido, os outros municípios recuam;
  - no hover, o véu acompanha o território apontado, entrando com atraso `acknowledge` para não piscar ao passar.
- **Contorno revelado:** ao escolher território, o contorno teal se traça (largura `reveal`, opacidade `settle`). O teal é cor de interação, nunca cor de dado.
- **Pulso:** um anel único nos maiores valores, só em grandeza somável (pessoas, R$, emendas) e só quando o dado chega. Nunca em laço; com Reduced Motion não existe.
- **Relevo 3D** (plano Avançado):
  - altura proporcional ao valor, com a nota na legenda;
  - a câmera se inclina com `survey`;
  - não existe no celular (ponteiro grosso ou tela estreita).
- **Intensidade** (plano Avançado): mapa de calor a partir de pontos internos calculados da malha oficial, só em grandeza somável. A cor das classes recua.
- **Antes/depois** (plano Avançado):
  - um segundo mapa, só de leitura, sob o divisor, com a câmera do principal;
  - o divisor é um `input range` (teclado: setas);
  - no mesmo indicador, a escala é comum aos dois lados.
- **Rótulo:**
  - fica dentro do mapa e evita cobrir a seleção (`placeTooltip`);
  - o hover na tabela mostra o rótulo no ponto interno do território, e o hover no mapa destaca a linha da tabela.
- **Gestos cooperativos:** rolar a página sobre o mapa não vira zoom (Ctrl/⌘ + rolagem; dois dedos no celular).
- **Texto e números:**
  - a leitura rápida entra com `reveal-unfold` em sequência curta quando o recorte muda;
  - o valor do território troca por `value-swap`, pronto e sem contagem;
  - a trilha territorial estende o segmento novo (`crumb-extend`).
- **Elemento compartilhado:** o nome do território no link do painel segue para o `<h1>` do perfil do município ou da UF (`data-vt="name"` → `vt-name`).

### Navegação

- **Marcador da seção atual:** estende-se verticalmente.
- **Drawer móvel:**
  - chega desacelerando e sai acelerando, sem quique;
  - quando fechado é `inert`, então os links escondidos não recebem foco;
  - Esc fecha;
  - o foco entra no drawer ao abrir e volta ao botão ao fechar.

### Apuração — Modo Apresentação (telão)

Rota `/apuracao/2026/presidente/segundo-turno/apresentacao`. É um palco fixo (`100dvh`, sem rolagem), a única tela do produto que é assim de propósito. Código em `src/components/live-election/presentation/`.

Regra: **dado primeiro, cena depois.** Todo valor novo já entra renderizado no commit em que chega pelo stream. O efeito apenas sinaliza a mudança depois disso: nada conta, nada enche e nada atrasa o número.

| Nível | Faixa | Onde | Token |
|---|---|---|---|
| MICRO | 100–250 ms | valor que mudou: chega pronto (`pm-arrive`, 180 ms) e um traço curto aponta a mudança (`pm-trace`, 240 ms), dentro dos 120–250 ms da atualização numérica; hover das células de UF | `settle` (180) |
| UI | 180–350 ms | célula de UF selecionada (sobe 0,6u); opacidade das outras UFs no mapa em foco; transições de sombra e fundo | `traverse` (280) |
| CENA | 350–650 ms | UF em foco sobe no mapa (`pm-lift`); painel da UF entra (`pm-enter`); banners (`pm-banner`); cor das UFs (`fill`); troca de liderança (`pm-pulse` + `pm-sweep`); véu de definição ou final (`pm-veil`) | `reveal` (420), `survey` (560) |
| Ambiente | contínuo | ticker (linear, duração em degraus de 15 s); barra de permanência da vista (linear, igual ao tempo configurado); ponto AO VIVO (2 s); luz do palco que respira (14 s, só ao vivo) | — |

**Gatilhos**

- **Troca de liderança nacional.** O novo líder já está na tela (selo NA FRENTE/ATRÁS e régua) quando a cena começa. Então o divisor central da régua pulsa e uma varredura atravessa o mapa (560 ms). A fica sempre à esquerda e B à direita: a liderança muda a hierarquia, nunca o lado.
- **md = e** (sinal oficial do TSE). Véu curto e banner por 9 s. O selo ELEIÇÃO DEFINIDA e o item do ticker permanecem. A validação independente do REPBrasil nunca aciona essa cena.
- **FINAL.** Véu e banner por 9 s. "AO VIVO" sai do cabeçalho e do ticker; a vantagem passa a se chamar "DIFERENÇA FINAL".
- **Fonte parada** (`LIVE_STALE`). Aviso âmbar permanente. Os números continuam na tela: são os últimos válidos.
- **Rotação editorial.** Visão nacional por 25 s, depois até 5 UFs por 10 s cada (atualização recente → disputa mais apertada → sequência por eleitorado) e volta ao nacional. A rotação só escolhe o que mostrar: nenhuma projeção.
  - Ajustes: `?nacional=`, `?estado=`, `?estados=`, `?rotacao=0`.
  - Teclas: Espaço pausa, A liga ou desliga a rotação, ←/→ trocam de UF, R volta ao nacional.

**Fallback**

- **Efeitos reduzidos.** Com `prefers-reduced-motion: reduce` ou `?efeitos=reduzidos` saem perspectiva, paralaxe, luz, véu, varredura, pulso e subida. Valores, mapa e hierarquia ficam iguais.
- **Aparelho lento.** O palco mede os quadros durante 4 s depois da entrada. Abaixo de 32 fps, passa sozinho para efeitos reduzidos.
- **Custo de animação.** Só `transform` e `opacity` animam; o `fill` das UFs é uma transição de cor, sem layout. Nenhum estado React muda por quadro: a paralaxe grava variáveis CSS no máximo uma vez por quadro.
- **Mouse parado.** Cursor e controles somem depois de 3,5 s, e o realce de passagem no mapa também desliga. Um mouse esquecido sobre o mapa não deixa uma UF marcada no telão.

## 8. Microinterações (classes utilitárias)

| Classe | Comportamento |
|---|---|
| `.mi-surface` | borda/fundo mudam e um marcador de canto aparece em hover, foco ou `aria-current`. A geometria nunca muda. |
| `.mi-arrow` | só o ícone desloca 2 px na direção do destino. |
| `.mi-press` | pressionar escurece o tom e insere uma sombra interna. O tamanho não muda. |
| `.mi-underline` | sublinhado traçado a partir da esquerda. |
| `.mi-hint-host` + `.mi-hint` | dica acessível por hover **e foco**. |
| `.focus-ring` | foco sempre visível e imediato (nunca animado). |
| `.segmented` + `.segmented-item` | controle segmentado (modo e vista do mapa): a opção escolhida (`aria-pressed`) ganha superfície e contorno; a cor troca (`settle`), o tamanho não. Opção indisponível fica esmaecida, com o motivo no título. |

**Regra:** hover indica "isto é interativo". Nada de "olha uma animação": nenhum hover move o layout, nenhum botão pula.

## 9. Estados de consulta

| Classe | Uso |
|---|---|
| `.skeleton` | esqueleto estrutural, com respiração lenta e rasa (sem "AI shimmer"). Deve ter a geometria do conteúdo real. |
| `.query-trace` | consulta em andamento: um traço percorre a régua (indeterminado e honesto). |
| `.list-arrive` | primeiros itens de uma lista que acabou de chegar. Use `key` com a identidade da consulta para não reaproveitar a lista anterior. |
| `.value-arrive` | valor oficial que passou a estar disponível: aparece pronto. |
| `.value-swap` (`SwapValue`) | valor que muda de contexto (outro território, indicador ou ano): sobe pronto por trás de uma máscara (`settle`). Nunca conta. |
| `useActionFeedback` | ação curta (baixar arquivo): "em andamento" → "concluído" (volta ao repouso) ou "erro" (fica até a próxima ação), com aviso `role="status"`. |

## 10. Desempenho

- Anime apenas `transform`, `opacity` e `clip-path`. O indicador de aba usa uma base de 100 px com `scaleX`, nunca `width`.
- Nenhum `setState` por frame. A revelação não usa estado React; o painel e as abas usam WAAPI pontual em `useLayoutEffect`.
- Um único `IntersectionObserver`. Nenhum listener de scroll.
- Nenhuma dependência nova: CSS + View Transitions nativas + WAAPI.

## 11. Reduced Motion

- O CSS desliga as View Transitions, o drawer, as abas, a navegação, as dicas, as entradas e as revelações. Os estados escondidos simplesmente não existem.
- Em JS, `prefersReducedMotion()`/`useReducedMotion()` (`src/motion/reduced-motion.ts`, via `useSyncExternalStore`) fazem `navigate()` não iniciar View Transition, o painel e as abas não animarem, e a câmera do mapa cortar seco. Os locais aparecem de imediato.
- No mapa territorial, `cameraMotion`/`paintTransition` devolvem duração 0 e `pulseMotion` devolve nulo.
- Testes: `tests/motion.test.tsx`, `tests/electoral-tab.test.tsx` e `tests/territory-lib.test.ts`.
- Modo Apresentação:
  - `tests/live-presentation.test.tsx` (regras de fase, md = e, placar, rotação, ticker e atalhos);
  - `.github/scripts/presentation-local.mjs` (Playwright: cenários, tamanhos de tela, latência SSE → DOM, reconexão, teclado e Reduced Motion).

## 12. Antipadrões (não fazer)

- Um wrapper genérico de "fade out / fade in" para toda rota.
- `opacity: 0; translateY(20px); 0.5s` repetido em tudo; stagger em tudo.
- Contar números; barras que enchem; gráficos que "processam".
- Manter o dado da tela anterior enquanto a nova rota já está identificada.
- Spring em texto, números, tabelas ou transições de rota.
- Glow, blur, blobs, gradientes em texto, cards flutuantes, parallax decorativo.
- Animar `height`/`width`/`top`/`left` continuamente; `setState` em scroll.
- Atrasar foco ou ação para esperar animação.
- Nomear com `view-transition-name` todos os itens de uma lista.

## 13. Checklist para um componente novo

- [ ] O movimento responde a "de onde vim / onde estou / para onde vou"?
- [ ] Usa tokens (`--motion-*`, `--ease-*`) e classes do sistema?
- [ ] Anima só `transform`/`opacity`/`clip-path`?
- [ ] Com Reduced Motion, está tudo visível e funcional?
- [ ] O estado de carregamento tem a geometria do conteúdo e não afirma nada falso?
- [ ] Nenhum dado de outra entidade/rota aparece durante a transição?
- [ ] Teclado e leitor de tela continuam corretos?
