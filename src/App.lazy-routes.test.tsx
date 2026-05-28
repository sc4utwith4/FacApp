import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: authMocks.getSession,
      onAuthStateChange: authMocks.onAuthStateChange,
    },
  },
}));

vi.mock("./pages/Auth", () => ({
  default: () => <div>Auth Page Mock</div>,
}));

vi.mock("./pages/AuthConfirm", () => ({
  default: () => <div>Auth Confirm Mock</div>,
}));

vi.mock("./pages/AcceptInvite", () => ({
  default: () => <div>Accept Invite Mock</div>,
}));

vi.mock("./pages/NotFound", () => ({
  default: () => <div>Not Found Mock</div>,
}));

vi.mock("./components/Layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./components/AdminRoute", () => ({
  AdminRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./pages/ProjecaoCaixa", async () => {
  await new Promise((resolve) => setTimeout(resolve, 25));
  return {
    default: () => <div>Projecao Caixa Mock</div>,
  };
});

describe("App lazy routes", () => {
  beforeEach(() => {
    authMocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1" },
        },
      },
    });
    authMocks.onAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });
  });

  it("renders auth route without protected route gate", async () => {
    window.history.pushState({}, "", "/auth");
    const { default: App } = await import("./App");

    render(<App />);

    expect(await screen.findByText("Auth Page Mock")).toBeInTheDocument();
  });

  it("shows suspense fallback before lazy protected route resolves", async () => {
    window.history.pushState({}, "", "/projecao-caixa");
    const { default: App } = await import("./App");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Carregando página...")).toBeInTheDocument();
    });

    expect(await screen.findByText("Projecao Caixa Mock")).toBeInTheDocument();
  });
});
