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
    <input
      type="text"
      defaultValue={defaultValue}
      onChange={handleChange}
      placeholder={placeholder}
      className="w-full px-5 py-4 text-base border border-slate-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
      aria-label="Buscar político"
    />
  );
}
