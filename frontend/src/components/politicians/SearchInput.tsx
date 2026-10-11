"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@/motion/navigation";

interface SearchInputProps {
  defaultValue?: string;
  placeholder?: string;
}

/**
 * Busca de políticos. Enquanto a consulta está de fato pendente (o intervalo
 * entre digitar e consultar), um traço percorre a base do campo: é o estado
 * real da consulta, não decoração. Leitores de tela recebem o mesmo estado.
 */
export function SearchInput({
  defaultValue = "",
  placeholder = "Buscar político, partido, estado ou cargo...",
}: SearchInputProps) {
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending(true);
    timerRef.current = setTimeout(() => {
      setPending(false);
      const params = new URLSearchParams({ q: value, page: "1" });
      navigate(`/politicos?${params}`);
    }, 300);
  }

  return (
    <div className="relative">
      {/* Search icon */}
      <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-muted">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>
      <input
        type="text"
        defaultValue={defaultValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-subtle py-3.5 pl-11 pr-4 text-sm text-fg-soft placeholder:text-fg-muted transition-colors duration-[var(--motion-acknowledge)] hover:border-accent/30 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
        aria-label="Buscar político"
        aria-busy={pending}
      />
      <div aria-hidden="true" className={`absolute inset-x-3 bottom-0 ${pending ? "query-trace" : "h-px"}`} data-testid="search-pending" data-pending={pending} />
      <output className="sr-only" aria-live="polite">
        {pending ? "Preparando consulta" : ""}
      </output>
    </div>
  );
}
