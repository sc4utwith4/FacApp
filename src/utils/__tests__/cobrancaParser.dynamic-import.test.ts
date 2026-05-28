import { describe, expect, it, vi } from "vitest";
import { parsePlanilhaExcel } from "@/utils/cobrancaParser";

const xlsxState = vi.hoisted(() => ({
  factoryCalls: 0,
}));

vi.mock("xlsx", () => {
  xlsxState.factoryCalls += 1;

  return {
    read: vi.fn(() => ({
      SheetNames: ["Titulos"],
      Sheets: {
        Titulos: {},
      },
    })),
    utils: {
      sheet_to_json: vi.fn(() => [
        ["identificador", "valor", "vencimento", "status"],
        ["ABC-1", "123,45", "2026-04-01", "ABERTO"],
      ]),
    },
  };
});

describe("cobrancaParser dynamic import", () => {
  it("loads xlsx only when parse is executed", async () => {
    expect(xlsxState.factoryCalls).toBe(0);

    const file = new File([new ArrayBuffer(16)], "titulos.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await parsePlanilhaExcel(file);

    expect(xlsxState.factoryCalls).toBe(1);
    expect(Array.isArray(result.titulos)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
