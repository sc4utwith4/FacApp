import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UiRenderErrorBoundary } from "../ui-render-error-boundary";

function Boom() {
  throw new Error("boom");
}

function Healthy() {
  return <div>conteudo-ok</div>;
}

describe("UiRenderErrorBoundary", () => {
  it("captura erro de render e mostra fallback", () => {
    const onCapturedError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <UiRenderErrorBoundary
        scope="test/boundary"
        fallback={<div>fallback-boundary</div>}
        onCapturedError={onCapturedError}
      >
        <Boom />
      </UiRenderErrorBoundary>,
    );

    expect(screen.getByText("fallback-boundary")).toBeInTheDocument();
    expect(onCapturedError).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("reseta fallback quando resetKey muda", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <UiRenderErrorBoundary scope="test/reset" resetKey="erro" fallback={<div>fallback-reset</div>}>
        <Boom />
      </UiRenderErrorBoundary>,
    );

    expect(screen.getByText("fallback-reset")).toBeInTheDocument();

    rerender(
      <UiRenderErrorBoundary scope="test/reset" resetKey="ok" fallback={<div>fallback-reset</div>}>
        <Healthy />
      </UiRenderErrorBoundary>,
    );

    expect(screen.getByText("conteudo-ok")).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});

