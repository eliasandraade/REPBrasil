import type { Metadata } from "next";
import { PresentationMode } from "@/components/live-election/presentation/PresentationMode";
import { LIVE_API_PATH } from "@/lib/live-election/api";
import { brazilMapShapes } from "@/lib/live-election/brazil-map.server";
import type { LiveEnvelope, LiveStatesPayload, LiveSummary } from "@/lib/live-election/types";
import { pageMetadata } from "@/lib/seo";
import { serverFetch } from "@/lib/server-api";

const PATH = "/apuracao/2026/presidente/segundo-turno/apresentacao";
const TITLE = "Modo apresentação — Apuração Presidente 2026, 2º turno | REPBrasil";
const DESCRIPTION = "Apuração presidencial do 2º turno de 2026 em tela cheia, para TV, telão e sala de reunião, com os dados oficiais do TSE.";

/** Mesmo ciclo da página da apuração: o placar chega pronto no HTML e o cliente segue pelo stream ao vivo. */
export const revalidate = 5;

const base = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH, absoluteTitle: true });

// Vista utilitária da página da apuração (que é a indexada): fora dos buscadores.
export const metadata: Metadata = { ...base, robots: { index: false, follow: true } };

export default async function LivePresidentSecondRoundPresentationPage() {
  const [summary, states] = await Promise.all([
    serverFetch<LiveEnvelope<LiveSummary>>(`${LIVE_API_PATH}/summary`, revalidate),
    serverFetch<LiveEnvelope<LiveStatesPayload>>(`${LIVE_API_PATH}/states`, revalidate),
  ]);
  return <PresentationMode initialSummary={summary.data} initialStates={states.data} mapShapes={brazilMapShapes()} />;
}
