import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  FileText,
  TrendingUp,
  TrendingDown,
  Wallet,
  BarChart3,
  PieChart as PieChartIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID } from "@/lib/uuid";
import { LineChart, PieChart } from "@/components/charts";

interface FechamentoData {
  periodo: string;
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  lancamentos: any[];
  resumoPorCategoria: any[];
  resumoDiario: any[];
}

export default function FechamentoMensal() {
  const [fechamentoData, setFechamentoData] = useState<FechamentoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [dataInicio, setDataInicio] = useState(() => {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return primeiroDiaMes.toISOString().split("T")[0];
  });
  const [dataFim, setDataFim] = useState(() => {
    const hoje = new Date();
    return hoje.toISOString().split("T")[0];
  });
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  useEffect(() => {
    fetchEmpresaId();
  }, []);

  useEffect(() => {
    if (empresaId && dataInicio && dataFim) {
      fetchFechamentoData();
    }
  }, [dataInicio, dataFim, empresaId]);

  const fetchEmpresaId = async () => {
    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", session.user.id)
        .maybeSingle();

      if (error) {
        if (process.env.NODE_ENV === "development") {
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
      if (process.env.NODE_ENV === "development") {
        console.error("Erro ao buscar empresa_id:", error);
      }
    }
  };

  const fetchFechamentoData = async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    if (!dataInicio || !dataFim) {
      toast.error("Informe o período para gerar o fechamento");
      return;
    }

    if (new Date(dataInicio) > new Date(dataFim)) {
      toast.error("Data início não pode ser maior que data fim");
      return;
    }

    try {
      setLoading(true);

      const { data: lancamentos, error } = await supabase
        .from("lancamentos_caixa")
        .select(
          `
          *,
          grupos_contas(nome, natureza),
          contas_bancarias(descricao)
        `
        )
        .eq("empresa_id", empresaId)
        .gte("data", dataInicio)
        .lte("data", dataFim)
        .order("data", { ascending: true });

      if (error) throw error;

      const totalEntradas =
        lancamentos?.filter((l) => l.tipo === "entrada").reduce((sum, l) => sum + Number(l.valor), 0) || 0;
      const totalSaidas =
        lancamentos?.filter((l) => l.tipo === "saida").reduce((sum, l) => sum + Number(l.valor), 0) || 0;
      const saldo = totalEntradas - totalSaidas;

      const resumoPorCategoria = generateResumoCategoria(lancamentos || []);
      const resumoDiario = generateResumoDiario(lancamentos || [], dataInicio, dataFim);

      const inicioFormatado = new Date(`${dataInicio}T00:00:00`).toLocaleDateString("pt-BR");
      const fimFormatado = new Date(`${dataFim}T00:00:00`).toLocaleDateString("pt-BR");
      const periodoStr = `${inicioFormatado} a ${fimFormatado}`;

      setFechamentoData({
        periodo: periodoStr,
        totalEntradas,
        totalSaidas,
        saldo,
        lancamentos: lancamentos || [],
        resumoPorCategoria,
        resumoDiario
      });
    } catch (error: any) {
      toast.error("Erro ao carregar dados do fechamento");
      if (process.env.NODE_ENV === "development") {
        console.error("Erro ao carregar dados do fechamento:", error);
      }
    } finally {
      setLoading(false);
    }
  };

  const generateResumoCategoria = (lancamentos: any[]) => {
    const categoriaMap = new Map();

    lancamentos.forEach((lanc) => {
      const categoria = lanc.grupos_contas?.nome || "Sem categoria";
      const valor = Number(lanc.valor);
      const tipo = lanc.tipo;

      if (!categoriaMap.has(categoria)) {
        categoriaMap.set(categoria, { entradas: 0, saidas: 0, total: 0 });
      }

      const current = categoriaMap.get(categoria);
      if (tipo === "entrada") {
        current.entradas += valor;
      } else {
        current.saidas += valor;
      }
      current.total = current.entradas - current.saidas;
    });

    return Array.from(categoriaMap.entries()).map(([nome, dados]) => ({
      nome,
      entradas: dados.entradas,
      saidas: dados.saidas,
      total: dados.total
    }));
  };

  const generateResumoDiario = (lancamentos: any[], dataInicio: string, dataFim: string) => {
    const inicio = new Date(`${dataInicio}T00:00:00`);
    const fim = new Date(`${dataFim}T00:00:00`);
    const resumo = [];

    const dataAtual = new Date(inicio);
    while (dataAtual <= fim) {
      const dataStr = dataAtual.toISOString().split("T")[0];
      const lancamentosDia = lancamentos.filter((l) => l.data === dataStr);

      const entradas = lancamentosDia.filter((l) => l.tipo === "entrada").reduce((sum, l) => sum + Number(l.valor), 0);
      const saidas = lancamentosDia.filter((l) => l.tipo === "saida").reduce((sum, l) => sum + Number(l.valor), 0);

      resumo.push({
        dia: dataAtual.getDate().toString().padStart(2, "0"),
        entradas,
        saidas,
        saldo: entradas - saidas
      });

      dataAtual.setDate(dataAtual.getDate() + 1);
    }

    return resumo;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  };

  const formatDate = (value: string | Date | null | undefined) => {
    if (!value) {
      return "-";
    }

    const parsed =
      value instanceof Date
        ? value
        : new Date(typeof value === "string" ? value : "");

    if (Number.isNaN(parsed.getTime())) {
      if (typeof value === "string" && value.includes("T")) {
        const [datePart] = value.split("T");
        const sanitized = new Date(`${datePart}T00:00:00`);
        if (!Number.isNaN(sanitized.getTime())) {
          return sanitized.toLocaleDateString("pt-BR");
        }
      }
      return "-";
    }

    return parsed.toLocaleDateString("pt-BR");
  };

  const handleExportPDF = async () => {
    if (!fechamentoData) {
      toast.error("Nenhum dado disponível para exportar");
      return;
    }

    // Validações adicionais
    if (!fechamentoData.lancamentos || fechamentoData.lancamentos.length === 0) {
      toast.warning("Não há lançamentos para exportar no período selecionado");
      return;
    }

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
      let yPosition = 20;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("Fechamento Mensal", 20, yPosition);
      yPosition += 10;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.text(`Período: ${fechamentoData.periodo}`, 20, yPosition);
      yPosition += 5;
      doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 20, yPosition);
      yPosition += 15;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Resumo Financeiro", 20, yPosition);
      yPosition += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Total de Entradas: ${formatCurrency(fechamentoData.totalEntradas)}`, 20, yPosition);
      yPosition += 6;
      doc.text(`Total de Saídas: ${formatCurrency(fechamentoData.totalSaidas)}`, 20, yPosition);
      yPosition += 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Saldo do Período: ${formatCurrency(fechamentoData.saldo)}`, 20, yPosition);
      yPosition += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Total de Lançamentos: ${fechamentoData.lancamentos.length}`, 20, yPosition);
      yPosition += 15;

      if (fechamentoData.lancamentos.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("Lançamentos Detalhados", 20, yPosition);
        yPosition += 5;

        const tableData = fechamentoData.lancamentos.map((lanc) => [
          formatDate(lanc.data),
          (lanc.historico || "Sem descrição").substring(0, 40),
          lanc.grupos_contas?.nome || "Sem categoria",
          lanc.contas_bancarias?.descricao || "Sem conta",
          lanc.tipo === "entrada" ? "Entrada" : "Saída",
          formatCurrency(Number(lanc.valor))
        ]);

        autoTable(doc, {
          head: [["Data", "Histórico", "Categoria", "Conta", "Tipo", "Valor"]],
          body: tableData,
          startY: yPosition,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202] },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 50 },
            2: { cellWidth: 35 },
            3: { cellWidth: 30 },
            4: { cellWidth: 20 },
            5: { cellWidth: 30, halign: "right" }
          }
        });

        const lastTable = (doc as any).lastAutoTable;
        if (lastTable?.finalY) {
          yPosition = lastTable.finalY + 10;
        }
      }

      if (fechamentoData.resumoPorCategoria.length > 0) {
        if (yPosition > 250) {
          doc.addPage();
          yPosition = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("Resumo por Categoria", 20, yPosition);
        yPosition += 5;

        const categoriaData = fechamentoData.resumoPorCategoria.map((cat) => [
          cat.nome,
          formatCurrency(cat.entradas),
          formatCurrency(cat.saidas),
          formatCurrency(cat.total)
        ]);

        autoTable(doc, {
          head: [["Categoria", "Entradas", "Saídas", "Saldo"]],
          body: categoriaData,
          startY: yPosition,
          styles: { fontSize: 9 },
          headStyles: { fillColor: [66, 139, 202] },
          columnStyles: {
            0: { cellWidth: 80 },
            1: { cellWidth: 35, halign: "right" },
            2: { cellWidth: 35, halign: "right" },
            3: { cellWidth: 35, halign: "right" }
          }
        });
      }

      const fileName = `fechamento-mensal-${dataInicio}-${dataFim}.pdf`;
      doc.save(fileName);
      toast.success("PDF gerado com sucesso!");
    } catch (error: any) {
      console.error("Erro ao gerar PDF:", error);
      const errorMessage = error?.message || "Erro desconhecido ao gerar PDF";
      toast.error(`Erro ao gerar PDF: ${errorMessage}`);
      if (process.env.NODE_ENV === "development") {
        console.error("Detalhes do erro:", error);
      }
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fechamento Mensal</h1>
          <p className="text-muted-foreground">Relatório consolidado de movimentações financeiras</p>
        </div>

        <div className="flex items-end gap-4">
          <div>
            <Label htmlFor="dataInicio">Data Início</Label>
            <Input
              id="dataInicio"
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="w-[150px]"
            />
          </div>

          <div>
            <Label htmlFor="dataFim">Data Fim</Label>
            <Input
              id="dataFim"
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="w-[150px]"
            />
          </div>

          <Button onClick={handleExportPDF} disabled={!fechamentoData || isExportingPdf}>
            <Download className="mr-2 h-4 w-4" />
            {isExportingPdf ? "Gerando PDF..." : "Exportar PDF"}
          </Button>
        </div>
      </div>

      {loading && !fechamentoData ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : fechamentoData ? (
        <div className="relative">
          {loading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-[1px]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Entradas</CardTitle>
                <TrendingUp className="h-4 w-4 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-lg sm:text-xl font-bold text-success whitespace-nowrap">{formatCurrency(fechamentoData.totalEntradas)}</div>
                <p className="text-xs text-muted-foreground">{fechamentoData.periodo}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Saídas</CardTitle>
                <TrendingDown className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-lg sm:text-xl font-bold text-destructive whitespace-nowrap">{formatCurrency(fechamentoData.totalSaidas)}</div>
                <p className="text-xs text-muted-foreground">{fechamentoData.periodo}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo do Período</CardTitle>
                <Wallet className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-lg sm:text-xl font-bold whitespace-nowrap ${
                    fechamentoData.saldo >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {formatCurrency(fechamentoData.saldo)}
                </div>
                <p className="text-xs text-muted-foreground">{fechamentoData.periodo}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Lançamentos</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fechamentoData.lancamentos.length}</div>
                <p className="text-xs text-muted-foreground">{fechamentoData.periodo}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Evolução Diária do Saldo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart data={fechamentoData.resumoDiario} dataKey="saldo" name="Saldo Diário" color="#10b981" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5" />
                  Distribuição por Categoria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PieChart
                  data={fechamentoData.resumoPorCategoria.map((cat) => ({
                    name: cat.nome,
                    value: Math.abs(cat.total)
                  }))}
                  dataKey="value"
                  nameKey="name"
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Lançamentos do Período</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Histórico</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fechamentoData.lancamentos.map((lanc) => (
                    <TableRow key={lanc.id}>
                      <TableCell>{formatDate(lanc.data)}</TableCell>
                      <TableCell className="max-w-xs truncate">{lanc.historico}</TableCell>
                      <TableCell>{lanc.grupos_contas?.nome || "-"}</TableCell>
                      <TableCell>{lanc.contas_bancarias?.descricao || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={lanc.tipo === "entrada" ? "default" : "destructive"}>
                          {lanc.tipo === "entrada" ? "Entrada" : "Saída"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          lanc.tipo === "entrada" ? "text-success" : "text-destructive"
                        }`}
                      >
                        {formatCurrency(Number(lanc.valor))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resumo por Categoria</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Entradas</TableHead>
                    <TableHead className="text-right">Saídas</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fechamentoData.resumoPorCategoria.map((cat, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{cat.nome}</TableCell>
                      <TableCell className="text-right text-success">{formatCurrency(cat.entradas)}</TableCell>
                      <TableCell className="text-right text-destructive">{formatCurrency(cat.saidas)}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${cat.total >= 0 ? "text-success" : "text-destructive"}`}
                      >
                        {formatCurrency(cat.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhum dado encontrado</h3>
              <p className="text-muted-foreground">Selecione um período para visualizar o fechamento mensal</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
