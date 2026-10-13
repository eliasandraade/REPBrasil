import { describe, expect, it } from "vitest";
import { describeAmendmentMunicipality as describeRaw, isCompleteCommittedTotal, type AmendmentMunicipality } from "@/lib/parliament";

// O Intl pt-BR separa "R$" do número com espaço não separável.
const describeAmendmentMunicipality = (row: AmendmentMunicipality) => describeRaw(row).replaceAll(String.fromCodePoint(0xa0), " ");

const base: AmendmentMunicipality = {
  municipalityIbgeCode: "2304400",
  municipalityName: "Fortaleza",
  amendmentCount: 2,
  committedAmount: 1500,
  committedAmountMissing: 0,
  paidAmount: 700,
  paidAmountMissing: 0,
  retrievedAt: "2026-10-13T00:00:00Z",
};

describe("mapa de emendas — ausência não vira zero nem total", () => {
  it("total completo é apresentado como total e pode colorir o mapa", () => {
    expect(describeAmendmentMunicipality(base)).toBe("2 emendas · R$ 1.500,00 empenhado · R$ 700,00 pago");
    expect(isCompleteCommittedTotal(base)).toBe(true);
  });

  it("soma com emendas sem valor publicado é marcada como parcial e não colore o mapa", () => {
    const partial = { ...base, committedAmountMissing: 1, paidAmountMissing: 2 };
    expect(describeAmendmentMunicipality(partial)).toBe(
      "2 emendas · R$ 1.500,00 empenhado (soma parcial: 1 emenda sem valor publicado) · R$ 700,00 pago (soma parcial: 2 emendas sem valor publicado)",
    );
    expect(isCompleteCommittedTotal(partial)).toBe(false);
  });

  it("nenhum valor publicado continua ausência explícita", () => {
    const unpublished = { ...base, amendmentCount: 1, committedAmount: null, committedAmountMissing: 1, paidAmount: null, paidAmountMissing: 1 };
    expect(describeAmendmentMunicipality(unpublished)).toBe("1 emenda · empenhado não publicado · pago não publicado");
    expect(isCompleteCommittedTotal(unpublished)).toBe(false);
  });
});
