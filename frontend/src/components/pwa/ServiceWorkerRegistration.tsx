"use client";

import { useEffect } from "react";

/** URL do worker com a revisão do deploy: um deploy novo instala um worker novo (sem cache velho). */
export function serviceWorkerUrl(revision: string | undefined): string {
  return `/sw.js?v=${encodeURIComponent(revision?.trim() || "dev")}`;
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register(serviceWorkerUrl(process.env.NEXT_PUBLIC_REPBRASIL_REVISION), { scope: "/", updateViaCache: "none" })
        .catch((error: unknown) => {
          console.error("Falha ao registrar o service worker do REPBrasil.", error);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
