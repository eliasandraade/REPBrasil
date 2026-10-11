import type { MetadataRoute } from "next";

/** Manifesto do app (instalável). Ícones oficiais derivados do Brand Kit (public/brand). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "REPBrasil — Inteligência Eleitoral",
    short_name: "REPBrasil",
    description: "Dados eleitorais oficiais do Brasil, da urna ao candidato.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F5F8FB",
    theme_color: "#0B2D5B",
    categories: ["news", "education"],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
