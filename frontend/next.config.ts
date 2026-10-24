import type { NextConfig } from "next";
import path from "path";

const revision = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.REPBRASIL_REVISION ?? "unknown";

/** Fotos oficiais das candidaturas: cópia em cache servida pela API do REPBrasil (nunca direto do TSE). */
function apiImagePattern(): { protocol: "http" | "https"; hostname: string; port?: string; pathname: string } | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000");
    const protocol = url.protocol === "https:" ? "https" : "http";
    return { protocol, hostname: url.hostname, ...(url.port ? { port: url.port } : {}), pathname: "/api/v1/elections/**" };
  } catch {
    return null;
  }
}

const apiImages = apiImagePattern();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-RepBrasil-Revision", value: revision },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Versão do service worker (/sw.js?v=...): cada deploy instala um worker novo e poda os caches antigos.
  env: { NEXT_PUBLIC_REPBRASIL_REVISION: revision },
  outputFileTracingRoot: path.join(__dirname, "../"),
  redirects: () =>
    Promise.resolve([
      { source: "/politico/:id", destination: "/politicos/:id", permanent: true },
      { source: "/partido/:slug", destination: "/partidos/:slug", permanent: true },
    ]),
  headers: () =>
    Promise.resolve([
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          ...securityHeaders,
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]),
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.camara.leg.br",
        pathname: "/internet/deputado/bandep/**",
      },
      ...(apiImages ? [apiImages] : []),
    ],
  },
};

export default nextConfig;
