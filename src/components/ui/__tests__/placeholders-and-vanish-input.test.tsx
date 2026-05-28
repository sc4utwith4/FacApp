import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceholdersAndVanishInput } from "../placeholders-and-vanish-input";

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
};

describe("PlaceholdersAndVanishInput", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const mockContext = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(800 * 800 * 4) })),
      beginPath: vi.fn(),
      rect: vi.fn(),
      stroke: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      font: "",
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockContext);
    requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
    requestAnimationFrameSpy.mockRestore();
  });

  it("submete a pergunta via formulário sem evento sintético customizado", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      expect(new FormData(event.currentTarget).get("question")).toBe("Qual é o saldo?");
    });
    const onChange = vi.fn();

    render(
      <PlaceholdersAndVanishInput
        placeholders={["placeholder 1", "placeholder 2"]}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByRole("textbox");
    await user.type(input, "Qual é o saldo?");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("mantém ciclo de visibilitychange + unmount sem lançar erro", () => {
    vi.useFakeTimers();
    setVisibilityState("visible");

    const { unmount } = render(
      <PlaceholdersAndVanishInput
        placeholders={["A", "B", "C"]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(3200);
    });

    expect(() => unmount()).not.toThrow();
    vi.useRealTimers();
  });
});
