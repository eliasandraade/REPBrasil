import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REPBrasil — Apenas dados. Sem discursos.",
  description:
    "Plataforma open source de transparência política e reputação pública documental. Dados públicos oficiais sobre políticos brasileiros.",
  keywords: ["transparência", "política", "dados públicos", "Brasil", "score público"],
  openGraph: {
    title: "REPBrasil",
    description: "Apenas dados. Sem discursos.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
