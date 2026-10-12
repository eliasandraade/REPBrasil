import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";
import "@/motion/motion.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import { SaveCurrentPage } from "@/components/account/SaveCurrentPage";
import { THEME_INIT_SRC } from "@/components/theme/theme-script";
import { INDEXING, SITE_NAME, SITE_URL } from "@/lib/site";

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
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={THEME_INIT_SRC} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
          <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
            <SaveCurrentPage />
          </div>
        </Providers>
      </body>
    </html>
  );
}
