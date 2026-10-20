"use client";

import { useSyncExternalStore } from "react";

/** `matchMedia` como estado React. No servidor (e na hidratação) assume `false`: nada depende disso para aparecer. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener?.("change", onChange);
      return () => media.removeEventListener?.("change", onChange);
    },
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}
