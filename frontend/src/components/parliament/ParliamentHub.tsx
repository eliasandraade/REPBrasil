"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TerritoryMap } from "@/components/elections/TerritoryMap";
import { useResolvedTheme } from "@/components/theme/theme";
import { mix, SEQUENTIAL } from "@/lib/dataviz/palette";
import { MUNICIPALITY_MESHES } from "@/lib/elections/geo";
import type { MapLayerView } from "@/lib/elections/map-layers";
import {
  describeAmendmentMunicipality,
  getAmendmentMap,
  getAmendmentYears,
  getParliamentActivities,
  getParliamentActivityTotal,
  getParliamentAmendments,
  getParliamentMembers,
  isCompleteCommittedTotal,
  type AmendmentMunicipality,
  type ParliamentActivity,
  type ParliamentAmendment,
  type ParliamentMember,
} from "@/lib/parliament";
import { useReducedMotion } from "@/motion/reduced-motion";
import { ufName, UF_NAMES, UFS } from "@/lib/site";
import { ibgeCodeOfUf } from "@/lib/territories";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("pt-BR");

const institutionLabel: Record<string, string> = {
  camara: "Câmara dos Deputados",
  senado: "Senado Federal",
  alece: "Assembleia Legislativa do Ceará",
};

function formatDate(value: string | null) {
  if (!value) return "Data não publicada";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** Total do recorte vindo da API; sem ele, ausência explícita (nunca a quantidade listada). */
function totalText(loading: boolean, total: number | null) {
  if (loading) return "…";
  return total === null ? "—" : count.format(total);
}

/** A listagem de atos é limitada: deixa explícito quando ela mostra só parte do total. */
function listingNote(shown: number, total: number | null) {
  if (total === null || shown >= total) return "";
  return ` Exibindo os ${count.format(shown)} mais recentes de ${count.format(total)}.`;
}

function AmendmentMap({ rows, year, uf }: Readonly<{ rows: AmendmentMunicipality[]; year: number | null; uf: string }>) {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();

  const layer = useMemo<MapLayerView>(() => {
    const observed = rows
      .filter(isCompleteCommittedTotal)
      .map((row) => row.committedAmount)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const min = observed.length ? Math.min(...observed) : 0;
    const max = observed.length ? Math.max(...observed) : 0;
    const span = max - min;
    const palette = SEQUENTIAL[theme];
    const municipalities: MapLayerView["municipalities"] = {};

    for (const row of rows) {
      let color: string | null = null;
      if (isCompleteCommittedTotal(row) && row.committedAmount !== null) {
        const intensity = span === 0 ? 0.55 : (row.committedAmount - min) / span;
        color = mix(palette.low, palette.high, intensity);
      }
      municipalities[row.municipalityIbgeCode] = { color, text: describeAmendmentMunicipality(row) };
    }

    return {
      kind: "intensity",
      level: "municipality",
      municipalities,
      places: [],
      legend: [],
      gradient: observed.length ? { from: palette.low, to: palette.high, min: money.format(min), max: money.format(max) } : null,
      note: "A cor representa somente totais completos do valor empenhado. Soma parcial (emendas sem valor publicado) fica sem cor e é identificada no texto; município sem código IBGE oficial ou sem valor publicado não é inferido nem tratado como zero.",
    };
  }, [rows, theme]);

  if (rows.length === 0) {
    return <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">Nenhuma emenda com município identificado por código IBGE oficial foi observada neste recorte.</div>;
  }
  const stateCode = ibgeCodeOfUf(uf);
  if (!stateCode || !MUNICIPALITY_MESHES[stateCode]) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">
        A malha municipal de {ufName(uf)} ainda não foi publicada no REPBrasil, então o mapa não é desenhado. As emendas do recorte estão na lista abaixo.
      </div>
    );
  }

  return (
    <section className="space-y-3" data-testid="amendment-map">
      <div>
        <h2 className="font-semibold text-fg">Emendas por município</h2>
        <p className="mt-1 text-sm text-fg-muted">Destino em {ufName(uf)}{year ? ` · ${year}` : " · todos os anos carregados"}. O mapa só aceita identidade territorial oficial.</p>
      </div>
      <div className="min-h-[420px] sm:min-h-[520px]">
        <TerritoryMap
          level="state"
          routeKey={`parlamento:${uf}:${year ?? "all"}`}
          scope={{
            state: stateCode,
            municipality: null,
            interactiveStates: [],
            highlightStates: [stateCode],
            interactiveMunicipalities: [],
            highlightMunicipalities: rows.map((row) => row.municipalityIbgeCode),
          }}
          points={[]}
          reduced={reduced}
          onSelect={() => undefined}
          onSelectPlace={() => undefined}
          layer={layer}
        />
      </div>
      <p className="text-xs leading-5 text-fg-muted">{layer.note}</p>
    </section>
  );
}

