import { describe, expect, it, vi } from "vitest";
import { parsePDFBradesco } from "@/utils/parsePDFBradesco";

const pdfState = vi.hoisted(() => ({
  factoryCalls: 0,
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({
          items: [{ str: "Agência|Conta: 1234 | 56789" }, { str: "Data da operação: 10/02/2026" }],
        }),
      }),
    }),
  })),
  workerOptions: {
    workerSrc: "",
  },
}));

vi.mock("pdfjs-dist", () => {
  pdfState.factoryCalls += 1;

  return {
    version: "5.4.530",
    GlobalWorkerOptions: pdfState.workerOptions,
    getDocument: pdfState.getDocument,
  };
});

describe("parsePDFBradesco dynamic import", () => {
  it("loads pdfjs-dist only on parse execution", async () => {
    expect(pdfState.factoryCalls).toBe(0);

    const file = new File([new Uint8Array([37, 80, 68, 70])], "relatorio.pdf", {
      type: "application/pdf",
    });

    const result = await parsePDFBradesco(file);

    expect(pdfState.factoryCalls).toBe(1);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
