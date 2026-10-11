"use client";

import { useEffect, useState } from "react";
import { applyPreference, readPreference, type ThemePreference } from "./theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; path: string }> = [
  { value: "system", label: "Tema do sistema", path: "M4 5h16v11H4z M8 20h8 M12 16v4" },
  { value: "light", label: "Tema claro", path: "M12 4v2 M12 18v2 M4 12h2 M18 12h2 M6.3 6.3l1.4 1.4 M16.3 16.3l1.4 1.4 M6.3 17.7l1.4-1.4 M16.3 7.7l1.4-1.4 M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z" },
  { value: "dark", label: "Tema escuro", path: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" },
];

/** Seletor de tema (grupo de rádio acessível: setas movem, Espaço/Enter escolhe). */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("system");
  useEffect(() => setPref(readPreference()), []);

  const choose = (value: ThemePreference) => {
    setPref(value);
    applyPreference(value);
  };

  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      {OPTIONS.map((option, index) => {
        const checked = pref === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(option.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next = OPTIONS[(index + (e.key === "ArrowRight" ? 1 : OPTIONS.length - 1)) % OPTIONS.length];
              choose(next.value);
              (e.currentTarget.parentElement?.children[OPTIONS.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
            className={`focus-ring inline-flex h-9 w-9 items-center lg:h-7 lg:w-7 justify-center rounded-md transition-colors ${
              checked ? "bg-surface text-accent-text shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={option.path} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
