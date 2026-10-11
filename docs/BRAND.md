# REPBrasil — Marca no produto

Implementação, no produto digital, do **Brand Kit Oficial** (identidade aprovada e congelada). Em identidade
visual, o Brand Kit vence. Este documento diz como ele foi aplicado, onde estão os assets e quais pontos
dependem de decisão do proprietário.

- Fonte: `REPBrasil_Brand_Kit_Official.zip` (SHA-256 `c4213a8f…e2097`), com manual
  (`REPBrasil_Brand_Kit.md`, SHA-256 `b8bc7667…4401c`), tokens (`repbrasil-design-tokens.json`,
  `repbrasil-tokens.css`) e quatro quadros PNG.
- **Quadro oficial de diretrizes** (`brand-guidelines.png`, 1448×1086, SHA-256 `1884bd87…0c1`): versões do
  logo, versões responsivas, monocromáticas, aplicações em fundo, ícone, área de respiro, usos incorretos.
  É a ÚNICA origem dos assets do produto.
- **Concept boards** (referência, não especificação; não versionados no repositório):
  `brand-applications.png` (brindes, sinalização), `brand-product-digital.png` (papelaria), 
  `brand-content-media.png` (telas ilustrativas — números, gráficos e "Candidato A/B" ali são fictícios).

## 1. Conceito

**O Brasil no centro da análise.** Descriptor: **INTELIGÊNCIA ELEITORAL**. Princípios: inteligência,
transparência, brasilidade, credibilidade, neutralidade política, agilidade, clareza.

O produto deve parecer um centro brasileiro de inteligência eleitoral — não governo, partido, campanha,
propaganda, template SaaS, dashboard genérico ou produto "feito por IA". **O dado é protagonista.**

## 2. Nome

Grafia corrente: **REPBrasil** (sem espaço; nunca "REPBRASIL", "Repbrasil" ou "Rep Brasil" em texto
institucional). Na assinatura gráfica, "REP" forte e "Brasil" leve — **asset**, nunca recomposto com fonte.

## 3. Monograma e assinaturas

Monograma **R + B** (REP + Brasil), lado esquerdo do R fechado, Brasil em espaço negativo (versões com mapa).
Nunca reabrir, rotacionar, esticar, comprimir, inverter, aplicar contorno, glow, sombra forte ou 3D; nunca
adicionar urna, estrela, bandeira, Congresso, brasão ou símbolo político.

| Assinatura | Componente | Arquivo |
|---|---|---|
| `[RB] REPBrasil` + `INTELIGÊNCIA ELEITORAL` | `<Logo variant="signature">` | `logo-primary.png` / `logo-primary-negative.png` |
| `[RB] REPBrasil` (reduzida) | `<Logo variant="horizontal">` | `logo-horizontal.png` / `logo-horizontal-negative.png` |
| `[RB]` com mapa (≥ 64px) | `<Logo variant="symbol" height≥64>` | `symbol.png` |
| `[RB]` micro sem mapa (24–63px) | `<Logo variant="symbol" height<64>` | `symbol-micro.png` |
| Favicon sem mapa (16–31px) | metadados do layout | `favicon.ico`, `favicon-16.png`, `favicon-32.png` |
| Monocromáticas (azul profundo, preto, branco) | aplicações de exportação/impressão | `logo-monochrome-{navy,black,white}.png` |

### Sistema responsivo (aplicado em código, `src/components/brand/Logo.tsx`)

| Faixa | Versão | Mapa |
|---|---|---|
| ≥ 128px | principal | sim |
| 64–127px | compacta (principal reduzida) | sim |
| 32–63px | micro | não |
| 16–31px | favicon | não |

Tamanhos mínimos: assinatura completa **160px** de largura; sem descriptor **112px**; símbolo com mapa
**64px**; micro **24px**; favicon **16px**. O componente eleva a altura ao mínimo oficial (nunca "esmaga").

Navegação: desktop (barra lateral) = assinatura reduzida, 34px de altura, com área de proteção; tablet
(barra superior) = assinatura reduzida, 32px; celular = símbolo micro, 32px. Rodapé da home = assinatura
completa (52px de altura ≈ 185px de largura).

### Área de proteção

X = largura da haste vertical principal do R (74px no quadro, para um símbolo de 283px ⇒ X ≈ 0,26 da
largura do símbolo). Mínimo **1X** (`clearSpaceIncluded`), preferencial **1,5X** em peças institucionais.

### Versão negativa

Sobre fundo escuro: mesmo símbolo (cores inalteradas; o mapa permanece branco, como nas aplicações oficiais
sobre azul profundo) e wordmark/descriptor brancos ("assinatura clara aprovada").

## 4. Assets do produto (`frontend/public/brand/`)

Derivados por `frontend/scripts/brand/derive_assets.py`, que confere o SHA-256 do quadro oficial e só
**recorta, separa o fundo branco em transparência e redimensiona** — nada é desenhado. Decisões mecânicas:

- o mapa (região branca fechada dentro do R) fica **branco opaco**; os vãos entre as fitas do R e do B são
  espaço negativo (transparentes);
