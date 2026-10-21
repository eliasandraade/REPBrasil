import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerritoryCanvas } from "@/components/territory/TerritoryCanvas";

afterEach(() => vi.restoreAllMocks());

describe("mapa territorial sem WebGL", () => {
  it("diz que o mapa não está disponível e aponta para a tabela com os mesmos dados", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <TerritoryCanvas
        level="state"
        stateCode="23"
        municipality={null}
        layer={null}
        view="mapa"
        hovered={null}
        onHover={() => undefined}
        onSelect={() => undefined}
        reduced={false}
        allowRelief={false}
        label="Mapa do Ceará"
      />,
    );
    expect(screen.getByTestId("territory-canvas-status").textContent).toBe("Mapa indisponível neste navegador (WebGL). A tabela abaixo traz os mesmos dados.");
    const region = screen.getByRole("region", { name: "Mapa do Ceará" });
    expect(document.getElementById(region.getAttribute("aria-describedby")!)?.textContent).toContain("use a lista de territórios logo abaixo");
    expect(screen.queryByTestId("map-controls")).toBeNull();
  });
});
