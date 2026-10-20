"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { accountErrorMessage, getProfile, updateProfile, type AccountProfile, type ProfileUpdate, type UsageType } from "@/lib/account";
import { UF_NAMES, UFS } from "@/lib/site";
import { territoriesApi } from "@/lib/territories";
import { accountKeys, useAccount, useRefreshAccount } from "@/lib/useAccount";
import { AccountAvatar } from "./AccountAvatar";
import { Field, FIELD_CONTROL, hintId } from "./Field";
import { USAGE_TYPE_LABEL } from "./format";

const toForm = (profile: AccountProfile): ProfileUpdate => ({
  displayName: profile.displayName,
  fullName: profile.fullName,
  stateCode: profile.stateCode,
  municipalityIbgeCode: profile.municipalityIbgeCode,
  usageType: profile.usageType,
  avatarHidden: profile.avatarHidden,
});

/**
 * Perfil: nome, UF e município (catálogo IBGE), tipo de uso e avatar. O e-mail é a identidade do login e não se
 * edita aqui. Nada de CPF, partido, candidato, ideologia, religião ou intenção de voto.
 */
export function ProfileSection() {
  const { data: me } = useAccount();
  const client = useQueryClient();
  const refreshAccount = useRefreshAccount();
  const profile = useQuery({ queryKey: accountKeys.profile, queryFn: getProfile, enabled: !!me });
  const [form, setForm] = useState<ProfileUpdate | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const id = useId();

  useEffect(() => {
    if (profile.data && form === null) setForm(toForm(profile.data));
  }, [profile.data, form]);

  const uf = form?.stateCode ?? null;
  const municipalities = useQuery({
    queryKey: ["territories", "municipalities", uf],
    queryFn: () => territoriesApi.municipalities(uf!),
    enabled: !!uf,
    staleTime: 24 * 60 * 60 * 1000,
  });

  if (!me) return null;
  if (profile.isPending || (profile.isSuccess && form === null)) return <DataState kind="loading" title="Carregando o perfil" height="h-64" />;
  if (profile.isError || !form) {
    return <DataState kind="error" title="Não foi possível carregar o perfil" action={<RetryButton onRetry={() => void profile.refetch()} />} />;
  }

  const set = <K extends keyof ProfileUpdate>(key: K, value: ProfileUpdate[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setStatus({ kind: "idle" });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!me || !form) return;
    setStatus({ kind: "saving" });
    try {
      const saved = await updateProfile(me, form);
      client.setQueryData(accountKeys.profile, saved);
      setForm(toForm(saved));
      await refreshAccount();
      setStatus({ kind: "saved", message: "Perfil salvo." });
    } catch (error) {
      setStatus({ kind: "error", message: accountErrorMessage(error) ?? "Não foi possível salvar o perfil agora. Tente de novo." });
    }
  }

  const municipalityHint = (() => {
    if (!uf) return "Escolha a UF antes.";
    if (municipalities.isPending) return "Carregando os municípios da UF…";
    if (municipalities.isError) return "Não foi possível carregar os municípios agora.";
    if (municipalities.data.length === 0) return "O catálogo de municípios desta UF ainda não foi carregado.";
    return null;
  })();
  const name = form.displayName || form.fullName || me.email;
  const providerAvatar = profile.data.providerAvatarUrl;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <form onSubmit={submit} className="space-y-6" aria-describedby={`${id}-privacy`} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${id}-full`} label="Nome">
            <input id={`${id}-full`} className={FIELD_CONTROL} value={form.fullName ?? ""} maxLength={120} autoComplete="name"
              onChange={(e) => set("fullName", e.target.value || null)} />
          </Field>
          <Field id={`${id}-display`} label="Nome de exibição" hint="Aparece no topo da sua conta.">
            <input id={`${id}-display`} className={FIELD_CONTROL} value={form.displayName ?? ""} maxLength={80} autoComplete="nickname"
              aria-describedby={hintId(`${id}-display`)} onChange={(e) => set("displayName", e.target.value || null)} />
          </Field>
        </div>

        <Field id={`${id}-email`} label="E-mail" hint="É a identidade do seu login (Google ou link por e-mail) e não muda por aqui.">
          <input id={`${id}-email`} className={`${FIELD_CONTROL} bg-subtle text-fg-soft`} value={profile.data.email} readOnly
            aria-describedby={hintId(`${id}-email`)} />
        </Field>

        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-2 text-label uppercase text-fg-muted">Território</legend>
          <Field id={`${id}-uf`} label="UF">
            <select id={`${id}-uf`} className={FIELD_CONTROL} value={uf ?? ""}
              onChange={(e) => {
                setForm((f) => (f ? { ...f, stateCode: e.target.value || null, municipalityIbgeCode: null } : f));
                setStatus({ kind: "idle" });
              }}>
              <option value="">Não informar</option>
              {UFS.map((code) => <option key={code} value={code}>{UF_NAMES[code]}</option>)}
            </select>
          </Field>
          <Field id={`${id}-municipality`} label="Município" hint={municipalityHint}>
            <select id={`${id}-municipality`} className={FIELD_CONTROL} value={form.municipalityIbgeCode ?? ""}
              disabled={!uf || !municipalities.isSuccess || municipalities.data.length === 0}
              aria-describedby={hintId(`${id}-municipality`)} onChange={(e) => set("municipalityIbgeCode", e.target.value || null)}>
              <option value="">Não informar</option>
              {(municipalities.data ?? []).map((m) => <option key={m.ibgeCode} value={m.ibgeCode}>{m.name}</option>)}
            </select>
          </Field>
        </fieldset>

        <Field id={`${id}-usage`} label="Como você usa o REPBrasil" className="sm:max-w-sm">
          <select id={`${id}-usage`} className={FIELD_CONTROL} value={form.usageType ?? ""}
            onChange={(e) => set("usageType", (e.target.value || null) as UsageType | null)}>
            <option value="">Prefiro não informar</option>
            {Object.entries(USAGE_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>

        <fieldset>
          <legend className="text-label uppercase text-fg-muted">Avatar</legend>
          <div className="mt-3 flex items-center gap-4">
            <AccountAvatar name={name} avatarUrl={form.avatarHidden ? null : providerAvatar} size="lg" />
            {providerAvatar ? (
              <div className="space-y-2 text-body-sm text-fg">
                <label className="flex items-center gap-2">
                  <input type="radio" name="avatar" className="focus-ring" checked={!form.avatarHidden} onChange={() => set("avatarHidden", false)} />
                  Foto da conta Google
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="avatar" className="focus-ring" checked={form.avatarHidden} onChange={() => set("avatarHidden", true)} />
                  Iniciais
                </label>
              </div>
            ) : (
              <p className="text-body-sm text-fg-muted">Sua conta não tem foto de provedor; usamos as iniciais do nome.</p>
            )}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
          <button type="submit" disabled={status.kind === "saving"}
            className="focus-ring mi-press rounded-lg bg-action px-5 py-2.5 text-body-sm font-semibold text-action-fg disabled:cursor-wait disabled:opacity-60">
            {status.kind === "saving" ? "Salvando…" : "Salvar perfil"}
          </button>
          <p role={status.kind === "error" ? "alert" : "status"} className={`text-body-sm ${status.kind === "error" ? "text-danger" : "text-fg-soft"}`}>
            {status.message}
          </p>
        </div>
      </form>

      <aside id={`${id}-privacy`} className="border-t border-line pt-6 text-body-sm text-fg-muted lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <h2 className="text-label uppercase text-fg-muted">O que guardamos</h2>
        <p className="mt-3">
          UF e município servem só para abrir o REPBrasil no seu território. O tipo de uso é opcional e ajuda a entender quem usa o
          produto.
        </p>
        <p className="mt-3 text-fg-soft">
          Não pedimos CPF, partido, candidato, ideologia, religião nem intenção de voto, e nada disso é inferido do seu uso.
        </p>
      </aside>
    </div>
  );
}
