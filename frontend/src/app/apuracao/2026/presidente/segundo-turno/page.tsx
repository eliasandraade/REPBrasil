import type { Metadata } from "next";
import { LiveElectionPage } from "@/components/live-election/LiveElectionPage";
import { LIVE_API_PATH } from "@/lib/live-election/api";
import { brazilMapShapes } from "@/lib/live-election/brazil-map.server";
import type { LiveEnvelope, LiveStatesPayload, LiveSummary } from "@/lib/live-election/types";
import { pageMetadata } from "@/lib/seo";
import { serverFetch } from "@/lib/server-api";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const PATH = "/apuracao/2026/presidente/segundo-turno";
const TITLE = "Apuração Presidente 2026 — 2º Turno em Tempo Real | REPBrasil";
const DESCRIPTION =
  "Acompanhe a totalização oficial do 2º turno presidencial de 2026: votos, percentuais, seções totalizadas, estados, municípios, comparecimento e situação matemática, com dados do TSE.";

/** HTML regenerado a cada 5 s no máximo: o placar chega pronto e o cliente segue pelo stream ao vivo. */
export const revalidate = 5;

const base = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH, absoluteTitle: true });

export const metadata: Metadata = {
  ...base,
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

function jsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: TITLE,
    description: DESCRIPTION,
    inLanguage: "pt-BR",
    ...(SITE_URL ? { url: `${SITE_URL}${PATH}` } : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, ...(SITE_URL ? { url: SITE_URL } : {}) },
    about: {
      "@type": "Event",
      name: "Eleição presidencial 2026 — 2º turno",
      startDate: "2026-10-25",
      location: { "@type": "Country", name: "Brasil" },
    },
    publisher: { "@type": "Organization", name: SITE_NAME },
  };
}

export default async function LivePresidentSecondRoundPage() {
  const [summary, states] = await Promise.all([
    serverFetch<LiveEnvelope<LiveSummary>>(`${LIVE_API_PATH}/summary`, revalidate),
    serverFetch<LiveEnvelope<LiveStatesPayload>>(`${LIVE_API_PATH}/states`, revalidate),
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()).replace(/</g, "\\u003c") }} />
      <LiveElectionPage initialSummary={summary.data} initialStates={states.data} mapShapes={brazilMapShapes()} />
    </>
  );
}
