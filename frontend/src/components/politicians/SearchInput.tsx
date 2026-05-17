"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

interface SearchInputProps {
  defaultValue?: string;
  placeholder?: string;
}

export function SearchInput({
  defaultValue = "",
  placeholder = "Buscar político, partido, estado ou cargo...",
}: SearchInputProps) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams({ q: value, page: "1" });
      router.push(`/politicos?${params}`);
    }, 300);
  }

  return (
    <div className="relative">
      {/* Search icon */}
      <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
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
        className="w-full rounded-xl border border-white/10 bg-card-elevated py-3.5 pl-11 pr-4 text-sm text-slate-200 placeholder:text-slate-600 transition-all hover:border-brand/30 focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        aria-label="Buscar político"
      />
    </div>
  );
}
