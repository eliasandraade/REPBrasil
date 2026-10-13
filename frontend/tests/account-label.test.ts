import { describe, expect, it } from "vitest";
import { savedPageLabel } from "@/lib/account";

describe("rótulo de página salva", () => {
  it("remove o sufixo do template de título do site", () => {
    expect(savedPageLabel("Dados · REPBrasil", "/dados")).toBe("Dados");
    expect(savedPageLabel("Fortaleza (CE) | REPBrasil", "x")).toBe("Fortaleza (CE)");
    expect(savedPageLabel("Partidos — REPBrasil", "x")).toBe("Partidos");
    expect(savedPageLabel("Rankings - repbrasil", "x")).toBe("Rankings");
  });

  it("preserva títulos sem o sufixo e usa a chave quando não há título", () => {
    expect(savedPageLabel("REPBrasil — Inteligência Eleitoral", "x")).toBe("REPBrasil — Inteligência Eleitoral");
    expect(savedPageLabel("   ", "/rankings?ano=2024")).toBe("/rankings?ano=2024");
    expect(savedPageLabel("· REPBrasil", "/dados")).toBe("/dados");
  });

  it("processa títulos patológicos em tempo linear", () => {
    const title = `${" ".repeat(50_000)}-x`;
    const started = performance.now();
    expect(savedPageLabel(title, "k")).toBe("-x");
    expect(performance.now() - started).toBeLessThan(250);
  });
});
