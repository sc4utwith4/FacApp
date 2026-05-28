import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { UiRenderErrorBoundary } from "@/components/ui/ui-render-error-boundary";
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Info,
  PlusCircle,
  TrendingDown,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const formatPercent = (value: number) =>
  `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100)}`;

const formatDelta = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "" : "±"}${formatCurrency(Math.abs(value))}`;

const trendClasses = (value: number) =>
  value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground";

const trendIcon = (value: number) =>
  value > 0 ? <TrendingUp className="h-4 w-4" /> : value < 0 ? <TrendingDown className="h-4 w-4" /> : <MinusIcon />;

const MinusIcon = () => <span className="inline-block h-4 w-4" aria-hidden="true">–</span>;

export type AlertSeverity = "warning" | "info" | "success";

export interface AlertItem {
  type: AlertSeverity;
  title: string;
  description: string;
}

export interface ContaResumo {
  id: string;
  descricao: string;
  saldoAtual: number;
  bancoNome?: string | null;
  status: boolean;
  percentualDoTotal: number;
  variacao?: number;
}

export interface FluxoPoint {
  data: string;
  saldo: number;
  entradas: number;
  saidas: number;
}

export interface ContasEstoquesAnalytics {
  periodoDescricao: string;
  contasSaldoTotal: number;
  contasSaldoVariacao: number;
  contasSaldoVariacaoPercentual: number;
  contasAtivas: number;
  contasInativas: number;
  contasConciliadas: number;
  contas: ContaResumo[];
  estoque: {
    total: number;
    variacao: number;
    variacaoPercentual: number;
    sppro: number;
    soi: number;
    mix: Array<{ label: string; value: number; percent: number }>;
  };
  saldoGlobal?: number; // Saldo global = contas + estoques + aplicação
  aplicSaldoTotal?: number; // Saldo total das contas de aplicação
  aplicSaldoVariacao?: number; // Variação das contas de aplicação
  saldoGlobalVariacao?: number; // Variação total do saldo global
  saldoGlobalVariacaoPercentual?: number; // Percentual de variação do saldo global
  totalDevolucoes?: number; // Total de devoluções pendentes/parcialmente transferidas
  devolucoesSPPRO?: number; // Total de devoluções SPPRO
  devolucoesSOI?: number; // Total de devoluções SOI
  fluxoDiario: FluxoPoint[];
  entradasTotais: number;
  saidasTotais: number;
  topDespesas: Array<{
    grupo: string;
    valor: number;
    percentual: number;
  }>;
  balancoMes: {
    entradas: number;
    saidas: number;
    resultado: number;
  };
  alerts: AlertItem[];
}

interface ContasEstoquesViewProps {
  data: ContasEstoquesAnalytics | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const quickActions = [
  {
    label: "Conciliar saldos",
    description: "Revise contas com divergências e confirme movimentos",
    to: "/contas-estoque",
    icon: CheckCircle2,
  },
  {
    label: "Nova operação",
    description: "Crie compras, vendas ou transferências de estoque",
    to: "/operacoes",
    icon: ClipboardList,
  },
  {
    label: "Novo lançamento",
    description: "Registre entradas e saídas financeiras instantaneamente",
    to: "/lancamentos",
    icon: PlusCircle,
  },
  {
    label: "Transferir entre contas",
    description: "Movimente saldos em tempo real entre contas bancárias",
    to: "/operacoes?tab=transferencias",
    icon: ArrowRightLeft,
  },
] as const;

const alertIconMap: Record<AlertSeverity, React.ReactNode> = {
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-primary" />,
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
};

const AlertBadgeMap: Record<AlertSeverity, string> = {
  warning: "bg-amber-500/10 text-amber-600",
  info: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
};

export function ContasEstoquesView({ data, loading, error, onRetry }: ContasEstoquesViewProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="border-border/40">
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader>
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle>Não foi possível carregar os dados</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onRetry} variant="outline" className="mt-2">
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle>Visão indisponível</CardTitle>
          <CardDescription>
            Ajuste os filtros ou tente recarregar para visualizar os dados financeiros.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onRetry} variant="outline">
            Atualizar visão
          </Button>
        </CardContent>
      </Card>
    );
  }

  const {
    periodoDescricao,
    contasSaldoTotal,
    contasSaldoVariacao,
    contasSaldoVariacaoPercentual,
    contasAtivas,
    contasInativas,
    contasConciliadas,
    contas,
    estoque,
    fluxoDiario,
    entradasTotais,
    saidasTotais,
    topDespesas,
    balancoMes,
    alerts,
  } = data;

  const contasOrdenadas = [...contas].sort((a, b) => b.saldoAtual - a.saldoAtual);
  const primaryAccounts = contasOrdenadas.slice(0, 6);

  const hasAlerts = alerts.length > 0;
  const fluxoFirstPoint = fluxoDiario[0]?.data ?? "empty";
  const fluxoLastPoint = fluxoDiario[fluxoDiario.length - 1]?.data ?? "empty";
  const fluxoChartKeyBase = `fluxo:${fluxoDiario.length}:${String(fluxoFirstPoint)}:${String(fluxoLastPoint)}`;

  return (
    <div className="space-y-10">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr),minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Saldo bancário"
              value={formatCurrency(contasSaldoTotal)}
              aux={periodoDescricao}
              delta={contasSaldoVariacao}
              deltaPercent={contasSaldoVariacaoPercentual}
            />
            <MetricCard
              title="Contas conciliadas"
              value={`${contasConciliadas}/${contasAtivas}`}
              aux={`${contasInativas} inativas`}
              delta={contasConciliadas - (contasAtivas - contasConciliadas)}
            />
            <MetricCard
              title="Mix de estoque"
              value={formatCurrency(estoque.total)}
              aux={estoque.mix.map((item) => `${item.label} ${item.percent.toFixed(0)}%`).join(" • ")}
              delta={estoque.variacao}
              deltaPercent={estoque.variacaoPercentual}
            />
          </div>

          <Card className="border-border/40">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Contas em operação</CardTitle>
                <CardDescription>Distribuição de saldos por instituição</CardDescription>
              </div>
              <Badge variant="secondary" className="border border-border/40 bg-background/80">
                {contasAtivas} contas ativas
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {primaryAccounts.map((conta) => (
                <div
                  key={conta.id}
                  className="group flex items-center justify-between rounded-xl border border-border/60 bg-background/80 p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <CreditCardGlyph />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {conta.descricao}
                        <Badge
                          variant={conta.status ? "secondary" : "outline"}
                          className={conta.status ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground"}
                        >
                          {conta.status ? "Ativa" : "Inativa"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {conta.bancoNome ?? "Instituição não informada"}
                      </p>
                      <div className="flex items-center gap-3">
                        <Progress
                          value={Math.min(100, Math.max(0, conta.percentualDoTotal))}
                          className="h-2 w-40 bg-foreground/5"
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          {conta.percentualDoTotal.toFixed(1)}% da carteira
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(conta.saldoAtual)}
                    </p>
                    {typeof conta.variacao === "number" && (
                      <span className={`flex items-center justify-end gap-1 text-xs ${trendClasses(conta.variacao)}`}>
                        {trendIcon(conta.variacao)}
                        {formatDelta(conta.variacao)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {contasOrdenadas.length > primaryAccounts.length && (
                <p className="text-xs text-muted-foreground">
                  +{contasOrdenadas.length - primaryAccounts.length} contas adicionais ocultas para manter o foco nas de maior impacto.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-base">Ações rápidas</CardTitle>
              <CardDescription>Operações estratégicas mais utilizadas pela equipe</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-auto justify-start gap-3 rounded-xl border-border/60 bg-background/90 p-4 text-left hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <action.icon className="h-4 w-4" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">{action.label}</span>
                    <span className="text-xs text-muted-foreground">{action.description}</span>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">Alertas & oportunidades</CardTitle>
                <CardDescription>
                  Monitoramento automático de liquidez, estoques e obrigações
                </CardDescription>
              </div>
              <Badge variant="secondary" className="bg-muted text-muted-foreground">
                {alerts.length || 0} ativos
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasAlerts ? (
                alerts.map((alert, index) => (
                  <div
                    key={`${alert.title}-${index}`}
                    className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/80 p-4"
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${AlertBadgeMap[alert.type]}`}>
                      {alertIconMap[alert.type]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{alert.title}</p>
                      <p className="text-xs text-muted-foreground">{alert.description}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border/50 bg-background/70 p-6 text-center text-sm text-muted-foreground">
                  Tudo certo! Nenhum alerta relevante para o período selecionado.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Saldos de estoque</h2>
            <p className="text-sm text-muted-foreground">
              Acompanhe liquidez dos estoques SPPRO e SOI para planejar novas operações.
            </p>
          </div>
          <Badge variant="outline" className="border-primary/30 text-primary">
            Mix prioritário: {estoque.mix.map((item) => `${item.label} ${item.percent.toFixed(0)}%`).join(" • ")}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StockCard
            title="SPPRO"
            value={estoque.sppro}
            accent="from-indigo-500/20 via-indigo-500/10 to-transparent"
          />
          <StockCard
            title="SOI"
            value={estoque.soi}
            accent="from-emerald-500/20 via-emerald-500/10 to-transparent"
          />
          <StockCard
            title="Total estoque"
            value={estoque.total}
            accent="from-primary/20 via-primary/10 to-transparent"
            delta={estoque.variacao}
            deltaPercent={estoque.variacaoPercentual}
          />
        </div>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-base">Distribuição do estoque</CardTitle>
            <CardDescription>
              Percentual de participação de cada linha dentro do estoque consolidado
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {estoque.mix.map((item) => (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>{item.label}</span>
                  <span>{formatCurrency(item.value)} • {item.percent.toFixed(1)}%</span>
                </div>
                <Progress
                  value={item.percent}
                  className="h-2 bg-foreground/5"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-3">
          <InsightCard
            title="Saldo diário"
            description={periodoDescricao}
            total={formatCurrency(contasSaldoTotal)}
            delta={contasSaldoVariacao}
          >
            <UiRenderErrorBoundary
              scope="dashboard/ContasEstoquesView/SaldoDiario"
              resetKey={`${fluxoChartKeyBase}:saldo`}
            >
              <ResponsiveContainer width="100%" height={120}>
                <RechartsLineChart key={`${fluxoChartKeyBase}:saldo`} data={fluxoDiario}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="data" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <RechartsTooltip
                    isAnimationActive={false}
                    formatter={(value: number) => formatCurrency(Number(value))}
                    labelFormatter={(label) => new Date(label).toLocaleDateString("pt-BR")}
                    contentStyle={{ borderRadius: 12 }}
                  />
                  <Line
                    isAnimationActive={false}
                    animationDuration={0}
                    type="monotone"
                    dataKey="saldo"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                </RechartsLineChart>
              </ResponsiveContainer>
            </UiRenderErrorBoundary>
          </InsightCard>

          <InsightCard
            title="Entradas"
            description="Total no período"
            total={formatCurrency(entradasTotais)}
            delta={entradasTotais - saidasTotais / 3}
          >
            <UiRenderErrorBoundary
              scope="dashboard/ContasEstoquesView/Entradas"
              resetKey={`${fluxoChartKeyBase}:entradas`}
            >
              <ResponsiveContainer width="100%" height={120}>
                <RechartsLineChart key={`${fluxoChartKeyBase}:entradas`} data={fluxoDiario}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="data" hide />
                  <YAxis hide domain={[0, 'auto']} />
                  <RechartsTooltip
                    isAnimationActive={false}
                    formatter={(value: number) => formatCurrency(Number(value))}
                    labelFormatter={(label) => new Date(label).toLocaleDateString("pt-BR")}
                    contentStyle={{ borderRadius: 12 }}
                  />
                  <Line
                    isAnimationActive={false}
                    animationDuration={0}
                    type="monotone"
                    dataKey="entradas"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                  />
                </RechartsLineChart>
              </ResponsiveContainer>
            </UiRenderErrorBoundary>
          </InsightCard>

          <InsightCard
            title="Saídas"
            description="Total no período"
            total={formatCurrency(saidasTotais)}
            delta={-saidasTotais / 2}
          >
            <UiRenderErrorBoundary
              scope="dashboard/ContasEstoquesView/Saidas"
              resetKey={`${fluxoChartKeyBase}:saidas`}
            >
              <ResponsiveContainer width="100%" height={120}>
                <RechartsLineChart key={`${fluxoChartKeyBase}:saidas`} data={fluxoDiario}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="data" hide />
                  <YAxis hide domain={[0, 'auto']} />
                  <RechartsTooltip
                    isAnimationActive={false}
                    formatter={(value: number) => formatCurrency(Number(value))}
                    labelFormatter={(label) => new Date(label).toLocaleDateString("pt-BR")}
                    contentStyle={{ borderRadius: 12 }}
                  />
                  <Line
                    isAnimationActive={false}
                    animationDuration={0}
                    type="monotone"
                    dataKey="saidas"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={false}
                  />
                </RechartsLineChart>
              </ResponsiveContainer>
            </UiRenderErrorBoundary>
          </InsightCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),minmax(0,1fr)]">
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-base">Top despesas</CardTitle>
              <CardDescription>Maiores saídas agrupadas por categoria financeira</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {topDespesas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem despesas registradas para o período.</p>
              ) : (
                topDespesas.map((despesa, index) => (
                  <div key={despesa.grupo} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{index + 1}.</span>
                        <span className="text-sm font-medium text-foreground">{despesa.grupo}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        {formatCurrency(despesa.valor)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/5">
                      <div
                        className="h-full rounded-full bg-destructive/80"
                        style={{ width: `${despesa.percentual}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{despesa.percentual.toFixed(0)}% das saídas totais</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-base">Balanço do mês</CardTitle>
              <CardDescription>Comparativo mensal consolidado</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Entradas</span>
                  <span className="text-sm font-semibold text-success">
                    {formatCurrency(balancoMes.entradas)}
                  </span>
                </div>
                <Progress
                  value={balancoMes.entradas + balancoMes.saidas > 0
                    ? (balancoMes.entradas / (balancoMes.entradas + balancoMes.saidas)) * 100
                    : 0}
                  className="h-2 bg-foreground/5"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Saídas</span>
                  <span className="text-sm font-semibold text-destructive">
                    {formatCurrency(balancoMes.saidas)}
                  </span>
                </div>
                <Progress
                  value={balancoMes.entradas + balancoMes.saidas > 0
                    ? (balancoMes.saidas / (balancoMes.entradas + balancoMes.saidas)) * 100
                    : 0}
                  className="h-2 bg-foreground/5"
                />
              </div>
              <div className="rounded-xl border border-border/50 bg-background/80 p-4">
                <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                  <span>Resultado do mês</span>
                  <span className={trendClasses(balancoMes.resultado)}>
                    {formatCurrency(balancoMes.resultado)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  aux?: string;
  delta?: number;
  deltaPercent?: number;
}

const MetricCard = ({ title, value, aux, delta = 0, deltaPercent }: MetricCardProps) => (
  <Card className="border-border/40 bg-gradient-to-br from-background via-background to-primary/5">
    <CardHeader className="space-y-2">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>{title}</span>
      </div>
      <CardTitle className="text-2xl font-semibold text-foreground">{value}</CardTitle>
      {aux && <CardDescription>{aux}</CardDescription>}
    </CardHeader>
    {(delta || deltaPercent) && (
      <CardContent className="pt-0">
        <div className={`flex items-center gap-2 text-xs font-medium ${trendClasses(delta)}`}>
          {trendIcon(delta)}
          <span>{formatDelta(delta)}</span>
          {typeof deltaPercent === "number" && !Number.isNaN(deltaPercent) && (
            <span className="text-muted-foreground">({formatPercent(deltaPercent)})</span>
          )}
        </div>
      </CardContent>
    )}
  </Card>
);

interface StockCardProps {
  title: string;
  value: number;
  accent: string;
  delta?: number;
  deltaPercent?: number;
}

const StockCard = ({ title, value, accent, delta = 0, deltaPercent }: StockCardProps) => (
  <Card className={`border-border/40 bg-gradient-to-br ${accent}`}>
    <CardHeader className="space-y-2">
      <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Warehouse className="h-4 w-4" />
        {title}
      </CardTitle>
      <CardDescription className="text-2xl font-semibold text-foreground">
        {formatCurrency(value)}
      </CardDescription>
    </CardHeader>
    <CardContent className="text-xs text-muted-foreground">
      <div className={`flex items-center gap-1 ${trendClasses(delta)}`}>
        {trendIcon(delta)}
        {delta !== 0 ? formatDelta(delta) : "Estável"}
        {typeof deltaPercent === "number" && !Number.isNaN(deltaPercent) && (
          <span className="text-muted-foreground">({formatPercent(deltaPercent)})</span>
        )}
      </div>
    </CardContent>
  </Card>
);

interface InsightCardProps {
  title: string;
  description: string;
  total: string;
  delta?: number;
  children: React.ReactNode;
}

const InsightCard = ({ title, description, total, delta = 0, children }: InsightCardProps) => (
  <Card className="border-border/40">
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base text-foreground">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Badge variant="outline" className={trendClasses(delta)}>
          {delta === 0 ? "Estável" : formatDelta(delta)}
        </Badge>
      </div>
      <p className="text-xl font-semibold text-foreground">{total}</p>
    </CardHeader>
    <CardContent className="pt-0">{children}</CardContent>
  </Card>
);

const CreditCardGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" className="fill-current opacity-70" />
    <rect x="3" y="9" width="18" height="2" className="fill-background" />
    <rect x="7" y="13" width="4" height="2" className="fill-background" />
  </svg>
);
