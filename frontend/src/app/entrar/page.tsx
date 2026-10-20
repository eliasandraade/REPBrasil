"use client";

import { FormEvent, useEffect, useState } from "react";
import { googleLoginUrl, requestMagicLink } from "@/lib/account";

// Códigos com que a API devolve um login recusado (AccountController) e o que eles significam.
const SIGN_IN_FAILURES = new Map([
  [
    "link-invalido",
    "Este link de acesso não pode ser usado: ele expirou, já foi usado ou foi aberto em um navegador diferente daquele em que foi pedido. Por segurança, peça um novo link e abra-o neste mesmo navegador.",
  ],
  ["estado-invalido", "Não foi possível confirmar o login com o Google neste navegador. Comece de novo por esta página."],
  ["google-cancelado", "O login com o Google foi cancelado."],
  ["google-falhou", "O Google não confirmou o acesso. É preciso uma conta Google com e-mail verificado; tente novamente."],
  ["google-indisponivel", "O login com o Google está indisponível no momento. Use o link por e-mail ou tente mais tarde."],
  ["conta-suspensa", "Esta conta está suspensa. Se você acredita que é um engano, fale com a equipe pela página de suporte."],
]);

function isLocalPath(value: string | null): value is string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
  return ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32);
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [returnTo, setReturnTo] = useState("/conta");
  const [failure, setFailure] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("returnTo");
    if (isLocalPath(next)) setReturnTo(next);
    setFailure(SIGN_IN_FAILURES.get(params.get("erro") ?? "") ?? null);
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
          Sua conta guarda seu perfil, favoritos, watchlist e alertas. O conteúdo público continua acessível sem login.
        </p>

        {failure && (
          <p className="mt-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-3 text-sm text-danger" role="alert">
            {failure}
          </p>
        )}

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
            className="focus-ring mi-press w-full rounded-lg bg-action px-4 py-3 text-sm font-semibold text-action-fg disabled:cursor-wait disabled:opacity-60"
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
          O REPBrasil não usa senha local. Sessões podem ser encerradas a qualquer momento pela sua conta.
        </p>
      </section>
    </main>
  );
}
