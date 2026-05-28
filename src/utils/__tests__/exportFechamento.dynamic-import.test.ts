import { describe, expect, it, vi } from "vitest";
import { exportarFechamentoExcel } from "@/utils/exportFechamento";
import type { FechamentoDiario } from "@/types/cobranca-bancaria";

const xlsxState = vi.hoisted(() => ({
  factoryCalls: 0,
  writeCalls: 0,
}));

vi.mock("xlsx", () => {
  xlsxState.factoryCalls += 1;

  return {
    utils: {
      book_new: vi.fn(() => ({ sheets: [] })),
      aoa_to_sheet: vi.fn(() => ({})),
      book_append_sheet: vi.fn(),
    },
    write: vi.fn(() => {
      xlsxState.writeCalls += 1;
      return new Uint8Array([1, 2, 3]);
    }),
  };
});

const supabaseState = vi.hoisted(() => ({
  fromCalls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const createBuilder = () => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lt: vi.fn(async () => ({ data: [] })),
    };
    return builder;
  };

  return {
    supabase: {
      from: vi.fn((table: string) => {
        supabaseState.fromCalls.push(table);
        return createBuilder();
      }),
    },
  };
});

describe("exportFechamento dynamic import", () => {
  it("loads xlsx only when excel export is requested", async () => {
    expect(xlsxState.factoryCalls).toBe(0);
    const createObjectURLMock = vi.fn(() => "blob:mocked-url");
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURLMock,
      configurable: true,
    });

    const fechamento: FechamentoDiario = {
      id: "f-1",
      empresa_id: "emp-1",
      data_fechamento: "2026-04-17",
      saldo_anterior_qtd: 1,
      saldo_anterior_valor: 100,
      entradas_qtd: 2,
      entradas_valor: 200,
      baixas_qtd: 1,
      baixas_valor: 50,
      saldo_atual_qtd: 2,
      saldo_atual_valor: 250,
      indicadores: {},
      validado_contra_banco: true,
      divergencia_valor: 0,
      created_at: "2026-04-17T00:00:00.000Z",
      updated_at: "2026-04-17T00:00:00.000Z",
      confirmado_por: null,
      confirmado_em: null,
      exportado_pdf_url: null,
      exportado_excel_url: null,
    };

    const url = await exportarFechamentoExcel(fechamento);

    expect(xlsxState.factoryCalls).toBe(1);
    expect(xlsxState.writeCalls).toBe(1);
    expect(supabaseState.fromCalls).toEqual(["titulos_cobranca", "eventos_cobranca"]);
    expect(url).toBe("blob:mocked-url");
    expect(createObjectURLMock).toHaveBeenCalled();
  });
});
