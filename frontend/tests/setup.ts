import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Roteador e Link do Next substituídos em todos os testes (estado em tests/support/next.tsx); um arquivo de teste
// pode registrar o próprio mock, que prevalece.
vi.mock("next/navigation", async () => (await import("./support/next")).navigationMock());
vi.mock("next/link", async () => (await import("./support/next")).linkMock());

afterEach(() => cleanup());
