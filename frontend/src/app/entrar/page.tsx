"use client";

import { FormEvent, useEffect, useState } from "react";
import { googleLoginUrl, requestMagicLink } from "@/lib/account";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [returnTo, setReturnTo] = useState("/conta");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("returnTo");
    if (next?.startsWith("/") && !next.startsWith("//")) setReturnTo(next);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    try {
      await requestMagicLink(email, returnTo);
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-text">Conta REPBrasil</p>
        <h1 className="mt-2 text-2xl font-semibold text-fg">Entre sem senha</h1>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Sua conta guarda favoritos, watchlist, alertas e credenciais da API. O conteúdo público continua acessível sem login.
        </p>

        <a
          href={googleLoginUrl(returnTo)}
          className="focus-ring mt-6 flex w-full items-center justify-center rounded-lg border border-line bg-canvas px-4 py-3 text-sm font-semibold text-fg hover:bg-fg/[0.04]"
        >
          Continuar com Google
        </a>

        <div className="my-5 flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-line" /> ou <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium text-fg" htmlFor="account-email">E-mail</label>
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@exemplo.com"
            className="focus-ring w-full rounded-lg border border-line bg-canvas px-3 py-3 text-sm text-fg placeholder:text-fg-muted"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="focus-ring w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {state === "sending" ? "Enviando…" : "Receber link de acesso"}
          </button>
        </form>

        {state === "sent" && (
          <p className="mt-4 rounded-lg border border-line bg-canvas px-3 py-3 text-sm text-fg-soft" role="status">
            Se o endereço puder receber o acesso, o link chegará em instantes e expirará em 15 minutos.
          </p>
        )}
        {state === "error" && (
          <p className="mt-4 text-sm text-danger" role="alert">O login por e-mail está indisponível agora. Tente novamente ou use o Google.</p>
        )}

        <p className="mt-6 text-xs leading-5 text-fg-muted">
          O REPBrasil não usa senha local. Sessões podem ser revogadas e chaves de API nunca são armazenadas em texto aberto.
        </p>
      </section>
    </main>
  );
}
