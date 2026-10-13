import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineNotice } from "@/components/pwa/OfflineNotice";
import { ServiceWorkerRegistration, serviceWorkerUrl } from "@/components/pwa/ServiceWorkerRegistration";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

afterEach(() => {
  cleanup();
  setOnline(true);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("aviso de conexão perdida", () => {
  it("não aparece com conexão", () => {
    setOnline(true);
    render(<OfflineNotice />);
    expect(screen.queryByTestId("offline-notice")).toBeNull();
  });

  it("avisa que os dados da página podem estar desatualizados ao perder a conexão e some ao voltar", () => {
    setOnline(true);
    render(<OfflineNotice />);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    const notice = screen.getByTestId("offline-notice");
    expect(notice.tagName).toBe("OUTPUT");
    expect(notice.textContent).toContain("Sem conexão.");
    expect(notice.textContent).toContain("podem estar desatualizadas");

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-notice")).toBeNull();
  });

  it("aparece já na montagem quando a página é restaurada sem conexão", () => {
    setOnline(false);
    render(<OfflineNotice />);
    expect(screen.getByTestId("offline-notice")).toBeTruthy();
  });
});

describe("registro do service worker", () => {
  it("usa a revisão do deploy na URL do worker", () => {
    expect(serviceWorkerUrl("6c4832d0")).toBe("/sw.js?v=6c4832d0");
    expect(serviceWorkerUrl("  ")).toBe("/sw.js?v=dev");
    expect(serviceWorkerUrl(undefined)).toBe("/sw.js?v=dev");
    expect(serviceWorkerUrl("a b&c")).toBe("/sw.js?v=a%20b%26c");
  });

  it("em produção registra o worker versionado no escopo raiz, sem cache HTTP do script", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_REPBRASIL_REVISION", "abc123");
    const register = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: { register } });

    render(<ServiceWorkerRegistration />);

    expect(register).toHaveBeenCalledWith("/sw.js?v=abc123", { scope: "/", updateViaCache: "none" });
  });

  it("fora de produção não registra", () => {
    vi.stubEnv("NODE_ENV", "test");
    const register = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: { register } });

    render(<ServiceWorkerRegistration />);

    expect(register).not.toHaveBeenCalled();
  });
});
