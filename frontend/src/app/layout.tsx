import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "REPBrasil — Inteligência pública sobre agentes políticos brasileiros",
  description:
    "Plataforma de inteligência cívica com dados públicos oficiais, fontes rastreáveis e análise estruturada de agentes políticos. Um produto da Andrade Systems.",
  keywords: [
    "transparência",
    "política",
    "dados públicos",
    "Brasil",
    "TSE",
    "agentes políticos",
    "inteligência cívica",
  ],
  openGraph: {
    title: "REPBrasil — Inteligência pública sobre agentes políticos",
    description:
      "Dados públicos oficiais, fontes rastreáveis e análise estruturada. Um produto da Andrade Systems.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
