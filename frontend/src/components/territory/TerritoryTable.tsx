"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Lista equivalente ao mapa: os mesmos territórios e valores, ordenáveis e filtráveis. É o caminho pelo teclado
 * (setas, Home/End, Enter) e o caminho sem WebGL. Passar o mouse ou o foco numa linha destaca o território no mapa,
 * e o hover no mapa destaca a linha.
 */

export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface TableRow {
  code: string;
  name: string;
  cells: Record<string, string>;
  sort: Record<string, number | null>;
  /** Sem dado no recorte: aparece, mas esmaecido e sempre ao fim da ordenação. */
  missing?: boolean;
}

type Sort = { key: string; dir: "asc" | "desc" };

/** Teclas da lista: próxima, anterior, primeira e última linha. */
const KEY_STEP: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index) => index + 1,
  ArrowUp: (index) => index - 1,
  Home: () => 0,
  End: (_, last) => last,
};

function ariaSort(current: boolean, dir: Sort["dir"]): "ascending" | "descending" | "none" {
  if (!current) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function TerritoryTable({
  caption,
  columns,
  rows,
  selected,
  hovered,
  onHover,
  onSelect,
  initialSort,
  noun,
  actions,
  missingLabel = "sem dado neste recorte (sem dado não vira zero)",
}: Readonly<{
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
  selected: string | null;
  hovered: string | null;
  onHover: (code: string | null) => void;
  onSelect: (code: string) => void;
  initialSort: Sort;
  /** "municípios" ou "UFs". */
  noun: string;
  actions?: ReactNode;
  missingLabel?: string;
}>) {
  const [sort, setSort] = useState<Sort>(initialSort);
  const [filter, setFilter] = useState("");
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const visible = useMemo(() => {
    const term = normalize(filter.trim());
    const filtered = term ? rows.filter((r) => normalize(r.name).includes(term)) : rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "name") return factor * a.name.localeCompare(b.name, "pt-BR");
      const va = a.sort[sort.key];
      const vb = b.sort[sort.key];
      if (va == null && vb == null) return a.name.localeCompare(b.name, "pt-BR");
      if (va == null) return 1;
      if (vb == null) return -1;
      return factor * (va - vb) || a.name.localeCompare(b.name, "pt-BR");
    });
  }, [filter, rows, sort]);

  const missing = rows.filter((r) => r.missing).length;
  const active = visible.find((r) => r.code === focusCode)?.code ?? visible.find((r) => r.code === selected)?.code ?? visible[0]?.code;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = KEY_STEP[event.key];
    if (!step) return;
    const target = step(index, visible.length - 1);
    event.preventDefault();
    const row = visible[Math.max(0, Math.min(visible.length - 1, target))];
    if (!row) return;
    setFocusCode(row.code);
    buttons.current.get(row.code)?.focus();
  };

  const toggleSort = (key: string, numeric: boolean) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));

  const header = (key: string, label: string, numeric: boolean) => {
    const current = sort.key === key;
    return (
      <th key={key} scope="col" aria-sort={ariaSort(current, sort.dir)} className={`px-3 py-2 font-medium ${numeric ? "text-right" : ""}`}>
        <button type="button" onClick={() => toggleSort(key, numeric)} className="focus-ring inline-flex items-center gap-1 rounded hover:text-fg">
          {label}
          <span aria-hidden="true" className={current ? "text-fg" : "text-fg-muted/50"}>{current && sort.dir === "asc" ? "↑" : "↓"}</span>
        </button>
      </th>
    );
  };

  return (
    <section aria-label={caption} className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="territory-table">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-semibold text-fg">{caption}</h2>
          <p className="text-micro text-fg-muted">
            {rows.length} {noun}
            {missing > 0 && ` · ${missing} ${missingLabel}`}. Use as setas para percorrer e Enter para abrir.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <label className="text-micro text-fg-muted">
            <span className="sr-only">Filtrar {noun} pelo nome</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={`Filtrar ${noun}`}
              className="focus-ring w-44 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-body-sm text-fg"
            />
          </label>
        </div>
      </div>
      <div className="max-h-[440px] overflow-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="sticky top-0 z-10 bg-surface text-micro text-fg-muted shadow-[0_1px_0_rgb(var(--border))]">
            <tr>
              {header("name", noun === "UFs" ? "UF" : "Município", false)}
              {columns.map((c) => header(c.key, c.label, !!c.numeric))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const highlighted = row.code === hovered || row.code === selected;
              return (
                <tr
                  key={row.code}
                  className={`border-t border-line transition-colors duration-[var(--motion-acknowledge)] ${highlighted ? "bg-accent/10" : ""} ${row.missing ? "text-fg-muted" : ""}`}
                  onMouseEnter={() => onHover(row.code)}
                  onMouseLeave={() => onHover(null)}
                  data-code={row.code}
                  aria-current={row.code === selected ? "true" : undefined}
                >
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) buttons.current.set(row.code, el);
                        else buttons.current.delete(row.code);
                      }}
                      tabIndex={row.code === active ? 0 : -1}
                      onFocus={() => {
                        setFocusCode(row.code);
                        onHover(row.code);
                      }}
                      onBlur={() => onHover(null)}
                      onKeyDown={(event) => move(event, index)}
                      onClick={() => onSelect(row.code)}
                      className="focus-ring mi-underline rounded text-left font-medium text-fg"
                    >
                      {row.name}
                    </button>
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                      {row.cells[c.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-fg-muted">
                  Nenhum resultado para “{filter}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
