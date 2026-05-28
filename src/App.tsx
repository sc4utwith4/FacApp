import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import Auth from "./pages/Auth";
import AuthConfirm from "./pages/AuthConfirm";
import AcceptInvite from "./pages/AcceptInvite";
import NotFound from "./pages/NotFound";
import { AdminRoute } from "./components/AdminRoute";
import { AppShell } from "./components/Layout/app-shell";

const DashboardAvancado = lazy(() => import("./pages/DashboardAvancado"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const GruposContas = lazy(() => import("./pages/GruposContas"));
const ContasEstoques = lazy(() => import("./pages/ContasEstoques"));
const ContasFixas = lazy(() => import("./pages/ContasFixas"));
const ProjecaoCaixa = lazy(() => import("./pages/ProjecaoCaixa"));
const FechamentoMensal = lazy(() => import("./pages/FechamentoMensal"));
const Fornecedores = lazy(() => import("./pages/Fornecedores"));
const OperacoesEstoque = lazy(() => import("./pages/OperacoesEstoque"));
const SeedData = lazy(() => import("./pages/SeedData"));
const AutoSeed = lazy(() => import("./pages/AutoSeed"));
const ContasAPagar = lazy(() => import("./pages/financeiro/ContasAPagar"));
const ContasAReceber = lazy(() => import("./pages/financeiro/ContasAReceber"));
const FinanceiroLancamentos = lazy(() => import("./pages/financeiro/Lancamentos"));
const ConciliacaoBancaria = lazy(() => import("./pages/financeiro/conciliacao-bancaria/Index"));
const Pagos = lazy(() => import("./pages/financeiro/Pagos"));
const Recebidos = lazy(() => import("./pages/financeiro/Recebidos"));
const CobrancaBancaria = lazy(() => import("./pages/financeiro/CobrancaBancaria"));
const ImportacaoCobranca = lazy(() => import("./pages/financeiro/cobranca-bancaria/Importacao"));
const FilaOcorrencias = lazy(() => import("./pages/financeiro/cobranca-bancaria/FilaOcorrencias"));
const Fechamentos = lazy(() => import("./pages/financeiro/cobranca-bancaria/Fechamentos"));
const DetalheTitulo = lazy(() => import("./pages/financeiro/cobranca-bancaria/DetalheTitulo"));
const Relatorios = lazy(() => import("./pages/financeiro/cobranca-bancaria/Relatorios"));
const RelatoriosBanco = lazy(() => import("./pages/financeiro/cobranca-bancaria/RelatoriosBanco"));
const AICopilot = lazy(() => import("./pages/AICopilot"));
const OperacoesIaIndex = lazy(() => import("./pages/financeiro/operacoes-ia/Index"));

const DOM_SYNC_ERROR_PATTERNS = [
  "failed to execute 'removechild' on 'node'",
  "the node to be removed is not a child of this node",
  "notfounderror",
  "an error occurred in the <text> component",
];

function getNormalizedErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message.toLowerCase();
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "object" && value !== null && "message" in value) {
    return String((value as { message?: unknown }).message ?? "").toLowerCase();
  }
  return "";
}

function isDomSyncRenderError(value: unknown): boolean {
  const message = getNormalizedErrorMessage(value);
  return DOM_SYNC_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      onError: (error) => {
        if (process.env.NODE_ENV === "development") {
          console.error("Query error:", error);
        }
      },
    },
    mutations: {
      onError: (error) => {
        if (process.env.NODE_ENV === "development") {
          console.error("Mutation error:", error);
        }
      },
    },
  },
});

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[35vh] items-center justify-center">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
        <p className="text-muted-foreground text-sm">Carregando página...</p>
      </div>
    </div>
  );
}

function SuspendedRoute({ children }: { readonly children: ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
}

function ProtectedRoute({ children }: { readonly children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setAuthenticated(!!session);
      setLoading(false);
    };

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(!!session);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/auth" replace />;
  }

  return <AppShell>{children}</AppShell>;
}

function App() {
  useEffect(() => {
    document.documentElement.lang = "pt-BR";
    document.documentElement.setAttribute("translate", "no");
    document.body?.setAttribute("translate", "no");
  }, []);

  useEffect(() => {
    const seenSignatures = new Map<string, number>();

    const reportDomSyncIssue = (source: "window.error" | "window.unhandledrejection", payload: unknown) => {
      if (!isDomSyncRenderError(payload)) return;

      const route = `${window.location.pathname}${window.location.search}`;
      const message = getNormalizedErrorMessage(payload);
      const signature = `${source}:${route}:${message}`;
      const now = Date.now();
      const lastSeen = seenSignatures.get(signature) ?? 0;

      if (now - lastSeen < 3000) return;
      seenSignatures.set(signature, now);

      const stack =
        payload instanceof Error
          ? payload.stack
          : typeof payload === "object" && payload !== null && "stack" in payload
            ? String((payload as { stack?: unknown }).stack ?? "")
            : undefined;

      logger.error("[dom-sync-render-error]", {
        source,
        route,
        message,
        stack,
      });
    };

    const handleError = (event: ErrorEvent) => {
      reportDomSyncIssue("window.error", event.error ?? event.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportDomSyncIssue("window.unhandledrejection", event.reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Routes>
            <Route path="/auth/confirm" element={<AuthConfirm />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/auth" element={<Auth />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <DashboardAvancado />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/financeiro" element={<Navigate to="/financeiro/contas-a-pagar" replace />} />
            <Route
              path="/financeiro/contas-a-pagar"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <ContasAPagar />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/contas-a-receber"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <ContasAReceber />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/lancamentos"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <FinanceiroLancamentos />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/conciliacao-bancaria"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <ConciliacaoBancaria />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <CobrancaBancaria />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria/importacao"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <ImportacaoCobranca />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria/fila-ocorrencias"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <FilaOcorrencias />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria/fechamentos"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <Fechamentos />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria/titulo/:id"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <DetalheTitulo />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria/relatorios"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <Relatorios />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/cobranca-bancaria/relatorios-banco"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <RelatoriosBanco />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/pagos"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <Pagos />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/recebidos"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <Recebidos />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/financeiro/contas-fixas"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <ContasFixas />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/lancamentos" element={<Navigate to="/financeiro/lancamentos" replace />} />
            <Route path="/contas-fixas" element={<Navigate to="/financeiro/contas-fixas" replace />} />
            <Route
              path="/grupos-contas"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <GruposContas />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/contas-estoque"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <ContasEstoques />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/contas-bancarias" element={<Navigate to="/contas-estoque" replace />} />
            <Route
              path="/projecao-caixa"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <ProjecaoCaixa />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/fechamento-mensal"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <FechamentoMensal />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/relatorios" element={<Navigate to="/" replace />} />
            <Route
              path="/fornecedores"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <Fornecedores />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/operacoes"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <OperacoesEstoque />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/operacoes/ia"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <OperacoesIaIndex />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/estoque" element={<Navigate to="/operacoes" replace />} />
            <Route
              path="/seed-data"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <SeedData />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/auto-seed"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AutoSeed />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/dashboard-avancado" element={<Navigate to="/" replace />} />
            <Route
              path="/usuarios"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AdminRoute>
                      <Usuarios />
                    </AdminRoute>
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/ai-copilot"
              element={
                <ProtectedRoute>
                  <SuspendedRoute>
                    <AICopilot />
                  </SuspendedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
