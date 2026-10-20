"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { accountErrorMessage, createApiKey, getApiKeys, logout, revokeApiKey, type CreatedApiKey } from "@/lib/account";
import { accountKeys, useAccount } from "@/lib/useAccount";
import { formatDate, formatDateTime } from "./format";

/** Segurança: sessão atual e saída. O acesso programático legado fica recolhido, sem crescer. */
export function SecuritySection() {
  const { data: me } = useAccount();
  const [state, setState] = useState<"idle" | "leaving" | "error">("idle");
  if (!me) return null;

  async function signOut() {
    setState("leaving");
    try {
      await logout(me!.csrfToken);
      // Navegação completa: zera o estado do cliente (cache da conta incluído) sem corrida com o redirecionamento do hub.
      window.location.assign("/");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="max-w-3xl space-y-12">
      <section aria-labelledby="security-session">
        <h2 id="security-session" className="text-label uppercase text-fg-muted">Sessão</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body-sm">
          <dt className="text-fg-muted">Conta</dt>
          <dd className="text-fg">{me.email}</dd>
          <dt className="text-fg-muted">Esta sessão vale até</dt>
          <dd className="text-fg">{formatDateTime(me.sessionExpiresAt)}</dd>
          <dt className="text-fg-muted">Senha</dt>
          <dd className="text-fg-soft">O REPBrasil não usa senha: o acesso é pelo Google ou por link de uso único enviado ao seu e-mail.</dd>
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => void signOut()} disabled={state === "leaving"}
            className="focus-ring mi-press rounded-lg border border-line-strong px-4 py-2.5 text-body-sm font-semibold text-fg hover:bg-fg/[0.04] disabled:opacity-60">
            {state === "leaving" ? "Saindo…" : "Sair desta sessão"}
          </button>
          {state === "error" && <p role="alert" className="text-body-sm text-danger">Não foi possível sair agora. Tente de novo.</p>}
        </div>
      </section>

      <LegacyApiAccess />
    </div>
  );
}

/**
 * Acesso programático (legado): mantido por compatibilidade com integrações existentes. Listar e revogar ficam
 * à vista de quem abrir; a criação fica recolhida. Não é argumento de plano.
 */
function LegacyApiAccess() {
  const { data: me } = useAccount();
  const client = useQueryClient();
  const keys = useQuery({ queryKey: accountKeys.apiKeys, queryFn: getApiKeys, enabled: !!me });
  const [name, setName] = useState("Minha integração");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await client.invalidateQueries({ queryKey: accountKeys.apiKeys });
    } catch (failure) {
      setError(accountErrorMessage(failure) ?? "Não foi possível concluir agora. Tente de novo.");
    }
  }

  return (
    <details className="group border-t border-line pt-6">
      <summary className="focus-ring cursor-pointer list-none rounded text-label uppercase text-fg-muted">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        Acesso programático (legado)
      </summary>
      <div className="mt-4 space-y-4 text-body-sm">
        <p className="text-fg-muted">
          Chaves para integrações antigas. O segredo aparece uma única vez; o servidor guarda só o hash. Revogue o que não usar.
        </p>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {keys.isPending && <DataState kind="loading" title="Carregando chaves" />}
        {keys.isError && !keys.data && <DataState kind="error" title="Não foi possível carregar as chaves" action={<RetryButton onRetry={() => void keys.refetch()} />} />}
        {keys.data && keys.data.length === 0 && <p className="text-fg-muted">Nenhuma chave criada.</p>}
        {keys.data && keys.data.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {keys.data.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-fg">{key.name} <code className="ml-1 text-micro text-fg-muted">{key.prefix}…</code></p>
                  <p className="text-micro text-fg-muted">
                    Criada em {formatDate(key.createdAt)} · {key.revoked ? "revogada" : "ativa"}
                  </p>
                </div>
                {!key.revoked && (
                  <button type="button" onClick={() => void run(() => revokeApiKey(me, key.id))} aria-label={`Revogar a chave ${key.name}`}
                    className="focus-ring rounded-md border border-line px-3 py-1.5 text-micro font-medium text-fg">
                    Revogar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => setCreated(await createApiKey(me, name)));
          }}
        >
          <label className="text-micro text-fg-muted">
            Nome da nova chave
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              className="focus-ring mt-1 block w-60 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-body-sm text-fg" />
          </label>
          <button type="submit" className="focus-ring rounded-md border border-line px-3 py-1.5 text-body-sm font-medium text-fg hover:bg-fg/[0.04]">Criar chave</button>
        </form>
        {created && (
          <div className="border-l-2 border-warn pl-3" role="status">
            <p className="text-label uppercase text-fg-muted">Copie agora</p>
            <code className="mt-1 block break-all text-fg">{created.secret}</code>
            <p className="mt-1 text-micro text-fg-muted">Depois de sair desta tela, a chave completa não pode ser recuperada.</p>
          </div>
        )}
      </div>
    </details>
  );
}
