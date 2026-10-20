"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useMemo, useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import {
  accountErrorMessage,
  deleteAlert,
  getAlertKinds,
  getAlerts,
  planRefusalOf,
  saveAlert,
  type AlertKind,
  type AlertSubscription,
} from "@/lib/account";
import { getIndicators, type Indicator } from "@/lib/data-intelligence";
import { electionsApi } from "@/lib/elections/api";
import { ALERTS_LIMIT } from "@/lib/plans";
import { officesFor } from "@/lib/rankings";
import { ufName, UF_NAMES, UFS } from "@/lib/site";
import { territoriesApi, ufOfIbgeCode, type TerritoryMunicipality } from "@/lib/territories";
import { accountKeys, useAccount, useRefreshAccount } from "@/lib/useAccount";
import { UsageMeter } from "./UsageMeter";
import { Field, FIELD_CONTROL as FIELD, hintId } from "./Field";
import { formatDate } from "./format";
const kindId = (kind: Pick<AlertKind, "resourceType" | "eventKind">) => `${kind.resourceType}/${kind.eventKind}`;

/** "2026:3:CE" → ano, cargo e escopo; nulo se a chave não seguir o formato. */
function parseElectionKey(key: string): { year: number; office: number; scope: string } | null {
  const [year, office, scope] = key.split(":");
  const y = Number(year);
  const o = Number(office);
  return Number.isInteger(y) && Number.isInteger(o) && scope ? { year: y, office: o, scope } : null;
}

function electionTarget(key: string): string {
  const parsed = parseElectionKey(key);
  if (!parsed) return key;
  const office = officesFor(parsed.year, parsed.scope).find((o) => o.code === parsed.office)?.label ?? `Cargo ${parsed.office}`;
  return `${office} — ${parsed.scope === "BR" ? "Brasil" : ufName(parsed.scope)} ${parsed.year}`;
}

