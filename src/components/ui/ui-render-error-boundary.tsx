import React from "react";
import { logger } from "@/lib/logger";

interface UiRenderErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly scope: string;
  readonly action?: string;
  readonly resetKey?: string | number;
  readonly fallback?: React.ReactNode;
  readonly onCapturedError?: (payload: {
    error: Error;
    componentStack: string;
    scope: string;
    action?: string;
    route: string;
  }) => void;
}

interface UiRenderErrorBoundaryState {
  readonly hasError: boolean;
}

const defaultFallback = (
  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
    Ocorreu uma falha ao renderizar este bloco. Recarregue a página para tentar novamente.
  </div>
);

export class UiRenderErrorBoundary extends React.Component<
  UiRenderErrorBoundaryProps,
  UiRenderErrorBoundaryState
> {
  constructor(props: UiRenderErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): UiRenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const route =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "server";

    logger.error("[ui-render-error-boundary]", {
      scope: this.props.scope,
      action: this.props.action ?? null,
      route,
      message: error.message,
      componentStack: info.componentStack,
    });

    this.props.onCapturedError?.({
      error,
      componentStack: info.componentStack,
      scope: this.props.scope,
      action: this.props.action,
      route,
    });
  }

  componentDidUpdate(prevProps: UiRenderErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      prevProps.resetKey !== undefined &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false });
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? defaultFallback;
    }

    return this.props.children;
  }
}