/** Recorte na URL (`?uf=&membro=&ano=`): link direto, voltar do navegador e links das notificações abrem o mesmo recorte. */
function useParliamentQuery() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/parlamento";
  const rawUf = (search.get("uf") ?? "").toUpperCase();
  const uf = UFS.includes(rawUf) ? rawUf : "CE";
  const memberId = Number(search.get("membro")) || null;
  const year = Number(search.get("ano")) || null;
  const set = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [pathname, router, search],
  );
  return { uf, memberId, year, set };
}

export function ParliamentHub() {
  const { uf, memberId, year, set } = useParliamentQuery();
  const [members, setMembers] = useState<ParliamentMember[]>([]);
  const [activities, setActivities] = useState<ParliamentActivity[]>([]);
  const [activityTotal, setActivityTotal] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [amendments, setAmendments] = useState<ParliamentAmendment[]>([]);
  const [mapRows, setMapRows] = useState<AmendmentMunicipality[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingMembers(true);
    getParliamentMembers(uf)
      .then((rows) => active && setMembers(rows))
      .catch(() => active && setError("Não foi possível carregar o cadastro parlamentar."))
      .finally(() => active && setLoadingMembers(false));
    return () => { active = false; };
  }, [uf]);

  useEffect(() => {
    let active = true;
    getAmendmentYears(uf)
      .then((rows) => active && setYears(rows))
      .catch(() => active && setError("Não foi possível carregar os anos das emendas."));
    return () => { active = false; };
  }, [uf]);

  useEffect(() => {
    let active = true;
    setLoadingData(true);
    setError(null);
    Promise.all([
      getParliamentActivities({ memberId, uf, limit: 100 }),
      getParliamentActivityTotal({ memberId, uf }),
      getParliamentAmendments({ year, uf, limit: 200 }),
      getAmendmentMap(year, uf),
    ])
      .then(([activityRows, activityCount, amendmentRows, municipalityRows]) => {
        if (!active) return;
        setActivities(activityRows);
        setActivityTotal(activityCount.total);
        setAmendments(amendmentRows);
        setMapRows(municipalityRows);
      })
      .catch(() => active && setError("Não foi possível carregar o recorte parlamentar."))
      .finally(() => active && setLoadingData(false));
    return () => { active = false; };
  }, [memberId, year, uf]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">Poder Legislativo</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-fg">Atividade parlamentar</h1>
          <Link href="/dados" className="focus-ring rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-fg-soft hover:bg-fg/5">← Dados</Link>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-fg-muted">Atos e emendas a partir de fontes oficiais, com proveniência. Vínculos entre parlamentar e pessoa do cadastro eleitoral só existem quando há identificador documental auditado; nome nunca é usado como identidade.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo parlamentar">
        <article className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-fg-muted">Parlamentares de {uf} carregados</p><p className="mt-1 text-2xl font-semibold text-fg">{loadingMembers ? "…" : count.format(members.length)}</p></article>
        <article className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-fg-muted">Atos no recorte</p><p className="mt-1 text-2xl font-semibold text-fg">{totalText(loadingData, activityTotal)}</p></article>
        <article className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-fg-muted">Municípios com emenda mapeável</p><p className="mt-1 text-2xl font-semibold text-fg">{loadingData ? "…" : count.format(mapRows.length)}</p></article>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4" aria-label="Filtros parlamentares">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm text-fg-muted">
            <span>UF</span>
            <select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={uf} onChange={(event) => set({ uf: event.target.value, membro: null, ano: null })}>
              {UFS.map((code) => <option key={code} value={code}>{UF_NAMES[code]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-fg-muted">
            <span>Parlamentar — atos</span>
            <select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={memberId ?? ""} onChange={(event) => set({ membro: event.target.value || null })}>
              <option value="">Todos de {ufName(uf)}</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.parliamentaryName ?? member.name}{member.partyAcronym ? ` · ${member.partyAcronym}` : ""} · {institutionLabel[member.institution] ?? member.institution}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-fg-muted">
            <span>Ano — emendas</span>
            <select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={year ?? ""} onChange={(event) => set({ ano: event.target.value || null })}>
              <option value="">Todos os anos carregados</option>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">{error}</div>}

      <AmendmentMap rows={mapRows} year={year} uf={uf} />

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold text-fg">Atos parlamentares</h2>
          <p className="text-xs text-fg-muted">{memberId ? `Recorte de ${memberById.get(memberId)?.parliamentaryName ?? memberById.get(memberId)?.name ?? "parlamentar selecionado"}.` : `Parlamentares de ${ufName(uf)}.`} Dados ausentes não são convertidos em atividade zero.{listingNote(activities.length, activityTotal)}</p>
        </div>
        {activities.length === 0 && !loadingData ? <p className="p-5 text-sm text-fg-muted">Nenhum ato oficial carregado para este recorte.</p> : (
          <div className="divide-y divide-line">
            {activities.map((activity) => (
              <article key={activity.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{activity.activityType} · {institutionLabel[activity.institution] ?? activity.institution}</p><h3 className="mt-1 font-medium text-fg">{activity.title ?? `Ato ${activity.externalId}`}</h3></div>
                  <time className="text-xs text-fg-muted">{formatDate(activity.occurredAt)}</time>
                </div>
                {activity.description && <p className="mt-2 text-sm leading-6 text-fg-muted">{activity.description}</p>}
                <p className="mt-2 text-xs text-fg-muted">Fonte: {activity.provider} · {activity.dataset} · coleta {formatDate(activity.retrievedAt)}{activity.sourceUrl && <> · <a className="underline hover:text-fg" href={activity.sourceUrl} target="_blank" rel="noreferrer">documento oficial</a></>}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3"><h2 className="font-semibold text-fg">Emendas destinadas ao Ceará</h2><p className="text-xs text-fg-muted">Tabela limitada às 200 observações atuais do recorte. Município só é associado quando o código IBGE é publicado pela fonte.</p></div>
        {amendments.length === 0 && !loadingData ? <p className="p-5 text-sm text-fg-muted">Nenhuma emenda oficial carregada para este recorte.</p> : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-surface text-xs text-fg-muted"><tr><th className="px-4 py-2">Ano</th><th className="px-4 py-2">Autor</th><th className="px-4 py-2">Destino</th><th className="px-4 py-2">Empenhado</th><th className="px-4 py-2">Pago</th><th className="px-4 py-2">Fonte</th></tr></thead>
              <tbody>{amendments.map((row) => <tr key={`${row.externalId}-${row.id}`} className="border-t border-line"><td className="px-4 py-2 text-fg-muted">{row.year ?? "—"}</td><td className="px-4 py-2 text-fg">{row.authorName ?? "Não publicado"}</td><td className="px-4 py-2 text-fg-muted">{row.locality ?? row.municipalityIbgeCode ?? "Não publicado"}</td><td className="px-4 py-2 text-fg-muted">{row.committedAmount === null ? "—" : money.format(row.committedAmount)}</td><td className="px-4 py-2 text-fg-muted">{row.paidAmount === null ? "—" : money.format(row.paidAmount)}</td><td className="px-4 py-2 text-fg-muted"><a className="underline hover:text-fg" href={row.sourceUrl} target="_blank" rel="noreferrer">{row.provider}</a></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
