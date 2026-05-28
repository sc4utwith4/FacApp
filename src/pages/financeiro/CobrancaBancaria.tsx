import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Receipt,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  AlertCircle,
  Calendar,
  Download,
  Upload,
  Filter,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardDia, TituloCobranca, StatusTitulo } from "@/types/cobranca-bancaria";
import { formatCurrency } from "@/lib/utils";
import { TitulosList } from "@/components/cobranca-bancaria/TitulosList";

export default function CobrancaBancaria() {
  const [dataSelecionada, setDataSelecionada] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Query para dashboard do dia
  const { data: dashboard, isLoading: isLoadingDashboard } = useQuery<DashboardDia>({
    queryKey: ["cobranca-dashboard", dataSelecionada],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // Buscar empresa_id do usuário
      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Buscar fechamento do dia anterior
      const dataAnterior = new Date(dataSelecionada);
      dataAnterior.setDate(dataAnterior.getDate() - 1);
      const dataAnteriorStr = dataAnterior.toISOString().split("T")[0];

      // Garantir formato ISO correto
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAnteriorStr)) {
        throw new Error(`Formato de data inválido: ${dataAnteriorStr}`);
      }

      const { data: fechamentoAnterior, error: fechamentoError } = await supabase
        .from("fechamentos_diarios")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .eq("data_fechamento", dataAnteriorStr)
        .maybeSingle();

      // Ignorar erro se não encontrar fechamento (é esperado para o primeiro dia)
      if (fechamentoError && fechamentoError.code !== "PGRST116") {
        console.error("Erro ao buscar fechamento anterior:", fechamentoError);
      }

      // Calcular entradas do dia (títulos criados hoje)
      const { count: entradasQtd, data: entradasData } = await supabase
        .from("titulos_cobranca")
        .select("valor_nominal", { count: "exact", head: false })
        .eq("empresa_id", profile.empresa_id)
        .gte("created_at", `${dataSelecionada}T00:00:00`)
        .lt("created_at", `${dataSelecionada}T23:59:59`);

      const entradasValor =
        entradasData?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;

      // Calcular baixas do dia (eventos de liquidação/baixa hoje)
      const { data: eventosBaixa } = await supabase
        .from("eventos_cobranca")
        .select("valor_liquido, titulo_id")
        .in("tipo_evento", ["LIQUIDACAO", "BAIXA"])
        .gte("data_evento", `${dataSelecionada}T00:00:00`)
        .lt("data_evento", `${dataSelecionada}T23:59:59`);

      const baixasQtd = eventosBaixa?.length || 0;
      const baixasValor =
        eventosBaixa?.reduce((acc, e) => acc + Number(e.valor_liquido || 0), 0) || 0;

      // Calcular saldo atual
      const { count: saldoQtd, data: titulosAbertos } = await supabase
        .from("titulos_cobranca")
        .select("valor_nominal", { count: "exact", head: false })
        .eq("empresa_id", profile.empresa_id)
        .in("status_atual", ["ABERTO", "PROTESTO_INSTRUIDO", "EM_CARTORIO"]);

      const saldoValor =
        titulosAbertos?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;

      return {
        saldo_anterior: {
          qtd: fechamentoAnterior?.saldo_atual_qtd || 0,
          valor: fechamentoAnterior?.saldo_atual_valor || 0,
        },
        entradas: {
          qtd: entradasQtd || 0,
          valor: entradasValor,
        },
        baixas: {
          qtd: baixasQtd,
          valor: baixasValor,
        },
        saldo_atual: {
          qtd: saldoQtd || 0,
          valor: saldoValor,
        },
      };
    },
  });

  // Query para títulos recentes
  const { data: titulosRecentes, isLoading: isLoadingTitulos } = useQuery<TituloCobranca[]>({
    queryKey: ["cobranca-titulos-recentes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { data } = await supabase
        .from("titulos_cobranca")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .order("created_at", { ascending: false })
        .limit(10);

      return data || [];
    },
  });

  // Query para fila de ocorrências pendentes
  const { data: ocorrenciasPendentes, isLoading: isLoadingOcorrencias } = useQuery({
    queryKey: ["cobranca-ocorrencias-pendentes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { count } = await supabase
        .from("fila_ocorrencias")
        .select("*", { count: "exact", head: true })
        .eq("empresa_id", profile.empresa_id)
        .eq("resolvido", false);

      return count || 0;
    },
  });

  const getStatusColor = (status: StatusTitulo) => {
    switch (status) {
      case "LIQUIDADO":
        return "text-green-600";
      case "ABERTO":
        return "text-blue-600";
      case "BAIXADO":
        return "text-gray-600";
      case "DEVOLVIDO":
        return "text-red-600";
      case "PROTESTO_INSTRUIDO":
      case "EM_CARTORIO":
        return "text-orange-600";
      default:
        return "text-gray-600";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Controle de Cobrança Bancária</h1>
          <p className="text-muted-foreground">
            Acompanhe títulos, conciliações e fechamentos diários
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/financeiro/cobranca-bancaria/importacao">
              <Upload className="mr-2 h-4 w-4" />
              Importar
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/financeiro/cobranca-bancaria/fechamentos">
              <Calendar className="mr-2 h-4 w-4" />
              Fechamentos
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/financeiro/cobranca-bancaria/relatorios-banco">
              <FileText className="mr-2 h-4 w-4" />
              Relatórios Banco
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="titulos">Títulos</TabsTrigger>
          <TabsTrigger value="ocorrencias" className="gap-2">
            <span>Fila de Ocorrências</span>
            {ocorrenciasPendentes && ocorrenciasPendentes > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">
                {ocorrenciasPendentes}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {/* Dashboard do Dia */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Anterior</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoadingDashboard ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {formatCurrency(dashboard?.saldo_anterior.valor || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {dashboard?.saldo_anterior.qtd || 0} títulos
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Entradas</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                {isLoadingDashboard ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(dashboard?.entradas.valor || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {dashboard?.entradas.qtd || 0} títulos
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Baixas</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                {isLoadingDashboard ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-red-600">
                      {formatCurrency(dashboard?.baixas.valor || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {dashboard?.baixas.qtd || 0} títulos
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Atual</CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoadingDashboard ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {formatCurrency(dashboard?.saldo_atual.valor || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {dashboard?.saldo_atual.qtd || 0} títulos
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Indicadores Adicionais */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Títulos em Cartório</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">-</div>
                <p className="text-xs text-muted-foreground">Em desenvolvimento</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Títulos com Protesto</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">-</div>
                <p className="text-xs text-muted-foreground">Em desenvolvimento</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Divergências</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">-</div>
                <p className="text-xs text-muted-foreground">Em desenvolvimento</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="titulos" className="space-y-4">
          <TitulosList />
        </TabsContent>

        <TabsContent value="ocorrencias" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Fila de Ocorrências</CardTitle>
              <CardDescription>
                Ocorrências pendentes de resolução
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOcorrencias ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="text-center text-muted-foreground">
                  <AlertCircle className="mx-auto h-12 w-12 mb-2 opacity-50" />
                  <p>Funcionalidade em desenvolvimento</p>
                  <Button asChild variant="outline" className="mt-4">
                    <Link to="/financeiro/cobranca-bancaria/fila-ocorrencias">
                      Ver Fila Completa
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

