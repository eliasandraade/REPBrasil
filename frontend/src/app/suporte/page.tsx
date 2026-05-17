"use client";

import { useState } from "react";
import Link from "next/link";

// ─── Channel Card ─────────────────────────────────────────────────────────────

function ChannelCard({
  icon,
  title,
  description,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-white/8 bg-card p-5 transition-colors hover:border-brand/30">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-brand">
        {icon}
      </div>
      <h3 className="mb-1 font-semibold text-slate-100">{title}</h3>
      <p className="mb-3 flex-1 text-sm leading-relaxed text-slate-500">{description}</p>
      <span className="self-start rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">
        {badge}
      </span>
    </div>
  );
}

// ─── FAQ Item ─────────────────────────────────────────────────────────────────

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/8">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-4 text-left text-sm font-medium text-slate-200 transition-colors hover:text-slate-100"
      >
        {question}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`flex-shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <p className="pb-4 text-sm leading-relaxed text-slate-400">{answer}</p>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function QuestionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  );
}

function BugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
    </svg>
  );
}

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQS = [
  {
    question: "O REPBrasil é um órgão público?",
    answer:
      "Não. O REPBrasil é um produto da Andrade Systems, empresa privada. Não possui vínculo com órgãos governamentais, partidos políticos ou entidades públicas.",
  },
  {
    question: "O REPBrasil tem vínculo partidário?",
    answer:
      "Não. O REPBrasil opera sob princípio de neutralidade radical. Nenhuma afiliação partidária, governamental ou ideológica. Dados e metodologia são públicos e auditáveis.",
  },
  {
    question: "De onde vêm os dados?",
    answer:
      "Os dados são provenientes de bases públicas oficiais do Tribunal Superior Eleitoral (TSE): dados de candidaturas, declarações de bens e resultados eleitorais. Cada fonte possui SHA-256, data de importação e URL original disponíveis.",
  },
  {
    question: "Como contestar uma informação?",
    answer:
      "Pela central de contestação abaixo. Informe o dado questionado, a justificativa e, sempre que possível, uma fonte oficial ou documento comprobatório. A equipe REPBrasil avaliará e, se confirmada a inconsistência, realizará a correção com registro de alteração.",
  },
  {
    question: "O Score REPBrasil já está ativo?",
    answer:
      "Não. O Score REPBrasil está em desenvolvimento metodológico. Nenhum score definitivo é calculado ou exibido nesta fase. Os componentes planejados estão descritos no perfil de cada político, mas sem pontuação atribuída.",
  },
  {
    question: "O REPBrasil substitui as fontes oficiais?",
    answer:
      "Não. O REPBrasil organiza e contextualiza dados públicos, mas as fontes oficiais do TSE e demais órgãos permanecem como referência primária. Sempre consulte a fonte vinculada para decisões críticas.",
  },
  {
    question: "Os dados são atualizados em tempo real?",
    answer:
      "Não. Os dados são importados em ciclos controlados a partir das bases oficiais. A data de cada importação está registrada em cada fonte vinculada. A base atual reflete o ciclo eleitoral de 2024.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const TICKET_TYPES = [
  "Selecione o tipo de solicitação",
  "Dúvida geral",
  "Contestação de dado",
  "Correção de informação",
  "Solicitação institucional",
  "Erro técnico",
] as const;

export default function SuportePage() {
  const [type, setType] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [politician, setPolitician] = useState("");
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isValid =
    type && type !== TICKET_TYPES[0] && name.trim() && email.trim() && message.trim().length >= 30;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitted(true);
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <div className="hero-gradient border-b border-white/8 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            REPBrasil
          </Link>

          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>
            Central de suporte e contestação
          </div>

          <h1 className="mb-3 text-3xl font-bold leading-tight tracking-tight text-slate-100 sm:text-4xl">
            Central de Suporte
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-slate-400">
            Dúvidas, contestações fundamentadas e solicitações sobre dados públicos
            organizados pelo REPBrasil.
          </p>

          {/* Stats */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { value: "~48h", label: "Resposta média" },
              { value: "4", label: "Tipos de solicitação" },
              { value: "TSE", label: "Fonte dos dados" },
              { value: "AGPL", label: "Licença do código" },
            ].map(({ value, label }) => (
              <div key={label} className="rounded-lg border border-white/8 bg-card/50 p-3 text-center">
                <p className="text-lg font-bold text-brand">{value}</p>
                <p className="mt-0.5 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Channel cards */}
        <div className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ChannelCard
            icon={<QuestionIcon />}
            title="Dúvida Geral"
            description="Perguntas sobre funcionamento, dados ou metodologia do REPBrasil."
            badge="Resposta em ~48h"
          />
          <ChannelCard
            icon={<ShieldIcon />}
            title="Contestação de Dados"
            description="Questione informações com indicação de fonte oficial ou documento comprobatório."
            badge="Avaliado pela equipe"
          />
          <ChannelCard
            icon={<BriefcaseIcon />}
            title="Solicitação Institucional"
            description="Parcerias, acesso a dados, cobertura jornalística ou uso acadêmico."
            badge="Resposta prioritária"
          />
          <ChannelCard
            icon={<BugIcon />}
            title="Erro Técnico"
            description="Reporte problemas de funcionamento, dados ausentes ou inconsistências visuais."
            badge="Triagem em 24h"
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Form */}
          <div className="rounded-lg border border-white/8 bg-card p-6">
            <h2 className="mb-1 text-lg font-bold text-slate-100">
              Enviar solicitação
            </h2>
            <p className="mb-6 text-sm text-slate-500">
              Descreva sua solicitação e retornaremos em breve.
            </p>

            {submitted ? (
              <div className="rounded-lg border border-brand/25 bg-brand/8 p-6 text-center">
                <div className="mb-3 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/15">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  </div>
                </div>
                <p className="font-semibold text-slate-100">Solicitação recebida</p>
                <p className="mt-1 text-sm text-slate-400">
                  Responderemos em breve no e-mail informado.
                </p>
                <button
                  type="button"
                  onClick={() => { setSubmitted(false); setType(""); setName(""); setEmail(""); setOrg(""); setPolitician(""); setSource(""); setMessage(""); }}
                  className="mt-4 text-sm text-brand hover:text-brand-light"
                >
                  Enviar outra solicitação
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Type */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-type">
                    Tipo de solicitação *
                  </label>
                  <select
                    id="ticket-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    required
                    className="w-full rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  >
                    {TICKET_TYPES.map((t) => (
                      <option key={t} value={t === TICKET_TYPES[0] ? "" : t} disabled={t === TICKET_TYPES[0]}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Name + Email */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-name">
                      Nome *
                    </label>
                    <input
                      id="ticket-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="Seu nome"
                      className="w-full rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-email">
                      E-mail *
                    </label>
                    <input
                      id="ticket-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="seu@email.com"
                      className="w-full rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                </div>

                {/* Org (optional) */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-org">
                    Organização ou cargo{" "}
                    <span className="text-slate-600">(opcional)</span>
                  </label>
                  <input
                    id="ticket-org"
                    type="text"
                    value={org}
                    onChange={(e) => setOrg(e.target.value)}
                    placeholder="Ex.: Assessoria parlamentar, Veículo de imprensa..."
                    className="w-full rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                </div>

                {/* Politician (optional) */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-politician">
                    Político relacionado{" "}
                    <span className="text-slate-600">(opcional)</span>
                  </label>
                  <input
                    id="ticket-politician"
                    type="text"
                    value={politician}
                    onChange={(e) => setPolitician(e.target.value)}
                    placeholder="Nome do político ou link do perfil no REPBrasil"
                    className="w-full rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                </div>

                {/* Source (optional) */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-source">
                    Fonte oficial ou documento de referência{" "}
                    <span className="text-slate-600">(opcional, recomendado para contestações)</span>
                  </label>
                  <input
                    id="ticket-source"
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="URL ou descrição da fonte oficial"
                    className="w-full rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="ticket-message">
                    Mensagem * <span className="text-slate-600">(mínimo 30 caracteres)</span>
                  </label>
                  <textarea
                    id="ticket-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={4}
                    placeholder={
                      type === "Contestação de dado" || type === "Correção de informação"
                        ? "Indique com clareza o dado questionado, a justificativa e a fonte ou documento comprobatório..."
                        : "Descreva sua solicitação em detalhes..."
                    }
                    className="w-full resize-none rounded-md border border-white/10 bg-card-elevated px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                  <p className="mt-1 text-right text-xs text-slate-600">
                    {message.length} caracteres
                  </p>
                </div>

                {type === "Contestação de dado" && (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-slate-400">
                    Para contestar uma informação, indique com clareza o dado questionado, a justificativa e, sempre que possível, uma fonte oficial ou documento comprobatório.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!isValid}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-900 transition-all hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
                  Enviar solicitação
                </button>
              </form>
            )}
          </div>

          {/* FAQ */}
          <div>
            <h2 className="mb-6 text-lg font-bold text-slate-100">
              Dúvidas frequentes
            </h2>
            <div>
              {FAQS.map(({ question, answer }) => (
                <FaqItem key={question} question={question} answer={answer} />
              ))}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-10 rounded-lg border border-white/8 bg-card/50 p-4 text-center">
          <p className="text-xs text-slate-500">
            O REPBrasil é um produto da{" "}
            <span className="font-medium text-slate-400">Andrade Systems</span>. Não
            possui vínculo com órgãos públicos, partidos políticos ou candidatos.
            Dados de fontes oficiais do TSE.
          </p>
        </div>
      </div>
    </main>
  );
}
