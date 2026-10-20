"use client";

import { COMPARE_LIMIT } from "../plans";
import { useAccount } from "../useAccount";
import { compareMax } from "./xray";

/**
 * Quantas candidaturas a pessoa pode comparar: o limite do plano decidido pela API (`limit.compare_candidacies`),
 * nunca abaixo do caminho público nem acima do teto técnico. `resolved` diz se a conta já foi consultada.
 */
export function useCompareMax(): { max: number; resolved: boolean } {
  const { data } = useAccount();
  return { max: compareMax(data?.limits[COMPARE_LIMIT]), resolved: data !== undefined };
}
