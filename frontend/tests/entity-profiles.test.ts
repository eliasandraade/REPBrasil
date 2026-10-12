import { describe, expect, it } from "vitest";
import {
  chooseFeaturedOffice,
  electionProfilePath,
  indicatorValueText,
  municipalityProfilePath,
  sortElectionSnapshots,
  stateProfilePath,
} from "@/lib/entities";

describe("PR I — perfis territoriais", () => {
  it("gera URLs estáveis para estado, município e eleição", () => {
    expect(stateProfilePath("CE")).toBe("/estados/ce");
    expect(municipalityProfilePath("CE", "Fortaleza")).toBe("/municipios/ce/fortaleza");
    expect(electionProfilePath(2022, 1)).toBe("/eleicoes/2022/1");
  });

  it("ordena pleitos do mais recente para o mais antigo", () => {
    const ordered = sortElectionSnapshots([
      { year: 2022, round: 1 },
      { year: 2024, round: 1 },
      { year: 2024, round: 2 },
    ]);
    expect(ordered.map((item) => `${item.year}-${item.round}`)).toEqual(["2024-2", "2024-1", "2022-1"]);
  });

  it("escolhe cargo titular deterministically sem vice/suplente", () => {
    expect(
      chooseFeaturedOffice(2022, [
        { code: 3, name: "Governador" },
        { code: 6, name: "Deputado Federal" },
      ]),
    ).toEqual({ code: 6, name: "Deputado Federal" });
    expect(
      chooseFeaturedOffice(2024, [
        { code: 13, name: "Vereador" },
        { code: 11, name: "Prefeito" },
      ]),
    ).toEqual({ code: 11, name: "Prefeito" });
  });

  it("preserva zero real e ausência como estados distintos", () => {
    expect(indicatorValueText(0, "%")).toBe("0%");
    expect(indicatorValueText(null, "%")).toBe("—");
  });
});
