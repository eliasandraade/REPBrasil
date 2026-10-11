"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "./theme-script";

/**
 * Tema claro/escuro do REPBrasil. Preferência da pessoa: "system" (padrão), "light" ou "dark".
 * O <html> recebe `data-theme` com o tema RESOLVIDO antes da primeira pintura (public/theme-init.js) e
 * `data-theme-pref` com a preferência. Sem JS, o CSS segue `prefers-color-scheme` (globals.css).
 * Preferência só no navegador (localStorage); nenhum dado sai do dispositivo.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyPreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // armazenamento bloqueado: o tema vale só nesta página
  }
  const root = document.documentElement;
  root.dataset.theme = resolve(preference);
  root.dataset.themePref = preference;
}

/** Tema resolvido atual, reativo a troca manual e à mudança do sistema operacional. */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>("light");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if ((root.dataset.themePref ?? "system") === "system") root.dataset.theme = systemTheme();
    };
    media?.addEventListener?.("change", onSystem);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", onSystem);
    };
  }, []);
  return theme;
}

/** Lê um token de cor (canais RGB) do tema atual como `rgb(r g b)` — para MapLibre e canvas. */
export function tokenColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return raw ? `rgb(${raw})` : fallback;
}
