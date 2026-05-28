import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const createBankLocalDevDiagnosticsPlugin = (apiProxyTarget: string): Plugin => ({
  name: "bank-local-dev-diagnostics",
  apply: "serve",
  configureServer(server) {
    let printed = false;
    const configuredPort = 8080;
    const printStatus = () => {
      if (printed) return;
      printed = true;

      const address = server.httpServer?.address();
      const actualPort =
        address && typeof address === "object" && "port" in address
          ? Number(address.port)
          : configuredPort;
      const localUrl = `http://localhost:${actualPort}/`;
      const portFallback = actualPort !== configuredPort;

      console.log(`[bank-dev] Frontend ativo: ${localUrl}`);
      console.log(`[bank-dev] Proxy /api -> ${apiProxyTarget}`);
      if (portFallback) {
        console.warn(
          `[bank-dev] Porta ${configuredPort} ocupada; Vite subiu em ${actualPort}. Use a URL acima.`
        );
      }
    };

    if (server.httpServer?.listening) {
      printStatus();
      return;
    }

    server.httpServer?.once("listening", printStatus);
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:3100";
  const buildId =
    env.VITE_APP_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "frontend-dev";
  return {
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [react(), createBankLocalDevDiagnosticsPlugin(apiProxyTarget), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      output: {
        // Forçar hash único baseado no conteúdo para cache busting
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
        // Não agrupar código da app em chunks nomeados: forçar `feature-*` para pastas inteiras
        // causou ReferenceError (TDZ) em produção ao alterar a ordem de avaliação ESM no Rollup.
        // Mantemos apenas split de `node_modules` abaixo.
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("jspdf") ||
            id.includes("jspdf-autotable") ||
            id.includes("xlsx") ||
            id.includes("pdfjs-dist") ||
            id.includes("html2canvas") ||
            id.includes("@react-pdf/renderer")
          ) {
            return "vendor-export";
          }

          if (id.includes("recharts")) {
            return "vendor-charts";
          }

          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("dompurify")) {
            return "vendor-markdown";
          }

          return "vendor-core";
        },
      },
    },
    // Limpar diretório de build antes de cada build
    emptyOutDir: true,
  },
  publicDir: "public",
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  };
});
