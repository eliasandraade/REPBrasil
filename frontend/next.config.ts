import type { NextConfig } from "next";
import path from "path";

const revision = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.REPBRASIL_REVISION ?? "unknown";

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
    ],
  },
};

export default nextConfig;