/** Alertas: só os tipos que a API sabe disparar, com o alvo escolhido em listas reais; entrega na conta. */
export function AlertsSection() {
  const { data: me } = useAccount();
  const refreshAccount = useRefreshAccount();
  const kinds = useQuery({ queryKey: accountKeys.alertKinds, queryFn: getAlertKinds, staleTime: 60 * 60_000 });
  const alerts = useQuery({ queryKey: accountKeys.alerts, queryFn: getAlerts, enabled: !!me });
  const indicators = useQuery({ queryKey: ["data", "indicators"], queryFn: getIndicators, staleTime: 60 * 60_000 });
  const municipalityUfs = useMemo(
    () => [...new Set((alerts.data ?? []).filter((a) => a.resourceType === "municipality").map((a) => ufOfIbgeCode(a.resourceKey)).filter((uf): uf is string => !!uf))],
    [alerts.data],
  );
  const municipalityLists = useQueries({
    queries: municipalityUfs.map((uf) => ({ queryKey: ["territories", "municipalities", uf], queryFn: () => territoriesApi.municipalities(uf), staleTime: 24 * 60 * 60_000 })),
  });
  const [message, setMessage] = useState<{ tone: "error" | "status"; text: string; plan?: boolean } | null>(null);
  if (!me) return null;

  const municipalityName = (ibge: string) =>
    municipalityLists.flatMap((q) => q.data ?? []).find((m) => m.ibgeCode === ibge)?.name ?? `Município IBGE ${ibge}`;
  const indicatorName = (code: string) => indicators.data?.find((i) => i.code === code)?.name ?? code;
  const describe = (alert: AlertSubscription) => {
    const label = kinds.data?.find((k) => kindId(k) === kindId(alert))?.label ?? alert.eventKind;
    const target = {
      indicator: () => indicatorName(alert.resourceKey),
      state: () => ufName(alert.resourceKey) ?? alert.resourceKey,
      election: () => electionTarget(alert.resourceKey),
      municipality: () => municipalityName(alert.resourceKey),
    }[alert.resourceType as "indicator" | "state" | "election" | "municipality"];
    return { label, target: target ? target() : alert.resourceKey };
  };

  async function run(action: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await action();
      await refreshAccount();
      setMessage({ tone: "status", text: done });
    } catch (error) {
      const refusal = planRefusalOf(error);
      setMessage({
        tone: "error",
        text: refusal?.message ?? accountErrorMessage(error) ?? "Não foi possível salvar o alerta agora. Tente de novo.",
        plan: !!refusal,
      });
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-labelledby="alerts-list">
        <h2 id="alerts-list" className="text-label uppercase text-fg-muted">Seus alertas</h2>
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-body-sm ${message.tone === "error" ? "text-danger" : "text-fg-soft"}`}>
            {message.text}
            {message.plan && (
              <>
                {" "}
                <TransitionLink href="/planos" className="focus-ring rounded underline underline-offset-2">Ver planos</TransitionLink>
              </>
            )}
          </p>
        )}
        <div className="mt-3">
          {alerts.isPending && <DataState kind="loading" title="Carregando alertas" height="h-40" />}
          {alerts.isError && <DataState kind="error" title="Não foi possível carregar os alertas" action={<RetryButton onRetry={() => void alerts.refetch()} />} />}
          {alerts.isSuccess && alerts.data.length === 0 && (
            <p className="text-body-sm text-fg-muted">Nenhum alerta. Crie um ao lado para ser avisado quando uma nova edição oficial for carregada.</p>
          )}
          {alerts.isSuccess && alerts.data.length > 0 && (
            <ul className="divide-y divide-line border-y border-line">
              {alerts.data.map((alert) => {
                const { label, target } = describe(alert);
                return (
                  <li key={alert.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-fg">{target}</p>
                      <p className="mt-0.5 text-micro text-fg-muted">
                        {label} · {alert.enabled ? "ativo" : "pausado"} · desde {formatDate(alert.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className="focus-ring rounded-md px-2 py-1 text-micro font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg"
                        onClick={() => void run(() => saveAlert(me, { resourceType: alert.resourceType, resourceKey: alert.resourceKey, eventKind: alert.eventKind, enabled: !alert.enabled }), alert.enabled ? "Alerta pausado." : "Alerta retomado.")}>
                        {alert.enabled ? "Pausar" : "Retomar"}
                      </button>
                      <button type="button" aria-label={`Remover alerta: ${target}`} className="focus-ring rounded-md px-2 py-1 text-micro font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg"
                        onClick={() => void run(() => deleteAlert(me, alert.id), "Alerta removido.")}>
                        Remover
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <aside className="space-y-8 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <UsageMeter label="Alertas" used={me.usage.alerts} max={me.limits[ALERTS_LIMIT] ?? 0} />
        {kinds.isError && <DataState kind="error" title="Tipos de alerta indisponíveis" action={<RetryButton onRetry={() => void kinds.refetch()} />} />}
        {kinds.isSuccess && (
          <NewAlertForm
            kinds={kinds.data}
            indicators={indicators.data ?? []}
            onCreate={(alert) => run(() => saveAlert(me, { ...alert, enabled: true }), "Alerta criado. Você será avisado na sua conta.")}
          />
        )}
        <p className="text-micro text-fg-muted">
          Os avisos chegam em Notificações, dentro da conta. Alertas por e-mail ainda não existem.
        </p>
      </aside>
    </div>
  );
}

function NewAlertForm({
  kinds,
  indicators,
  onCreate,
}: Readonly<{ kinds: AlertKind[]; indicators: Indicator[]; onCreate: (alert: { resourceType: string; resourceKey: string; eventKind: string }) => Promise<void> }>) {
  const ids = useId();
  const [kind, setKind] = useState(kindId(kinds[0]));
  const [indicator, setIndicator] = useState("");
  const [uf, setUf] = useState("");
  const [scope, setScope] = useState("");
  const [year, setYear] = useState<number | null>(null);
  const [office, setOffice] = useState<number | null>(null);
  const [municipality, setMunicipality] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = kinds.find((k) => kindId(k) === kind) ?? kinds[0];
  const elections = useQuery({ queryKey: ["elections", "catalog"], queryFn: electionsApi.elections, staleTime: 60 * 60_000, enabled: selected.resourceType === "election" });
  const years = [...new Set((elections.data?.elections ?? []).map((e) => e.year))].sort((a, b) => b - a);
  const effectiveYear = year ?? years[0] ?? null;
  const offices = effectiveYear && scope ? officesFor(effectiveYear, scope).filter((o) => scope !== "BR" || o.code === 1) : [];
  const municipalities = useQuery({
    queryKey: ["territories", "municipalities", uf],
    queryFn: () => territoriesApi.municipalities(uf),
    enabled: selected.resourceType === "municipality" && !!uf,
    staleTime: 24 * 60 * 60_000,
  });

  const key = {
    indicator: indicator || null,
    state: uf || null,
    election: effectiveYear && office && scope ? `${effectiveYear}:${office}:${scope}` : null,
    municipality: municipality || null,
  }[selected.resourceType as "indicator" | "state" | "election" | "municipality"] ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!key) return;
    setBusy(true);
    await onCreate({ resourceType: selected.resourceType, resourceKey: key, eventKind: selected.eventKind });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="text-label uppercase text-fg-muted">Novo alerta</h2>
      <Field id={`${ids}-kind`} label="Avisar quando" hint={selected.description}>
        <select id={`${ids}-kind`} className={FIELD} value={kind} onChange={(e) => setKind(e.target.value)} aria-describedby={hintId(`${ids}-kind`)}>
          {kinds.map((k) => <option key={kindId(k)} value={kindId(k)}>{k.label}</option>)}
        </select>
      </Field>

      {selected.resourceType === "indicator" && (
        <Field id={`${ids}-indicator`} label="Indicador">
          <select id={`${ids}-indicator`} className={FIELD} value={indicator} onChange={(e) => setIndicator(e.target.value)} required>
            <option value="">Escolha um indicador</option>
            {indicators.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
          </select>
        </Field>
      )}

      {(selected.resourceType === "state" || selected.resourceType === "municipality") && (
        <UfSelect id={`${ids}-uf`} value={uf} onChange={(value) => { setUf(value); setMunicipality(""); }} />
      )}

      {selected.resourceType === "municipality" && (
        <MunicipalitySelect id={`${ids}-municipality`} uf={uf} value={municipality} onChange={setMunicipality} state={municipalities} />
      )}

      {selected.resourceType === "election" && (
        <>
          <Field id={`${ids}-year`} label="Eleição" hint={years.length === 0 && !elections.isPending ? "Nenhuma eleição no catálogo." : null}>
            <select id={`${ids}-year`} className={FIELD} value={effectiveYear ?? ""} aria-describedby={hintId(`${ids}-year`)}
              onChange={(e) => { setYear(Number(e.target.value) || null); setOffice(null); }} disabled={!elections.isSuccess || years.length === 0}>
              {years.length === 0 && <option value="">{elections.isPending ? "Carregando…" : "Indisponível"}</option>}
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field id={`${ids}-scope`} label="Território">
            <select id={`${ids}-scope`} className={FIELD} value={scope} onChange={(e) => { setScope(e.target.value); setOffice(null); }}>
              <option value="">Escolha</option>
              <option value="BR">Brasil (nacional)</option>
              {UFS.map((code) => <option key={code} value={code}>{UF_NAMES[code]}</option>)}
            </select>
          </Field>
          <Field id={`${ids}-office`} label="Cargo" hint={scope ? null : "Escolha o território antes."}>
            <select id={`${ids}-office`} className={FIELD} value={office ?? ""} aria-describedby={hintId(`${ids}-office`)}
              onChange={(e) => setOffice(Number(e.target.value) || null)} disabled={offices.length === 0}>
              <option value="">Escolha o cargo</option>
              {offices.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </Field>
        </>
      )}

      <button type="submit" disabled={!key || busy} className="focus-ring mi-press rounded-lg bg-action px-4 py-2.5 text-body-sm font-semibold text-action-fg disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Criando…" : "Criar alerta"}
      </button>
    </form>
  );
}

function UfSelect({ id, value, onChange }: Readonly<{ id: string; value: string; onChange: (uf: string) => void }>) {
  return (
    <Field id={id} label="UF">
      <select id={id} className={FIELD} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Escolha a UF</option>
        {UFS.map((code) => <option key={code} value={code}>{UF_NAMES[code]}</option>)}
      </select>
    </Field>
  );
}

function municipalityHint(uf: string, state: { isPending: boolean; isError: boolean }, count: number): string | null {
  if (!uf) return "Escolha a UF antes.";
  if (state.isPending) return "Carregando os municípios…";
  if (state.isError) return "Não foi possível carregar os municípios agora.";
  return count === 0 ? "O catálogo de municípios desta UF ainda não foi carregado." : null;
}

function MunicipalitySelect({
  id,
  uf,
  value,
  onChange,
  state,
}: Readonly<{ id: string; uf: string; value: string; onChange: (ibge: string) => void; state: { isPending: boolean; isError: boolean; data?: TerritoryMunicipality[] } }>) {
  const list = state.data ?? [];
  return (
    <Field id={id} label="Município" hint={municipalityHint(uf, state, list.length)}>
      <select id={id} className={FIELD} value={value} onChange={(e) => onChange(e.target.value)} disabled={!uf || list.length === 0} required
        aria-describedby={hintId(id)}>
        <option value="">Escolha o município</option>
        {list.map((m) => <option key={m.ibgeCode} value={m.ibgeCode}>{m.name}</option>)}
      </select>
    </Field>
  );
}
