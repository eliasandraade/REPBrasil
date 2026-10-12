"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MunicipalityItem } from "@/lib/elections/types";
import { normalizeText } from "@/lib/elections/format";
import { municipalityProfilePath } from "@/lib/entities";

export function MunicipalityDirectory({ municipalities, uf }: Readonly<{ municipalities: MunicipalityItem[]; uf: string }>) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return municipalities;
    return municipalities.filter(
      (item) =>
        normalizeText(item.name).includes(q) ||
        item.tseCode === q ||
        (item.ibgeCode !== null && String(item.ibgeCode) === q),
    );
  }, [municipalities, query]);

  return (
    <section aria-labelledby="municipality-directory" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="municipality-directory" className="text-base font-semibold text-fg">
            Municípios
          </h2>
          <p className="mt-1 text-xs text-fg-muted">Perfis territoriais ligados por código oficial, nunca por semelhança de nome.</p>
        </div>
        <span className="text-xs tabular-nums text-fg-muted">{shown.length.toLocaleString("pt-BR")} exibidos</span>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar município, código TSE ou IBGE"
        aria-label="Buscar município"
        className="focus-ring mt-4 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg-muted"
      />
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">Nenhum município encontrado.</p>
      ) : (
        <ul className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="municipality-directory-list">
          {shown.map((item) => (
            <li key={item.tseCode}>
              <Link
                href={municipalityProfilePath(uf, item.slug)}
                className="focus-ring flex h-full items-center justify-between gap-3 rounded-lg border border-line bg-subtle/50 px-3 py-2.5 text-sm transition-colors hover:border-accent/30 hover:bg-subtle"
              >
                <span className="min-w-0 truncate font-medium text-fg-soft">{item.name}</span>
                <span className="flex-shrink-0 text-[10px] text-fg-muted">{item.resultsAvailable ? "resultados" : item.cadasterAvailable ? "cadastro" : "território"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
