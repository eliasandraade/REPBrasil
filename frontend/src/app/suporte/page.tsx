"use client";

import { type FormEvent, useId, useState } from "react";
import { Field, FIELD_CONTROL, hintId } from "@/components/account/Field";
import { TransitionLink } from "@/motion/navigation";
import { accountErrorMessage, accountFetch } from "@/lib/account";
import { ApiError } from "@/lib/api";

const CATEGORIES = [
  { value: "duvida", label: "Dúvida geral" },
  { value: "contestacao", label: "Contestação de dado" },
  { value: "correcao_de_dado", label: "Correção de informação" },
  { value: "institucional", label: "Solicitação institucional" },
  { value: "erro_tecnico", label: "Erro técnico" },
  { value: "conta", label: "Conta e planos" },
] as const;

const FAQS = [
  {
    question: "O REPBrasil é um órgão público?",
    answer:
      "Não. O REPBrasil é um produto da Andrade Systems, empresa privada, sem vínculo com órgãos governamentais, partidos políticos ou candidatos.",
  },
  {
    question: "O REPBrasil tem vínculo partidário?",
    answer:
      "Não. Não há filiação partidária, governamental ou ideológica, o produto não recomenda voto e não rotula ninguém. Dados e metodologia são públicos e auditáveis.",
  },
  {
    question: "De onde vêm os dados?",
    answer:
      "Só de bases públicas oficiais: TSE (candidaturas, bens, resultados por seção e pesquisas registradas), IBGE e Atlas do Desenvolvimento Humano (indicadores municipais), Câmara dos Deputados e Portal da Transparência (atividade parlamentar e emendas). Cada fonte guarda o endereço original, a data da coleta e o hash do arquivo.",
  },
  {
    question: "Como contestar uma informação?",
    answer:
      "Por este formulário, em “Contestação de dado”: indique o dado, onde ele aparece e, sempre que possível, a fonte oficial ou o documento que mostra o valor correto. Confirmada a inconsistência, a correção é feita com registro da alteração; o histórico não é apagado.",
  },
  {
    question: "Os dados são atualizados em tempo real?",
    answer:
      "Não. As bases oficiais são importadas em ciclos controlados e cada página mostra a fonte e a data da coleta. A cobertura carregada varia por base; onde não há dado carregado, a página diz isso em vez de mostrar zero.",
  },
  {
    question: "O que é gratuito e o que é pago?",
    answer:
      "Todo dado público, mapas, fontes, metodologia e a data de atualização são gratuitos. Os planos pagos acrescentam espaço para acompanhar mais coisas, alertas de novas edições oficiais e ferramentas profissionais. O pagamento online ainda não está disponível.",
  },
  {
    question: "Que dados da minha conta vocês guardam?",
    answer:
      "E-mail de login, nome e, se você informar, UF, município e tipo de uso. Nunca pedimos CPF, partido, candidato, ideologia, religião ou intenção de voto.",
  },
  {
    question: "O Score REPBrasil já está ativo?",
    answer: "Não. O Score está em desenvolvimento metodológico; nenhuma pontuação é calculada ou exibida nesta fase.",
  },
];

function FaqItem({ question, answer }: Readonly<{ question: string; answer: string }>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-b border-line">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-answer`}
          onClick={() => setOpen((value) => !value)}
          className="focus-ring flex w-full items-center justify-between gap-4 rounded py-4 text-left text-body-sm font-medium text-fg-soft hover:text-fg"
        >
          {question}
          <span aria-hidden="true" className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-45" : ""}`}>+</span>
        </button>
      </h3>
      <div id={`${id}-answer`} hidden={!open}>
        <p className="pb-4 text-body-sm leading-relaxed text-fg-muted">{answer}</p>
      </div>
    </div>
  );
}

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; protocol: string; email: string } | { kind: "error"; message: string };

const EMPTY = { category: "", name: "", email: "", organization: "", relatedSubject: "", sourceReference: "", message: "" };

