import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserEmpresa } from "@/hooks/useUserEmpresa";
import { useEstoquesResumo } from "@/hooks/useEstoque";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2,
  ArrowUpRight,
  Building2,
  Wallet,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Warehouse,
  CircleAlert,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ContaResumo = {
  id: string;
  descricao: string;
  status: boolean;
  saldoAtual: number;
  bancoNome?: string | null;
  bancoCodigo?: string | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const formatPercent = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 0 }).format(value);

export function ContasEstoquesOverview() {
  const [activeTab, setActiveTab] = useState<"contas" | "estoque">("contas");
  const { empresaId, loading: loadingEmpresa, error: empresaError } = useUserEmpresa();
  const queryClient = useQueryClient();

  const {
    data: contas,
    isLoading: loadingContas,
    error: contasError,
  } = useQuery<ContaResumo[]>({
    queryKey: ["dashboard-contas-resumo", empresaId],
    enabled: !!empresaId && !loadingEmpresa,
    queryFn: async (): Promise<ContaResumo[]> => {
      if (!empresaId) {
        throw new Error("Empresa não encontrada");
      }

      const { data, error } = await supabase
        .from("contas_bancarias")
        .select(
          `
            id,
            descricao,
            saldo_atual,
            saldo_inicial,
            status,
            bancos (
              nome,
              codigo
            )
          `,
        )
        .eq("empresa_id", empresaId)
        .order("saldo_atual", { ascending: false });

      if (error) {
        throw new Error(`Erro ao carregar contas: ${error.message}`);
      }

      return (data ?? []).map((conta) => ({
        id: conta.id?.toString?.() ?? String(conta.id),
        descricao: conta.descricao ?? "-",
        status: Boolean(conta.status),
        // Usar mesma lógica de ContasEstoques: saldo_atual se definido (inclusive zero), senão saldo_inicial
        saldoAtual: conta.saldo_atual !== null && conta.saldo_atual !== undefined
          ? Number(conta.saldo_atual)
          : Number(conta.saldo_inicial ?? 0),
        bancoNome: conta.bancos?.nome ?? null,
        bancoCodigo: conta.bancos?.codigo ?? null,
      }));
    },
  });

  const {
    data: estoquesResumo,
    isLoading: loadingEstoques,
    error: estoquesError,
    refetch: refetchEstoques,
  } = useEstoquesResumo();

  const handleRefreshEstoques = () => {
    queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
    refetchEstoques();
  };

  const contasVisiveis = useMemo(() => contas ?? [], [contas]);
  const contasAtivas = useMemo(
    () => contasVisiveis.filter((conta) => conta.status),
    [contasVisiveis],
  );
  const contasInativas = useMemo(
    () => contasVisiveis.filter((conta) => !conta.status),
    [contasVisiveis],
  );

  const totalSaldoAtual = useMemo(
    () => contasVisiveis.reduce((acc, conta) => acc + conta.saldoAtual, 0),
    [contasVisiveis],
  );

  const topContas = useMemo(
    () =>
      contasVisiveis
        .slice()
        .sort((a, b) => b.saldoAtual - a.saldoAtual)
        .slice(0, 5),
    [contasVisiveis],
  );

  const noEstoquesAtivos = useMemo(
    () =>
      !loadingEstoques &&
      !estoquesError &&
      (estoquesResumo?.total === undefined || Number(estoquesResumo.total) === 0),
    [estoquesError, estoquesResumo?.total, loadingEstoques],
  );

  const hasErrors = empresaError || contasError || estoquesError;

  return (
    <section className="space-y-4">
      {hasErrors && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="h-4 w-4" />
          <span>
            {empresaError?.message ||
              contasError?.message ||
              estoquesError?.message ||
              "Não foi possível carregar os dados financeiros."}
          </span>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "contas" | "estoque")}
        className="space-y-6"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="contas">Contas Bancárias</TabsTrigger>
          <TabsTrigger value="estoque">Estoques SPPRO/SOI</TabsTrigger>
        </TabsList>

        <TabsContent value="contas">
          {loadingEmpresa || loadingContas ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Carregando contas bancárias...
            </div>
          ) : contasVisiveis.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>Nenhuma conta cadastrada</CardTitle>
                <CardDescription>
                  Centralize o controle financeiro cadastrando contas bancárias.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link to="/contas-estoque">
                    <span className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Criar primeira conta
                    </span>
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">Contas Bancárias</h3>
                  <p className="text-sm text-muted-foreground">
                    Panorama rápido das contas ativas e seus saldos consolidados.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link to="/contas-estoque">
                      <span className="flex items-center gap-2">
                        Ver página completa
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link to="/contas-estoque">
                      <span className="flex items-center gap-2">
                        Nova Conta
                        <Plus className="h-4 w-4" />
                      </span>
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Total de Contas"
                  value={contasVisiveis.length.toString()}
                  icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
                  description={`${contasAtivas.length} ativas`}
                />
                <MetricCard
                  title="Saldo Total Atual"
                  value={formatCurrency(totalSaldoAtual)}
                  icon={<Wallet className="h-4 w-4 text-success" />}
                  description="Soma dos saldos nas contas"
                  accent="success"
                />
                <MetricCard
                  title="Contas Inativas"
                  value={contasInativas.length.toString()}
                  icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
                  description={
                    contasVisiveis.length > 0
                      ? formatPercent(contasInativas.length / contasVisiveis.length)
                      : "0%"
                  }
                />
                <MetricCard
                  title="Saldo Médio"
                  value={formatCurrency(
                    contasVisiveis.length > 0 ? totalSaldoAtual / contasVisiveis.length : 0,
                  )}
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  description="Distribuição média por conta"
                />
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Top contas por saldo</CardTitle>
                    <CardDescription>As cinco contas com maior saldo disponível</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/contas-estoque">
                      <span className="flex items-center gap-2">
                        Gerenciar contas
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conta</TableHead>
                        <TableHead>Banco</TableHead>
                        <TableHead className="text-right">Saldo Atual</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topContas.map((conta) => (
                        <TableRow key={conta.id}>
                          <TableCell className="font-medium">{conta.descricao}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {conta.bancoNome
                              ? `${conta.bancoNome}${conta.bancoCodigo ? ` • ${conta.bancoCodigo}` : ""}`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(conta.saldoAtual)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={conta.status ? "default" : "secondary"}>
                              {conta.status ? "Ativa" : "Inativa"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="estoque">
          {loadingEstoques ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Carregando resumo dos estoques...
            </div>
          ) : noEstoquesAtivos ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>Nenhum estoque ativo</CardTitle>
                <CardDescription>
                  Cadastre operações para visualizar os saldos dos estoques SPPRO/SOI.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/contas-estoque">
                    <span className="flex items-center gap-2">
                      Cadastrar estoque
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/operacoes">
                    <span className="flex items-center gap-2">
                      Ver operações
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">Estoques SPPRO/SOI</h3>
                  <p className="text-sm text-muted-foreground">
                    Acompanhe rapidamente a posição consolidada dos estoques de duplicatas.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleRefreshEstoques}
                    disabled={loadingEstoques}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${loadingEstoques ? 'animate-spin' : ''}`} />
                    Atualizar
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/contas-estoque">
                      <span className="flex items-center gap-2">
                        Ver movimentações
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                  title="Saldo SPPRO"
                  value={formatCurrency(estoquesResumo?.sppro ?? 0)}
                  icon={<Warehouse className="h-4 w-4 text-blue-500" />}
                  description="Títulos SPPRO disponíveis"
                  accent="info"
                />
                <MetricCard
                  title="Saldo SOI"
                  value={formatCurrency(estoquesResumo?.soi ?? 0)}
                  icon={<Warehouse className="h-4 w-4 text-purple-500" />}
                  description="Títulos SOI disponíveis"
                  accent="violet"
                />
                <MetricCard
                  title="Estoque Total"
                  value={formatCurrency(estoquesResumo?.total ?? 0)}
                  icon={<TrendingDown className="h-4 w-4 text-primary" />}
                  description="Soma consolidada SPPRO + SOI"
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Resumo rápido</CardTitle>
                  <CardDescription>Detalhes essenciais para tomada de decisão</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
                    <h4 className="text-sm font-semibold text-muted-foreground">SPPRO</h4>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Saldo disponível</span>
                        <span className="font-medium">
                          {formatCurrency(estoquesResumo?.sppro ?? 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Participação no total</span>
                        <span>
                          {estoquesResumo?.total
                            ? formatPercent((estoquesResumo.sppro ?? 0) / estoquesResumo.total)
                            : "0%"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
                    <h4 className="text-sm font-semibold text-muted-foreground">SOI</h4>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Saldo disponível</span>
                        <span className="font-medium">
                          {formatCurrency(estoquesResumo?.soi ?? 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Participação no total</span>
                        <span>
                          {estoquesResumo?.total
                            ? formatPercent((estoquesResumo.soi ?? 0) / estoquesResumo.total)
                            : "0%"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

type MetricCardProps = {
  title: string;
  value: string;
  description?: string;
  icon?: ReactNode;
  accent?: "success" | "info" | "violet";
};

function MetricCard({ title, value, description, icon, accent }: MetricCardProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden border border-border/60 shadow-sm transition-transform hover:-translate-y-0.5",
        accent === "success" && "border-success/40 bg-success/5",
        accent === "info" && "border-blue-500/40 bg-blue-500/5",
        accent === "violet" && "border-purple-500/40 bg-purple-500/5",
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}

export default ContasEstoquesOverview;

