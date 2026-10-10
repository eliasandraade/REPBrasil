/**
 * Tokens de movimento do REPBrasil. Fonte única dos tempos e curvas usados em
 * JS (câmera do mapa, View Transitions); o CSS espelha os mesmos valores em
 * variáveis `--motion-*` (globals.css) e um teste garante a paridade.
 *
 * Os nomes descrevem o PAPEL do movimento, não a velocidade:
 * - acknowledge: confirmar um gesto (hover, foco, pressionar). Quase instantâneo.
 * - settle:      um elemento assume novo estado (aba, filtro, seleção).
 * - traverse:    mudar de camada de informação (rota, nível do território).
 * - survey:      reposicionar a câmera sobre o território (mapa).
 * - reveal:      o documento se abre quando entra na leitura (scroll).
 */
export const duration = {
  acknowledge: 90,
  settle: 180,
  traverse: 280,
  survey: 560,
  reveal: 420,
} as const;

/**
 * Curvas. Nenhuma curva "elástica": dados oficiais não quicam.
 * - precise:  saída firme, chegada amortecida (padrão para estados de UI).
 * - enter:    algo chega à leitura (desacelera até parar).
 * - exit:     algo deixa a leitura (acelera para sair, sem demorar).
 * - traverse: movimento espacial entre camadas (simétrica, sem pressa no meio).
 */
export const easing = {
  precise: [0.2, 0, 0, 1],
  enter: [0, 0, 0.12, 1],
  exit: [0.4, 0, 1, 1],
  traverse: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Intervalo entre itens de uma lista que entra em sequência (só os primeiros itens). */
export const stagger = { step: 28, maxItems: 8 } as const;

export type EasingName = keyof typeof easing;

export const cssEasing = (name: EasingName) => `cubic-bezier(${easing[name].join(", ")})`;

/** Curva cúbica avaliada em JS (MapLibre recebe uma função t → progresso). */
export function easingFn(name: EasingName): (t: number) => number {
  const [x1, y1, x2, y2] = easing[name];
  const sample = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (sample(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return sample(y1, y2, (lo + hi) / 2);
  };
}