/** Suporte: o pedido é gravado e lido na caixa da equipe (Super Admin). Nada de confirmação falsa. */
export default function SuportePage() {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const set = (key: keyof typeof EMPTY, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const contestation = form.category === "contestacao" || form.category === "correcao_de_dado";
  const messageLength = form.message.trim().length;
  const valid = form.category !== "" && form.email.trim() !== "" && messageLength >= 30 && messageLength <= 5000;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setStatus({ kind: "sending" });
    try {
      const result = await accountFetch<{ status: string; id: string }>("/api/v1/support/requests", {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          name: form.name.trim() || null,
          email: form.email.trim(),
          organization: form.organization.trim() || null,
          relatedSubject: form.relatedSubject.trim() || null,
          sourceReference: form.sourceReference.trim() || null,
          message: form.message.trim(),
        }),
      });
      setStatus({ kind: "sent", protocol: result.id.slice(0, 8), email: form.email.trim() });
      setForm(EMPTY);
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "Muitos pedidos enviados a partir desta conexão. Tente de novo mais tarde."
          : accountErrorMessage(error) ?? "Não foi possível enviar agora. Tente de novo em instantes.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8">
      <header className="max-w-3xl border-b border-line pb-8">
        <p className="text-label uppercase text-fg-muted">Suporte</p>
        <h1 className="mt-2 text-heading-lg text-fg">Fale com a equipe</h1>
        <p className="mt-3 text-body-md leading-relaxed text-fg-soft">
          Dúvidas, contestações com fonte oficial e pedidos sobre os dados públicos organizados pelo REPBrasil. Cada pedido recebe um
          protocolo e entra na caixa da equipe.
        </p>
      </header>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="support-form-title">
          <h2 id="support-form-title" className="text-label uppercase text-fg-muted">Enviar pedido</h2>
          {status.kind === "sent" ? (
            <div role="status" className="mt-4 border-l-2 border-positive pl-4">
              <p className="text-body-md font-semibold text-fg">Pedido registrado · protocolo {status.protocol}</p>
              <p className="mt-1 text-body-sm text-fg-soft">A resposta vai para {status.email}.</p>
              <button type="button" onClick={() => setStatus({ kind: "idle" })} className="focus-ring mt-4 rounded text-body-sm font-medium text-accent-text underline underline-offset-2">
                Enviar outro pedido
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
              <Field id="support-category" label="Tipo de pedido">
                <select id="support-category" required className={FIELD_CONTROL} value={form.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="" disabled>Escolha</option>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="support-name" label="Nome (opcional)">
                  <input id="support-name" className={FIELD_CONTROL} maxLength={120} autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field id="support-email" label="E-mail para a resposta">
                  <input id="support-email" type="email" required className={FIELD_CONTROL} maxLength={254} autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="support-org" label="Organização ou cargo (opcional)">
                  <input id="support-org" className={FIELD_CONTROL} maxLength={160} value={form.organization} onChange={(e) => set("organization", e.target.value)} />
                </Field>
                <Field id="support-subject" label="Político, página ou dado (opcional)">
                  <input id="support-subject" className={FIELD_CONTROL} maxLength={240} value={form.relatedSubject} onChange={(e) => set("relatedSubject", e.target.value)} />
                </Field>
              </div>
              <Field id="support-source" label={contestation ? "Fonte oficial ou documento (recomendado)" : "Fonte oficial ou documento (opcional)"}
                hint={contestation ? "Endereço ou descrição da fonte que mostra o valor correto." : null}>
                <input id="support-source" className={FIELD_CONTROL} maxLength={500} value={form.sourceReference} aria-describedby={hintId("support-source")}
                  onChange={(e) => set("sourceReference", e.target.value)} />
              </Field>
              <Field id="support-message" label="Mensagem" hint={`${messageLength.toLocaleString("pt-BR")} caracteres (mínimo de 30)`}>
                <textarea id="support-message" required rows={6} maxLength={5000} className={`${FIELD_CONTROL} resize-y`} value={form.message}
                  aria-describedby={hintId("support-message")} onChange={(e) => set("message", e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-4">
                <button type="submit" disabled={!valid || status.kind === "sending"}
                  className="focus-ring mi-press rounded-lg bg-action px-5 py-2.5 text-body-sm font-semibold text-action-fg disabled:cursor-not-allowed disabled:opacity-50">
                  {status.kind === "sending" ? "Enviando…" : "Enviar pedido"}
                </button>
                {status.kind === "error" && <p role="alert" className="text-body-sm text-danger">{status.message}</p>}
              </div>
            </form>
          )}
        </section>

        <aside className="space-y-10">
          <section aria-labelledby="support-contest">
            <h2 id="support-contest" className="text-label uppercase text-fg-muted">Como contestar um dado</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-body-sm text-fg-soft">
              <li>Diga qual é o dado e onde ele aparece (link da página ou nome do político).</li>
              <li>Indique a fonte oficial ou o documento que mostra o valor correto.</li>
              <li>Confirmada a inconsistência, a correção entra com registro; o histórico não é apagado.</li>
            </ol>
            <p className="mt-3 text-body-sm text-fg-muted">
              Princípios em <TransitionLink href="/manifesto" className="focus-ring mi-underline rounded text-accent-text">Manifesto</TransitionLink>.
            </p>
          </section>
          <section aria-labelledby="support-faq">
            <h2 id="support-faq" className="text-label uppercase text-fg-muted">Dúvidas frequentes</h2>
            <div className="mt-2">
              {FAQS.map((faq) => <FaqItem key={faq.question} {...faq} />)}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