- a assinatura reduzida é o símbolo + wordmark do lockup principal, na mesma escala e com o mesmo
  espaçamento, wordmark centrado verticalmente no símbolo;
- monocromia vem das versões monocromáticas oficiais (redesenhadas pelo Brand Kit); a branca é a azul
  sólida com a tinta trocada por branco (arte de uma cor só) — nunca a versão colorida convertida;
- ícones de app: símbolo com mapa sobre branco (como o ícone claro do quadro); maskable com o símbolo a 56%
  para caber no círculo seguro de 80%.

Proveniência por arquivo em `public/brand/assets.json`. Reexecutar:

```bash
cd frontend
python -I scripts/brand/derive_assets.py <REPBrasil_Brand_Kit_Official/assets/brand-guidelines.png> public/brand
```

## 5. Cores

### Marca (fixas)

| Token | Hex | Papel |
|---|---|---|
| `--brand-navy` | `#0B2D5B` | estrutura, confiança, institucionalidade — **domina** |
| `--brand-teal` | `#00BAA6` | tecnologia, **interação** (foco, seleção, indicadores) |
| `--brand-green` | `#0F9D58` | território/crescimento — uso moderado e semântico |
| `--brand-white` | `#FFFFFF` | clareza, espaço negativo |

O teal oficial é **`#00BAA6`** (manual e tokens). O quadro de diretrizes imprime `#00B4A6` — valor antigo,
não usado (teste `tests/brand.test.tsx` falha se aparecer). Sem verde + amarelo em superfícies extensas,
sem bandeira, sem estética governamental.

### Neutros e semânticos (claro / escuro)

| Token CSS | Tailwind | Claro | Escuro |
|---|---|---|---|
| `--canvas` | `bg-canvas` | `#F5F8FB` | `#071A2E` |
| `--surface` | `bg-surface` | `#FFFFFF` | `#0D2744` |
| `--surface-subtle` | `bg-subtle` | `#EEF3F7` | `#102F50` |
| `--text-primary` | `text-fg` | `#0B1F33` | `#F7FAFC` |
| `--text-soft` | `text-fg-soft` | `#2B4157` | `#D5E0EA` |
| `--text-secondary` | `text-fg-muted` | `#5F7184` | `#A9BBCB` |
| `--border` | `border-line` | `#DCE5ED` | `#1D3A56` |
| `--border-strong` | `border-line-strong` | `#B8C7D5` | `#2E5379` |
| `--focus` | `ring-focus` | `#00BAA6` | `#23D6C2` |
| `--accent` | `bg-accent` | `#00BAA6` | `#00BAA6` |
| `--accent-text` | `text-accent-text` | `#00756A` | `#23D6C2` |
| `--action` / `--on-action` | `bg-action text-action-fg` | navy / branco | teal / `#071A2E` |
| `--warn`, `--danger`, `--info`, `--positive` | `text-warn`… | `#8A4B00`, `#B42318`, `#1D5FA8`, `#0B7A44` | `#F5B544`, `#FF8A80`, `#7CB4F0`, `#4CC38A` |

Tokens guardam canais RGB (`11 31 51`) para o Tailwind compor opacidade (`text-fg/80`). Componentes não
usam hex quando existe token. Estados (`warn`, `danger`…) nunca aparecem sozinhos: sempre com rótulo.

### Acessibilidade (WCAG AA verificado em teste)

`tests/brand.test.tsx` calcula o contraste de todo token de texto sobre canvas, superfície e sutil, nos dois
temas. Três ajustes de **uso** (nenhuma cor da paleta mudou):

1. **Texto interativo no claro:** teal `#00BAA6` tem 2,3:1 sobre o canvas — reprovado como texto. Links e
   texto interativo usam `--accent-text` `#00756A` (5,25:1); o teal oficial continua em preenchimentos,
   indicadores e foco.
2. **Anel de foco:** teal (marca) + núcleo navy (claro) / canvas (escuro) — contraste ≥ 3:1 em qualquer fundo.
3. **Secundário sobre sutil:** `#5F7184` sobre `#EEF3F7` = 4,495:1. Só nessa combinação, no claro, o texto
   secundário usa `#5C6E81` (4,7:1).

## 6. Tipografia

**Inter Variable** (OFL), servida do próprio domínio (`@fontsource-variable/inter` + `next/font/local`): sem
chamada a terceiros em tempo de execução. Pesos: display 700–800, H1/H2 650–750, H3/H4 600–700, rótulos
550–650, corpo 400–500, dados 500–600 com numerais tabulares (`.tabular`, tabelas).
Tracking: títulos −0,02em a −0,01em; corpo 0; caixa alta 0,06em–0,12em. Corpo base 16px.

Escala (Tailwind `text-*`): `display-xl` 56/64, `display-lg` 44/52, `heading-xl` 36/44, `heading-lg` 30/38,
`heading-md` 24/32, `heading-sm` 20/28, `body-lg` 18/28, `body-md` 16/24, `body-sm` 14/20, `label` 12/16,
`micro` 11/14.

