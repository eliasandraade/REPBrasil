"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UF_NAMES, UFS } from "@/lib/site";
import {
  getLiveCount,
  getPolls,
  type ElectoralPoll,
  type LiveCountResponse,
  type PollsResponse,
} from "@/lib/electoral-live";

const offices = [
  { value: 1, label: "Presidente" },
  { value: 3, label: "Governador" },
  { value: 5, label: "Senador" },
  { value: 6, label: "Deputado Federal" },
  { value: 7, label: "Deputado Estadual" },
];

const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

function maybePercent(value: number | null) {
  return value === null ? "—" : `${percent.format(value)}%`;
}

function maybeMargin(value: number | null) {
  return value === null ? "—" : `± ${percent.format(value)} p.p.`;
}

function maybeNumber(value: number | null) {
  return value === null ? "—" : number.format(value);
}

function PollCard({ poll }: Readonly<{ poll: ElectoralPoll }>) {
  return (
    <article className="rounded-xl border border-line bg-surface p-5" data-testid="poll-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent-text">{poll.institute}</p>
          <h3 className="mt-1 text-lg font-semibold text-fg">{poll.registrationNumber}</h3>
          <p className="mt-1 text-sm text-fg-muted">
            Campo de {date.format(new Date(`${poll.fieldStart}T12:00:00`))} a {date.format(new Date(`${poll.fieldEnd}T12:00:00`))}
          </p>
        </div>
        <div className="text-right text-xs leading-5 text-fg-muted">
          <div>Amostra: <strong className="text-fg-soft">{maybeNumber(poll.sampleSize)}</strong></div>
          <div>Margem: <strong className="text-fg-soft">{maybeMargin(poll.marginErrorPp)}</strong></div>
          <div>Confiança: <strong className="text-fg-soft">{maybePercent(poll.confidenceLevel)}</strong></div>
        </div>
      </div>

      {poll.methodology && <p className="mt-4 text-sm leading-6 text-fg-muted">{poll.methodology}</p>}

      {poll.scenarios.length === 0 ? (
        <div className="mt-4 rounded-lg border border-line bg-canvas px-4 py-3 text-sm text-fg-muted">
          Registro oficial carregado; nenhum percentual de resultado auditado foi anexado a esta edição.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {poll.scenarios.map((scenario) => (
            <section key={`${poll.id}-${scenario.order}`}>
              <h4 className="text-sm font-semibold text-fg">{scenario.name}</h4>
              <div className="mt-2 overflow-hidden rounded-lg border border-line">
                {scenario.options.map((option) => (
                  <div key={`${scenario.order}-${option.order}`} className="flex items-center justify-between gap-4 border-b border-line px-3 py-2 text-sm last:border-b-0">
                    <span className="min-w-0 truncate text-fg-soft">{option.label}{option.partyAcronym ? ` · ${option.partyAcronym}` : ""}</span>
                    <strong className="tabular-nums text-fg">{maybePercent(option.percentage)}</strong>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-fg-muted">
        <span>Fonte auditada em {dateTime.format(new Date(poll.retrievedAt))}</span>
        <a className="text-accent-text hover:underline" href={poll.sourceUrl} target="_blank" rel="noreferrer">Abrir fonte oficial ↗</a>
      </div>
    </article>
  );
}

function LivePanel({ data }: Readonly<{ data: LiveCountResponse | null }>) {
  if (!data?.snapshot) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm leading-6 text-fg-muted" data-testid="live-empty">
        Nenhum snapshot oficial de totalização foi carregado para este recorte. O REPBrasil não reconstrói uma “apuração ao vivo” a partir de dados históricos nem transforma ausência em zero.
      </div>
    );
  }

  const snapshot = data.snapshot;
  const final = snapshot.status === "final";
  const notStarted = snapshot.status === "not_started";
  const frameClass = final
    ? "border-emerald-500/30 bg-emerald-500/5"
    : notStarted
      ? "border-line bg-surface"
      : "border-amber-500/30 bg-amber-500/5";
  const badgeClass = final
    ? "bg-emerald-500/15 text-emerald-500"
    : notStarted
      ? "bg-fg/[0.06] text-fg-muted"
      : "bg-amber-500/15 text-amber-500";
  const badge = final ? "FINAL" : notStarted ? "NÃO INICIADA" : "PARCIAL";

  return (
    <div className="space-y-4" data-testid="live-snapshot">
      <section className={`rounded-xl border p-5 ${frameClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
                {badge}
              </span>
              <span className="text-xs uppercase tracking-wide text-fg-muted">Fonte oficial TSE</span>
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-fg">{maybePercent(snapshot.countedPercent)}</p>
            <p className="mt-1 text-sm text-fg-muted">seções totalizadas</p>
          </div>
          <div className="text-right text-sm leading-6 text-fg-muted">
            <div>{maybeNumber(snapshot.countedSections)} de {maybeNumber(snapshot.totalSections)} seções</div>
            <div>Gerado: {snapshot.tseGeneratedAt ? dateTime.format(new Date(snapshot.tseGeneratedAt)) : "—"}</div>
            <div>Capturado: {dateTime.format(new Date(snapshot.capturedAt))}</div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h3 className="font-semibold text-fg">Resultado do snapshot</h3>
          <p className="mt-1 text-xs text-fg-muted">Campos não publicados permanecem “—”; zero só aparece quando a fonte oficial publicou zero.</p>
        </div>
        <div className="divide-y divide-line">
          {snapshot.results.length === 0 && <div className="px-4 py-5 text-sm text-fg-muted">Snapshot disponível sem linhas de resultado para este cargo.</div>}
          {snapshot.results.map((item) => (
            <div key={`${item.position}-${item.candidacyId ?? item.candidateNumber ?? item.label}`} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
              <span className="text-sm tabular-nums text-fg-muted">{item.position}º</span>
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{item.label}</p>
                <p className="truncate text-xs text-fg-muted">{item.candidateNumber ?? "—"}{item.partyAcronym ? ` · ${item.partyAcronym}` : ""}{item.resultStatus ? ` · ${item.resultStatus}` : ""}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums text-fg">{maybePercent(item.percentage)}</p>
                <p className="text-xs tabular-nums text-fg-muted">{maybeNumber(item.votes)} votos</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <a className="inline-flex text-sm text-accent-text hover:underline" href={snapshot.sourceUrl} target="_blank" rel="noreferrer">Abrir JSON oficial do TSE ↗</a>
    </div>
  );
}

/** UF do recorte: `BR` é o Brasil (vazio); sigla desconhecida volta ao Ceará, o recorte carregado. */
function scopeOf(raw: string | null): string {
  const value = (raw ?? "CE").toUpperCase();
  if (value === "BR") return "";
  return UFS.includes(value) ? value : "CE";
}

/**
 * Recorte na URL (`?ano=&turno=&cargo=&uf=&municipio=`; `uf=BR` é o Brasil): link direto, voltar do navegador e links
 * das notificações de pesquisas e apuração abrem o mesmo recorte.
 */
function useLiveQuery() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/pesquisas";
  const year = Number(search.get("ano")) || 2026;
  const round = search.get("turno") === "2" ? 2 : 1;
  const office = offices.some((item) => item.value === Number(search.get("cargo"))) ? Number(search.get("cargo")) : 3;
  const uf = scopeOf(search.get("uf"));
  const rawMunicipality = (search.get("municipio") ?? "").replace(/\D/g, "").slice(0, 5);
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
  return { year, round, office, uf, municipalityTseCode: uf ? rawMunicipality : "", set };
}

export function ElectoralLiveHub() {
  const { year, round, office, uf, municipalityTseCode, set } = useLiveQuery();
  const [polls, setPolls] = useState<PollsResponse | null>(null);
  const [live, setLive] = useState<LiveCountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => ({
    year,
    round,
    office,
    ...(uf ? { uf } : {}),
    ...(municipalityTseCode.length === 5 ? { municipalityTseCode } : {}),
  }), [year, round, office, uf, municipalityTseCode]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getPolls(query), getLiveCount(query)])
      .then(([pollData, liveData]) => {
        if (!active) return;
        setPolls(pollData);
        setLive(liveData);
      })
      .catch(() => active && setError("Não foi possível carregar pesquisas e totalização para este recorte."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-7 px-4 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">Eleições {year}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Pesquisas & apuração</h1>
        <p className="max-w-3xl text-sm leading-6 text-fg-muted">Pesquisas registradas e snapshots oficiais de totalização, com fonte, horário e estado não iniciado/parcial/final explícitos. Sem projeções disfarçadas de resultado.</p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-4" aria-label="Recorte eleitoral">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm text-fg-muted"><span>Turno</span><select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={round} onChange={(event) => set({ turno: event.target.value === "2" ? "2" : null })}><option value={1}>1º turno</option><option value={2}>2º turno</option></select></label>
          <label className="space-y-1 text-sm text-fg-muted"><span>Cargo</span><select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={office} onChange={(event) => set({ cargo: event.target.value })}>{offices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="space-y-1 text-sm text-fg-muted"><span>Abrangência</span><select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={uf} onChange={(event) => set({ uf: event.target.value || "BR", municipio: null })}><option value="">Brasil</option>{UFS.map((code) => <option key={code} value={code}>{UF_NAMES[code]}</option>)}</select></label>
          <label className="space-y-1 text-sm text-fg-muted"><span>Município TSE (opcional)</span><input className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg placeholder:text-fg-muted" inputMode="numeric" maxLength={5} disabled={!uf} placeholder="ex.: 13897" value={municipalityTseCode} onChange={(event) => set({ municipio: event.target.value.replace(/\D/g, "").slice(0, 5) || null })} /></label>
        </div>
      </section>

      {loading && <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">Carregando fontes oficiais…</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">{error}</div>}

      {!loading && !error && (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-xl font-semibold text-fg">Pesquisas eleitorais</h2>
              <p className="mt-1 text-sm text-fg-muted">{polls?.caveat}</p>
            </div>
            {polls && polls.polls.length > 0 ? <div className="grid gap-4 lg:grid-cols-2">{polls.polls.map((poll) => <PollCard key={poll.id} poll={poll} />)}</div> : <div className="rounded-xl border border-line bg-surface p-6 text-sm leading-6 text-fg-muted" data-testid="polls-empty">Nenhuma pesquisa oficial auditada foi carregada para este recorte. Isso não significa que não existam pesquisas; significa apenas que o REPBrasil ainda não possui uma observação auditada compatível.</div>}
          </section>

          <section className="space-y-3">
            <div>
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-fg">Apuração oficial</h2><span className="rounded-full border border-line px-2 py-0.5 text-[11px] uppercase tracking-wide text-fg-muted">snapshot</span></div>
              <p className="mt-1 text-sm text-fg-muted">{live?.caveat}</p>
            </div>
            <LivePanel data={live} />
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 text-xs leading-5 text-fg-muted">
            <strong className="text-fg-soft">Metodologia:</strong> {polls?.methodology} {live?.methodology}
          </section>
        </>
      )}
    </main>
  );
}
