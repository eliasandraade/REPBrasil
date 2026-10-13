"use client";

import { useEffect, useState } from "react";

/**
 * Aviso explícito de conexão perdida numa página já carregada. Os dados na tela vieram da rede antes
 * da queda; sem conexão, nada novo chega e eles podem ficar desatualizados — o produto diz isso em
 * vez de deixar a página parecer atual. Volta a esconder quando a conexão retorna (e as consultas
 * do TanStack Query refazem a busca ao reconectar).
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <output
      data-testid="offline-notice"
      className="sticky top-14 z-20 block border-b border-line-strong bg-surface px-4 py-3 text-sm text-fg shadow-sm lg:top-0"
    >
      <strong className="font-semibold">Sem conexão.</strong>{" "}
      As informações desta página foram carregadas antes da queda e podem estar desatualizadas. Reconecte-se para
      consultar a versão atual.
    </output>
  );
}
