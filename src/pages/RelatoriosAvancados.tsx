import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, 
  BarChart3, 
  PieChart, 
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  Filter,
  FileSpreadsheet,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID } from "@/lib/uuid";
import { UiRenderErrorBoundary } from "@/components/ui/ui-render-error-boundary";

// Importar componentes de gráficos
import {
  AreaChart,
  Area,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface RelatorioData {
  periodo: string;
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  lancamentos: any[];
  porConta: any[];
  porGrupo: any[];
  porDia: any[];
}

export default function RelatoriosAvancados() {
  const [dataInicio, setDataInicio] = useState(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return primeiroDia.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => {
    const hoje = new Date();
    return hoje.toISOString().split('T')[0];
  });
  const [contaBancariaId, setContaBancariaId] = useState<string>("todos");
  const [contasBancarias, setContasBancarias] = useState<any[]>([]);
  const [relatorioData, setRelatorioData] = useState<RelatorioData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [activeTab, setActiveTab] = useState("resumo");
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  useEffect(() => {
    fetchEmpresaId();
  }, []);

  useEffect(() => {
    if (empresaId) {
      loadContasBancarias();
    }
  }, [empresaId]);

  useEffect(() => {
    if (dataInicio && dataFim && empresaId) {
      gerarRelatorio();
    }
  }, [dataInicio, dataFim, contaBancariaId, empresaId]);

  const fetchEmpresaId = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", session.user.id)
        .maybeSingle();
      
      if (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error("Erro ao buscar empresa_id:", error);
        }
        return;
      }
      
      if (profile?.empresa_id) {
        const empresaIdValue = ensureUUID(profile.empresa_id);
        if (empresaIdValue) {
          setEmpresaId(empresaIdValue);
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao buscar empresa_id:", error);
      }
    }
  };

  const loadContasBancarias = async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contas_bancarias')
        .select('id, descricao, bancos(nome)')
        .eq('empresa_id', empresaId)
        .order('descricao');
      
      if (error) throw error;
      setContasBancarias(data || []);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao carregar contas:', error);
      }
      toast.error('Erro ao carregar contas bancárias');
    }
  };

  const gerarRelatorio = async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      toast.error("Empresa não encontrada. Aguarde o carregamento.");
      return;
    }

    setLoading(true);
    try {
      // Buscar lançamentos
      let query = supabase
        .from('lancamentos_caixa')
        .select(`
          *,
          grupos_contas(nome, natureza),
          contas_bancarias(descricao, bancos(nome))
        `)
        .eq('empresa_id', empresaId)
        .gte('data', dataInicio)
        .lte('data', dataFim)
        .order('data');

      if (contaBancariaId !== 'todos') {
        query = query.eq('conta_bancaria_id', contaBancariaId);
      }

      const { data: lancamentos, error } = await query;
      if (error) throw error;

      // Calcular totais
      const totalEntradas = lancamentos
        ?.filter(l => l.tipo === 'entrada')
        .reduce((acc, l) => acc + l.valor, 0) || 0;

      const totalSaidas = lancamentos
        ?.filter(l => l.tipo === 'saida')
        .reduce((acc, l) => acc + l.valor, 0) || 0;

      // Agrupar por conta bancária
      const porConta = lancamentos?.reduce((acc, lanc) => {
        const contaId = lanc.conta_bancaria_id;
        const contaDesc = lanc.contas_bancarias?.descricao || 'Sem conta';
        
        if (!acc[contaId]) {
          acc[contaId] = {
            conta: contaDesc,
            entradas: 0,
            saidas: 0,
            saldo: 0
          };
        }
        
        if (lanc.tipo === 'entrada') {
          acc[contaId].entradas += lanc.valor;
        } else {
          acc[contaId].saidas += lanc.valor;
        }
        
        acc[contaId].saldo = acc[contaId].entradas - acc[contaId].saidas;
        return acc;
      }, {} as any) || {};

      // Agrupar por grupo de contas
      const porGrupo = lancamentos?.reduce((acc, lanc) => {
        const grupoId = lanc.grupo_contas_id;
        const grupoNome = lanc.grupos_contas?.nome || 'Sem grupo';
        
        if (!acc[grupoId]) {
          acc[grupoId] = {
            grupo: grupoNome,
            entradas: 0,
            saidas: 0,
            total: 0
          };
        }
        
        if (lanc.tipo === 'entrada') {
          acc[grupoId].entradas += lanc.valor;
        } else {
          acc[grupoId].saidas += lanc.valor;
        }
        
        acc[grupoId].total = acc[grupoId].entradas + acc[grupoId].saidas;
        return acc;
      }, {} as any) || {};

      // Agrupar por dia
      const porDia = lancamentos?.reduce((acc, lanc) => {
        const data = lanc.data;
        if (!acc[data]) {
          acc[data] = {
            data,
            entradas: 0,
            saidas: 0,
            saldo: 0
          };
        }
        
        if (lanc.tipo === 'entrada') {
          acc[data].entradas += lanc.valor;
        } else {
          acc[data].saidas += lanc.valor;
        }
        
        acc[data].saldo = acc[data].entradas - acc[data].saidas;
        return acc;
      }, {} as any) || {};

      setRelatorioData({
        periodo: `${dataInicio} a ${dataFim}`,
        totalEntradas,
        totalSaidas,
        saldo: totalEntradas - totalSaidas,
        lancamentos: lancamentos || [],
        porConta: Object.values(porConta),
        porGrupo: Object.values(porGrupo),
        porDia: Object.values(porDia).sort((a: any, b: any) => a.data.localeCompare(b.data))
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao gerar relatório:', error);
      }
      toast.error('Erro ao gerar relatório');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (value: string | Date | null | undefined) => {
    if (!value) return '-';

    const parsed =
      value instanceof Date
        ? value
        : new Date(typeof value === 'string' ? value : '');

    if (Number.isNaN(parsed.getTime())) {
      if (typeof value === 'string' && value.includes('T')) {
        const [datePart] = value.split('T');
        const sanitized = new Date(`${datePart}T00:00:00`);
        if (!Number.isNaN(sanitized.getTime())) {
          return sanitized.toLocaleDateString('pt-BR');
        }
      }
      return '-';
    }

    return parsed.toLocaleDateString('pt-BR');
  };

  // Exportar para PDF
  const exportarPDF = async () => {
    if (!relatorioData) return;

    try {
      setIsExportingPdf(true);
      const [jspdfModule, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const jsPDF =
        (jspdfModule as { jsPDF?: typeof import("jspdf")["jsPDF"]; default?: { jsPDF?: typeof import("jspdf")["jsPDF"] } })
          .jsPDF ??
        (jspdfModule as { default?: { jsPDF?: typeof import("jspdf")["jsPDF"] } }).default?.jsPDF;
      const autoTable = (
        "default" in autoTableModule && autoTableModule.default
          ? autoTableModule.default
          : autoTableModule
      ) as unknown as (doc: unknown, options: unknown) => void;

      if (!jsPDF || !autoTable) {
        throw new Error("Dependências de exportação PDF indisponíveis");
      }

      const doc = new jsPDF();

      // Cabeçalho
      doc.setFontSize(20);
      doc.text("Relatório de Caixa", 20, 20);
      doc.setFontSize(12);
      doc.text(`Período: ${relatorioData.periodo}`, 20, 30);
      doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 20, 35);

      // Resumo
      doc.setFontSize(14);
      doc.text("Resumo Financeiro", 20, 50);
      doc.setFontSize(10);
      doc.text(`Total de Entradas: ${formatCurrency(relatorioData.totalEntradas)}`, 20, 60);
      doc.text(`Total de Saídas: ${formatCurrency(relatorioData.totalSaidas)}`, 20, 65);
      doc.text(`Saldo: ${formatCurrency(relatorioData.saldo)}`, 20, 70);

      // Tabela de lançamentos
      doc.setFontSize(14);
      doc.text("Lançamentos Detalhados", 20, 85);

      const tableData = relatorioData.lancamentos.map((lanc) => [
        formatDate(lanc.data),
        lanc.historico || "Sem descrição",
        lanc.tipo === "entrada" ? "Entrada" : "Saída",
        formatCurrency(lanc.valor),
        lanc.contas_bancarias?.descricao || "Sem conta",
      ]);

      autoTable(doc, {
        head: [["Data", "Descrição", "Tipo", "Valor", "Conta"]],
        body: tableData,
        startY: 90,
        styles: { fontSize: 8 },
      });

      doc.save(`relatorio-caixa-${dataInicio}-${dataFim}.pdf`);
      toast.success("Relatório PDF gerado com sucesso!");
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Erro ao exportar PDF:", error);
      }
      toast.error("Erro ao exportar PDF");
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Exportar para Excel
  const exportarExcel = async () => {
    if (!relatorioData) return;

    try {
      setIsExportingExcel(true);
      const xlsxModule = await import("xlsx");
      const XLSX = ("default" in xlsxModule && xlsxModule.default ? xlsxModule.default : xlsxModule) as typeof import("xlsx");
      const wb = XLSX.utils.book_new();

      // Planilha 1: Resumo
      const resumoData = [
        ["Período", relatorioData.periodo],
        ["Total de Entradas", relatorioData.totalEntradas],
        ["Total de Saídas", relatorioData.totalSaidas],
        ["Saldo", relatorioData.saldo],
        ["Total de Lançamentos", relatorioData.lancamentos.length],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(resumoData);
      XLSX.utils.book_append_sheet(wb, ws1, "Resumo");

      // Planilha 2: Lançamentos
      const lancamentosData = relatorioData.lancamentos.map((lanc) => ({
        Data: formatDate(lanc.data),
        Descrição: lanc.historico || "Sem descrição",
        Tipo: lanc.tipo === "entrada" ? "Entrada" : "Saída",
        Valor: lanc.valor,
        Conta: lanc.contas_bancarias?.descricao || "Sem conta",
        Grupo: lanc.grupos_contas?.nome || "Sem grupo",
      }));
      const ws2 = XLSX.utils.json_to_sheet(lancamentosData);
      XLSX.utils.book_append_sheet(wb, ws2, "Lançamentos");

      // Planilha 3: Por Conta
      const contasData = relatorioData.porConta.map((conta: any) => ({
        Conta: conta.conta,
        Entradas: conta.entradas,
        Saídas: conta.saidas,
        Saldo: conta.saldo,
      }));
      const ws3 = XLSX.utils.json_to_sheet(contasData);
      XLSX.utils.book_append_sheet(wb, ws3, "Por Conta");

      XLSX.writeFile(wb, `relatorio-caixa-${dataInicio}-${dataFim}.xlsx`);
      toast.success("Relatório Excel gerado com sucesso!");
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Erro ao exportar Excel:", error);
      }
      toast.error("Erro ao exportar Excel");
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Dados para gráficos
  const dadosGrafico = relatorioData?.porDia.map((dia: any) => ({
    data: new Date(dia.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    entradas: dia.entradas,
    saidas: dia.saidas,
    saldo: dia.saldo
  })) || [];

  const dadosPizza = [
    { name: 'Entradas', value: relatorioData?.totalEntradas || 0, color: '#22c55e' },
    { name: 'Saídas', value: relatorioData?.totalSaidas || 0, color: '#ef4444' }
  ];
  const graficoFirstPoint = dadosGrafico[0]?.data ?? "empty";
  const graficoLastPoint = dadosGrafico[dadosGrafico.length - 1]?.data ?? "empty";
  const areaChartKey = `relatorios-avancados-area:${dadosGrafico.length}:${String(graficoFirstPoint)}:${String(graficoLastPoint)}`;
  const pieChartKey = `relatorios-avancados-pie:${dadosPizza.map((entry) => `${entry.name}:${entry.value}`).join("|")}`;

  return (
    <div className="space-y-6">
        <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border/40 bg-card p-6 shadow-subtle lg:p-8">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <Badge variant="secondary" className="w-fit gap-2 border border-primary/30 bg-primary/10 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Analytics em segundos
              </Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">
                  Relatórios Avançados
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Gere relatórios financeiros completos com filtros inteligentes, indicadores visuais e exportações em PDF ou Excel.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  Período ativo: {relatorioData?.periodo || `${dataInicio} a ${dataFim}`}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" />
                  {relatorioData?.lancamentos.length ?? 0} lançamentos analisados
                </span>
              </div>
            </div>

            <div className="flex flex-col items-start gap-2 lg:items-end">
              <Button
                onClick={exportarPDF}
                disabled={!relatorioData || loading || isExportingPdf}
                variant="subtle"
                size="sm"
                className="w-full sm:w-auto"
              >
                <FileText className="mr-2 h-4 w-4" />
                {isExportingPdf ? "Gerando PDF..." : "Exportar PDF"}
              </Button>
              <Button
                onClick={exportarExcel}
                disabled={!relatorioData || loading || isExportingExcel}
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {isExportingExcel ? "Gerando Excel..." : "Exportar Excel"}
              </Button>
            </div>
          </div>
        </section>

        {/* Filtros */}
        <Card variant="muted" className="border border-border/50">
          <CardHeader className="flex flex-col gap-1 pb-4">
            <CardTitle>Filtros do Relatório</CardTitle>
            <CardDescription>Defina o período, conta e gere instantaneamente os indicadores.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <Label htmlFor="dataInicio">Data Início</Label>
                <Input
                  id="dataInicio"
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="border border-border/60 bg-background/80 backdrop-blur focus:border-primary/50"
                />
              </div>

              <div>
                <Label htmlFor="dataFim">Data Fim</Label>
                <Input
                  id="dataFim"
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="border border-border/60 bg-background/80 backdrop-blur focus:border-primary/50"
                />
              </div>

              <div>
                <Label htmlFor="conta">Conta Bancária</Label>
                <Select value={contaBancariaId} onValueChange={setContaBancariaId}>
                  <SelectTrigger className="border border-border/60 bg-background/80 backdrop-blur">
                    <SelectValue placeholder="Todas as Contas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas as Contas</SelectItem>
                    {contasBancarias.map((conta) => (
                      <SelectItem key={conta.id} value={conta.id.toString()}>
                        {conta.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button onClick={gerarRelatorio} disabled={loading} className="w-full">
                  <Filter className="mr-2 h-4 w-4" />
                  {loading ? 'Gerando...' : 'Gerar Relatório'}
                </Button>
              </div>
          </CardContent>
        </Card>

        {loading && !relatorioData ? (
          <Card variant="muted" className="border border-border/40">
            <CardContent className="py-8">
              <div className="text-center text-sm text-muted-foreground">Gerando relatório...</div>
            </CardContent>
          </Card>
        ) : relatorioData ? (
          <div className="relative">
            {loading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-lg)] bg-background/55 backdrop-blur-[1px]">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : null}
            {/* Cards de Resumo */}
            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <Card variant="glass">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Entradas</span>
                    <p className="text-2xl font-semibold text-success">
                      {formatCurrency(relatorioData.totalEntradas)}
                    </p>
                  </div>
                  <span className="rounded-full bg-success/15 p-2 text-success">
                    <TrendingUp className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Cobertura completa do período selecionado.
                </CardContent>
              </Card>

              <Card variant="glass">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Saídas</span>
                    <p className="text-2xl font-semibold text-destructive">
                      {formatCurrency(relatorioData.totalSaidas)}
                    </p>
                  </div>
                  <span className="rounded-full bg-destructive/15 p-2 text-destructive">
                    <TrendingDown className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Movimentações consolidadas por natureza de gasto.
                </CardContent>
              </Card>

              <Card variant="glass">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Saldo</span>
                    <p
                      className={cn(
                        "text-2xl font-semibold",
                        relatorioData.saldo >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {formatCurrency(relatorioData.saldo)}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/15 p-2 text-primary">
                    <DollarSign className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Resultado líquido do período analisado.
                </CardContent>
              </Card>

              <Card variant="glass">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Lançamentos</span>
                    <p className="text-2xl font-semibold text-foreground">
                      {relatorioData.lancamentos.length}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/15 p-2 text-primary">
                    <Calendar className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Total de movimentações identificadas no período.
                </CardContent>
              </Card>
            </section>

            {/* Abas de Relatórios */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4 rounded-[var(--radius-lg)] border border-border/40 bg-foreground/5 p-1 backdrop-blur">
                <TabsTrigger value="resumo" className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary">
                  <BarChart3 className="h-4 w-4" />
                  Resumo
                </TabsTrigger>
                <TabsTrigger value="graficos" className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary">
                  <PieChart className="h-4 w-4" />
                  Gráficos
                </TabsTrigger>
                <TabsTrigger value="detalhado" className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary">
                  <FileText className="h-4 w-4" />
                  Detalhado
                </TabsTrigger>
                <TabsTrigger value="contas" className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary">
                  <DollarSign className="h-4 w-4" />
                  Por Conta
                </TabsTrigger>
              </TabsList>

              <TabsContent value="resumo" className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card variant="muted" className="border border-border/40">
                    <CardHeader className="flex flex-col gap-1 pb-4">
                      <CardTitle>Resumo por Conta Bancária</CardTitle>
                      <CardDescription>Distribuição de entradas, saídas e saldo por conta.</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-foreground/5">
                            <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Conta
                            </TableHead>
                            <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Entradas
                            </TableHead>
                            <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Saídas
                            </TableHead>
                            <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Saldo
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {relatorioData.porConta.map((conta) => (
                            <TableRow key={conta.conta || `conta-${conta.entradas}-${conta.saidas}`} className="border-b border-border/40">
                              <TableCell className="font-medium">{conta.conta}</TableCell>
                              <TableCell className="text-right font-semibold text-success">
                                {formatCurrency(conta.entradas)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-destructive">
                                {formatCurrency(conta.saidas)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right font-semibold",
                                  conta.saldo >= 0 ? "text-success" : "text-destructive",
                                )}
                              >
                                {formatCurrency(conta.saldo)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card variant="muted" className="border border-border/40">
                    <CardHeader className="flex flex-col gap-1 pb-4">
                      <CardTitle>Resumo por Grupo de Contas</CardTitle>
                      <CardDescription>Visualize a concentração de entradas e saídas por grupo.</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-foreground/5">
                            <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Grupo
                            </TableHead>
                            <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Entradas
                            </TableHead>
                            <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Saídas
                            </TableHead>
                            <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                              Total
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {relatorioData.porGrupo.map((grupo) => (
                            <TableRow key={grupo.grupo || `grupo-${grupo.entradas}-${grupo.saidas}`} className="border-b border-border/40">
                              <TableCell className="font-medium">{grupo.grupo}</TableCell>
                              <TableCell className="text-right font-semibold text-success">
                                {formatCurrency(grupo.entradas)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-destructive">
                                {formatCurrency(grupo.saidas)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-foreground">
                                {formatCurrency(grupo.total)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="graficos" className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card variant="muted" className="border border-border/40">
                    <CardHeader className="flex flex-col gap-1 pb-4">
                      <CardTitle>Evolução Diária</CardTitle>
                      <CardDescription>Comportamento de entradas e saídas ao longo do período analisado.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <UiRenderErrorBoundary scope="relatorios-avancados/area-chart" resetKey={areaChartKey}>
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart key={areaChartKey} data={dadosGrafico}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="data" />
                            <YAxis />
                            <Tooltip isAnimationActive={false} formatter={(value) => formatCurrency(Number(value))} />
                            <Legend />
                            <Area
                              isAnimationActive={false}
                              animationDuration={0}
                              type="monotone"
                              dataKey="entradas"
                              stackId="1"
                              stroke="#22c55e"
                              fill="#22c55e"
                              name="Entradas"
                            />
                            <Area
                              isAnimationActive={false}
                              animationDuration={0}
                              type="monotone"
                              dataKey="saidas"
                              stackId="1"
                              stroke="#ef4444"
                              fill="#ef4444"
                              name="Saídas"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </UiRenderErrorBoundary>
                    </CardContent>
                  </Card>

                  <Card variant="muted" className="border border-border/40">
                    <CardHeader className="flex flex-col gap-1 pb-4">
                      <CardTitle>Distribuição Entradas vs Saídas</CardTitle>
                      <CardDescription>Percentual de participação de cada categoria financeira.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <UiRenderErrorBoundary scope="relatorios-avancados/pie-chart" resetKey={pieChartKey}>
                        <ResponsiveContainer width="100%" height={300}>
                          <RechartsPieChart key={pieChartKey}>
                            <Pie
                              isAnimationActive={false}
                              animationDuration={0}
                              data={dadosPizza}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {dadosPizza.map((entry, index) => (
                                <Cell key={`cell-${entry.name}-${entry.value}-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip isAnimationActive={false} formatter={(value) => formatCurrency(Number(value))} />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      </UiRenderErrorBoundary>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="detalhado" className="space-y-6">
                <Card variant="muted" className="border border-border/40">
                  <CardHeader className="flex flex-col gap-1 pb-4">
                    <CardTitle>Lançamentos Detalhados ({relatorioData.lancamentos.length})</CardTitle>
                    <CardDescription>Todos os lançamentos do período com contexto de conta e grupo.</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-foreground/5">
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Data
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Descrição
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Tipo
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Valor
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Conta
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Grupo
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relatorioData.lancamentos.map((lancamento) => (
                          <TableRow key={lancamento.id} className="border-b border-border/40">
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(lancamento.data)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {lancamento.historico || 'Sem descrição'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs font-medium",
                                  lancamento.tipo === "entrada"
                                    ? "border-success/40 bg-success/10 text-success"
                                    : "border-destructive/40 bg-destructive/10 text-destructive",
                                )}
                              >
                                {lancamento.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-semibold">
                              {formatCurrency(lancamento.valor)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {lancamento.contas_bancarias?.descricao || 'Sem conta'}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {lancamento.grupos_contas?.nome || 'Sem grupo'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={3} className="text-right text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                            Total de Entradas
                          </TableCell>
                          <TableCell className="text-right font-semibold text-success">
                            {formatCurrency(relatorioData.totalEntradas)}
                          </TableCell>
                          <TableCell colSpan={2}></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={3} className="text-right text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                            Total de Saídas
                          </TableCell>
                          <TableCell className="text-right font-semibold text-destructive">
                            {formatCurrency(relatorioData.totalSaidas)}
                          </TableCell>
                          <TableCell colSpan={2}></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={3} className="text-right text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                            Saldo
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-semibold",
                              relatorioData.saldo >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {formatCurrency(relatorioData.saldo)}
                          </TableCell>
                          <TableCell colSpan={2}></TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="contas" className="space-y-6">
                <Card variant="muted" className="border border-border/40">
                  <CardHeader className="flex flex-col gap-1 pb-4">
                    <CardTitle>Análise por Conta Bancária</CardTitle>
                    <CardDescription>Percentual de participação de cada conta no volume total movimentado.</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-foreground/5">
                          <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Conta Bancária
                          </TableHead>
                          <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Entradas
                          </TableHead>
                          <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Saídas
                          </TableHead>
                          <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            Saldo
                          </TableHead>
                          <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                            % do Total
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relatorioData.porConta.map((conta) => {
                          const percentual = relatorioData.totalEntradas + relatorioData.totalSaidas > 0 
                            ? ((conta.entradas + conta.saidas) / (relatorioData.totalEntradas + relatorioData.totalSaidas)) * 100
                            : 0;
                          
                          return (
                            <TableRow key={conta.conta || `conta-${conta.entradas}-${conta.saidas}`} className="border-b border-border/40">
                              <TableCell className="font-medium">{conta.conta}</TableCell>
                              <TableCell className="text-right font-semibold text-success">
                                {formatCurrency(conta.entradas)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-destructive">
                                {formatCurrency(conta.saidas)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right font-semibold",
                                  conta.saldo >= 0 ? "text-success" : "text-destructive",
                                )}
                              >
                                {formatCurrency(conta.saldo)}
                              </TableCell>
                              <TableCell className="text-right text-sm text-muted-foreground">
                                {percentual.toFixed(1)}%
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </div>
  );
}
