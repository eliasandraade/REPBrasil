import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";
import "@/motion/motion.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import { THEME_INIT_SRC } from "@/components/theme/theme-script";
import { INDEXING, SITE_NAME, SITE_URL } from "@/lib/site";

// Inter Variable (OFL), servida do próprio domínio: sem requisição a terceiros em tempo de execução.
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: { default: "REPBrasil — Inteligência Eleitoral", template: `%s · ${SITE_NAME}` },
  description:
    "Resultados oficiais do TSE por seção, zona e município, com o histórico de cada candidatura, patrimônio declarado e contas de campanha.",
  applicationName: SITE_NAME,
  // Sem endereço público definitivo + permissão explícita, nada é indexado (local e staging nunca aparecem em busca).
  robots: INDEXING ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { siteName: SITE_NAME, locale: "pt_BR", type: "website" },
  twitter: { card: "summary_large_image" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F8FB" },
    { media: "(prefers-color-scheme: dark)", color: "#071A2E" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* `html.js` + tema resolvido antes da primeira pintura (estados de revelação só existem com JS).
            Síncrono de propósito: assíncrono pintaria o tema errado por um quadro. Arquivo pequeno, do próprio domínio. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={THEME_INIT_SRC} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
