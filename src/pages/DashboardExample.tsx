import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  CreditCard,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  DashboardLayout, 
  DashboardSection, 
  DashboardFullWidth,
  MetricCard, 
  ActivityFeed, 
  ChartCard 
} from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DashboardExample = () => {
  // Dados de exemplo para métricas
  const metrics = [
    {
      title: "Faturamento Mensal",
      value: "R$ 5.418.340",
      change: { value: "+12% vs mês anterior", type: "increase" as const },
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      title: "Lançamentos",
      value: "1.247",
      change: { value: "+8% vs semana passada", type: "increase" as const },
      icon: <DollarSign className="h-4 w-4" />,
    },
    {
      title: "Clientes Ativos",
      value: "342",
      change: { value: "5 novos esta semana", type: "neutral" as const },
      icon: <Users className="h-4 w-4" />,
    },
    {
      title: "Contas Bancárias",
      value: "8",
      change: { value: "Todas ativas", type: "neutral" as const },
      icon: <CreditCard className="h-4 w-4" />,
    },
  ];

  // Dados de exemplo para atividades
  const activities = [
    {
      id: "1",
      message: "Novo lançamento: Pagamento de fornecedor",
      timestamp: "Há 2 horas",
      type: "info" as const,
    },
    {
      id: "2",
      message: "Cliente João Silva fez depósito de R$ 5.000",
      timestamp: "Há 4 horas",
      type: "success" as const,
    },
    {
      id: "3",
      message: "Vencimento próximo: Conta de luz",
      timestamp: "Há 6 horas",
      type: "warning" as const,
    },
    {
      id: "4",
      message: "Erro na sincronização com banco",
      timestamp: "Ontem",
      type: "error" as const,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Título da página */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Visão geral do sistema financeiro
        </p>
      </div>

      {/* Grid de métricas */}
      <DashboardLayout>
        {metrics.map((metric) => (
          <MetricCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            change={metric.change}
            icon={metric.icon}
          />
        ))}
      </DashboardLayout>

      {/* Seção de gráficos e atividades */}
      <DashboardSection>
        <ActivityFeed
          title="Atividades Recentes"
          activities={activities}
        />
        
        <ChartCard title="Performance Mensal">
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Gráfico de performance</p>
              <p className="text-sm">Dados em tempo real</p>
            </div>
          </div>
        </ChartCard>
      </DashboardSection>

      {/* Tabela de lançamentos recentes */}
      <DashboardFullWidth>
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { id: 1, descrição: "Pagamento fornecedor", valor: "-R$ 2.500", data: "Hoje" },
                { id: 2, descrição: "Recebimento cliente", valor: "+R$ 5.000", data: "Hoje" },
                { id: 3, descrição: "Salário funcionários", valor: "-R$ 15.000", data: "Ontem" },
                { id: 4, descrição: "Venda produto", valor: "+R$ 3.200", data: "Ontem" },
              ].map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{item.descrição}</p>
                    <p className="text-sm text-muted-foreground">{item.data}</p>
                  </div>
                  <span className={cn(
                    "font-medium",
                    item.valor.startsWith("+") ? "text-success" : "text-destructive"
                  )}>
                    {item.valor}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </DashboardFullWidth>
    </div>
  );
};

export default DashboardExample;
