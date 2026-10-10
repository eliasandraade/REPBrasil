import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@/motion/motion.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import { INDEXING, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: { default: "REPBrasil — eleições brasileiras, da urna ao candidato", template: `%s · ${SITE_NAME}` },
  description:
    "Resultados oficiais do TSE por seção, zona e município, com o histórico de cada candidatura, patrimônio declarado e contas de campanha.",
  applicationName: SITE_NAME,
  // Sem endereço público definitivo + permissão explícita, nada é indexado (local e staging nunca aparecem em busca).
  robots: INDEXING ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { siteName: SITE_NAME, locale: "pt_BR", type: "website" },
  twitter: { card: "summary" },
};

// Marca `html.js` antes da primeira pintura: estados iniciais de revelação só
// existem com JS ativo (sem JS, todo o conteúdo fica visível de imediato).
const JS_MARKER = "document.documentElement.classList.add('js')";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: JS_MARKER }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
