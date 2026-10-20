import { duration, easingFn } from "./tokens";

/**
 * Movimento do mapa territorial com os mesmos tokens do resto do produto (docs/MOTION_SYSTEM.md §7):
 * - câmera: `survey` (Brasil → UF) e `traverse` (UF → município), sempre com a curva espacial `traverse`;
 * - camadas: transição de pintura do MapLibre (opacidade e largura) com os papéis acknowledge/settle/traverse/reveal;
 * - Reduced Motion: corte seco (duração 0) e nenhum pulso.
 */

export type CameraMove = "survey" | "traverse";
export type PaintRole = "acknowledge" | "settle" | "traverse" | "reveal";

const spatial = easingFn("traverse");

export function cameraMotion(kind: CameraMove, reduced: boolean): { duration: number; easing: (t: number) => number } {
  return { duration: reduced ? 0 : duration[kind], easing: spatial };
}

/** Valor de `*-transition` do MapLibre para uma propriedade de pintura. */
export function paintTransition(role: PaintRole, reduced: boolean, delay = 0): { duration: number; delay: number } {
  return { duration: reduced ? 0 : duration[role], delay: reduced ? 0 : delay };
}

/**
 * Pulso único na chegada de uma camada de contagem: um anel que se expande e some, só nos maiores valores.
 * Nunca em laço; com Reduced Motion não existe.
 */
export function pulseMotion(reduced: boolean): { duration: number; from: number; to: number } | null {
  return reduced ? null : { duration: duration.reveal * 2, from: 3, to: 26 };
}

/** Quantos territórios recebem pulso (os de maior valor). */
export const PULSE_TOP = 5;

/** Inclinação da câmera no relevo 3D (graus). */
export const RELIEF_PITCH = 48;
