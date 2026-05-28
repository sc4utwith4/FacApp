import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineChart } from "../LineChart";
import { BarChart } from "../BarChart";
import { PieChart } from "../PieChart";

const lineDataA = [
  { name: "01/01", valor: 1000 },
  { name: "02/01", valor: 1200 },
];

const lineDataB = [
  { name: "03/01", valor: 1300 },
  { name: "04/01", valor: 900 },
  { name: "05/01", valor: 1500 },
];

const pieDataA = [
  { name: "Entradas", value: 2000 },
  { name: "Saidas", value: 900 },
];

const pieDataB = [
  { name: "Entradas", value: 1800 },
  { name: "Saidas", value: 1100 },
  { name: "Ajustes", value: 200 },
];

describe("charts stability", () => {
  it("LineChart mantém ciclo mount -> rerender -> unmount sem exceção", () => {
    const { rerender, unmount } = render(
      <div style={{ width: 800, height: 300 }}>
        <LineChart data={lineDataA} dataKey="valor" name="Saldo" />
      </div>,
    );

    expect(() =>
      rerender(
        <div style={{ width: 800, height: 300 }}>
          <LineChart data={lineDataB} dataKey="valor" name="Saldo" />
        </div>,
      ),
    ).not.toThrow();

    expect(() => unmount()).not.toThrow();
  });

  it("BarChart mantém ciclo mount -> rerender -> unmount sem exceção", () => {
    const { rerender, unmount } = render(
      <div style={{ width: 800, height: 300 }}>
        <BarChart data={lineDataA} dataKey="valor" name="Movimentação" />
      </div>,
    );

    expect(() =>
      rerender(
        <div style={{ width: 800, height: 300 }}>
          <BarChart data={lineDataB} dataKey="valor" name="Movimentação" />
        </div>,
      ),
    ).not.toThrow();

    expect(() => unmount()).not.toThrow();
  });

  it("PieChart mantém ciclo mount -> rerender -> unmount sem exceção", () => {
    const { rerender, unmount } = render(
      <div style={{ width: 800, height: 300 }}>
        <PieChart data={pieDataA} dataKey="value" nameKey="name" />
      </div>,
    );

    expect(() =>
      rerender(
        <div style={{ width: 800, height: 300 }}>
          <PieChart data={pieDataB} dataKey="value" nameKey="name" />
        </div>,
      ),
    ).not.toThrow();

    expect(() => unmount()).not.toThrow();
  });
});