## 7. Espaço, raio, sombra

- Espaçamento base 4px: a escala do Tailwind **é** a escala da marca (1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32,
  10=40, 12=48, 16=64, 20=80, 24=96); variáveis `--space-*` para CSS fora do Tailwind.
- Raios: `rounded-lg` 8 (sm) · `rounded-xl` 12 (md) · `rounded-2xl` 16 (lg) · `rounded-3xl` 24 (xl) ·
  `rounded-full` (pill); `--radius-*`. Com moderação — nada de pílulas por toda parte.
- Sombras discretas (`--shadow-sm|md|lg`, `shadow-card`): hierarquia vem de superfície e borda.

## 8. Temas

Claro por padrão; escuro pelo sistema operacional ou pela escolha da pessoa (Sistema / Claro / Escuro, na
barra lateral). O `<html>` recebe `data-theme` antes da primeira pintura (sem "flash"); sem JavaScript,
vale `prefers-color-scheme`. A preferência fica só no navegador. Os blocos escuros (sistema e escolha) são
idênticos — teste de paridade.

## 9. Dados, mapas e partidos

**Marca ≠ semântica de dado.** Navy, teal e green não representam partido, candidato, vencedor, perdedor ou
ideologia. Paletas de dados próprias (`src/lib/dataviz/palette.ts`), validadas contra as superfícies reais:

- categórica (8 slots, ordem fixa; a cor segue a entidade pela posição na legenda, nunca o partido);
  coroplético e pontos só com os **3 primeiros** slots — a partir do 4º, "Outros" (com nome no tooltip);
- sequencial em um matiz (azul) para magnitude; divergente azul × laranja com meio cinza para
  crescimento × queda; A × B com os dois primeiros slots;
- "sem dado" (terra cinza) é sempre distinto de zero (primeiro passo da rampa);
- seleção/hover no mapa = teal (interação), nunca dado.

Cor oficial de partido só em contexto explicitamente partidário (ex.: PT × PL), com legenda — nunca a
interface inteira na cor de um partido. Nenhuma classificação ideológica, nenhum score ideológico.

## 10. Iconografia e imagem

Traço limpo, geometria simples, 20/24px. Sem urna, estrela, bandeira, Congresso ou símbolo ideológico como
linguagem do produto (o ícone de "Eleições" é um gráfico de barras). Fotografia, quando houver: território,
cidades e pessoas reais; nunca político como hero institucional, comício ou patriotismo excessivo.

## 11. Motion

Preservado o sistema existente (`docs/MOTION_SYSTEM.md`): zoom semântico, precisão, Reduced Motion, sem
bounce, glow, blob, contador falso ou typewriter. Tokens de marca (`--rep-motion-*`, `--rep-ease-standard`)
disponíveis para peças novas. Movimento nunca mente sobre dados.

## 12. Proibido

Glassmorphism, neon, gradientes decorativos de SaaS, glow, blobs, partículas, excesso de badges, dashboards
genéricos, gráficos ou números falsos, estética "gerada por IA". (Removidos nesta etapa: gradiente de texto,
gradiente radial do hero, brilho "glow-brand", ícone de urna e números não verificados nas telas.)

## 13. Open Graph, exports, PWA

- **OG** (`src/lib/og/render.tsx`): 1200×630, canvas claro, assinatura oficial, título em Inter, fonte dos
  dados no rodapé, borda inferior navy. Modelos por entidade reutilizam `brandOgImage`.
- **Exports** (PDF/imagem/planilha) trazem REPBrasil, "Inteligência Eleitoral", fonte, filtros, metodologia
  e data/hora — sem marca d'água agressiva.
- **PWA**: `app/manifest.ts` (pt-BR, "REPBrasil — Inteligência Eleitoral"), ícones 192/512 e maskable,
  `apple-touch-icon` 180, `favicon.ico` 16/24/32/48; `theme-color` claro/escuro.

## 14. Brand proposals requiring owner decision

Nada abaixo foi alterado no produto; são pedidos ou propostas registrados para decisão do proprietário.

1. **Vetores mestres ausentes.** O kit não traz SVG/PDF do símbolo, wordmark nem versões negativas — só o
   quadro PNG (símbolo a 283px). Os PNGs derivados bastam para a interface (até ~2× na navegação) e OG, mas
   impressão, sinalização e ícones grandes pedem os mestres vetoriais oficiais (inclusive a assinatura
   reduzida e a negativa).
2. **Secundário × sutil.** Oficializar `text.secondary` `#5C6E81` (ou ajustar `bg.subtle`) para que a
   combinação oficial passe WCAG AA sem ajuste local (hoje 4,495:1).
3. **Token `interactive.text`.** Oficializar `#00756A` como texto interativo no claro (o teal da paleta não
   tem contraste de texto sobre fundos claros).
4. **Quadro × manual.** O quadro de diretrizes imprime o teal `#00B4A6`; manual e tokens dizem `#00BAA6`
   (adotado). Corrigir o quadro na próxima revisão do kit.
