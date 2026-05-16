import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "REPBrasil — Apenas dados. Sem discursos.",
  description:
    "Plataforma open source de transparência política e reputação pública documental.",
  keywords: ["transparência", "política", "dados públicos", "Brasil", "score público"],
  openGraph: {
    title: "REPBrasil",
    description: "Apenas dados. Sem discursos.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
