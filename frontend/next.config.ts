import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../"),
  // Endereço antigo do perfil (/politico/<id>) → novo (/politicos/<id>, que passa ao slug). Links já
  // publicados continuam funcionando; 308 preserva método e a consulta (?aba=...).
  redirects: () => Promise.resolve([{ source: "/politico/:id", destination: "/politicos/:id", permanent: true }]),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.camara.leg.br",
        pathname: "/internet/deputado/bandep/**",
      },
    ],
  },
};

export default nextConfig;
