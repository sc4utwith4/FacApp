import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  Download,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  RefreshCw,
  Eye,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { FechamentoDiario } from "@/types/cobranca-bancaria";
import { formatCurrency } from "@/lib/utils";
import { gerarFechamentoDiario, atualizarFechamentoDiario } from "@/utils/fechamentoDiario";
import { exportarFechamentoPDF, exportarFechamentoExcel } from "@/utils/exportFechamento";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { normalizeDateForDB } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { FileText as FileTextIcon } from "lucide-react";
import type { RelatorioBancoPDF } from "@/types/relatorio-banco-pdf";

export default function Fechamentos() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    dataInicio: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split("T")[0],
    dataFim: new Date().toISOString().split("T")[0],
    status: "todos" as "todos" | "confirmados" | "pendentes",
  });
  const [isGerarDialogOpen, setIsGerarDialogOpen] = useState(false);
  const [dataGerar, setDataGerar] = useState(new Date().toISOString().split("T")[0]);
  const [viewingFechamento, setViewingFechamento] = useState<FechamentoDiario | null>(null);
  const [isValidacaoDialogOpen, setIsValidacaoDialogOpen] = useState(false);
  const [fechamentoParaValidar, setFechamentoParaValidar] = useState<FechamentoDiario | null>(null);
  const [isUploadPDFDialogOpen, setIsUploadPDFDialogOpen] = useState(false);
  const [fechamentoParaUpload, setFechamentoParaUpload] = useState<FechamentoDiario | null>(null);
  const [uploadPDFFile, setUploadPDFFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useIsSuperAdmin();

  // Query para buscar relatórios PDF por fechamento
  const { data: relatoriosPorFechamento } = useQuery({
    queryKey: ["relatorios-banco-por-fechamento"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {};

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) return {};

      const { data } = await supabase
        .from("relatorios_banco_pdf")
        .select("id, fechamento_id, status, validado_contra_fechamento, divergencia_valor")
        .eq("empresa_id", profile.empresa_id)
        .not("fechamento_id", "is", null);

      if (!data) return {};

      // Agrupar por fechamento_id
      const map: Record<string, RelatorioBancoPDF> = {};
      data.forEach((rel) => {
        if (rel.fechamento_id) {
          map[rel.fechamento_id] = rel as RelatorioBancoPDF;
        }
      });
      return map;
    },
  });

  // Query para listar fechamentos
  const { data: fechamentos, isLoading } = useQuery<FechamentoDiario[]>({
    queryKey: ["cobranca-fechamentos", filters],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Garantir que as datas estão no formato ISO (YYYY-MM-DD)
      const dataInicioISO = filters.dataInicio ? new Date(filters.dataInicio).toISOString().split("T")[0] : filters.dataInicio;
      const dataFimISO = filters.dataFim ? new Date(filters.dataFim).toISOString().split("T")[0] : filters.dataFim;

      let query = supabase
        .from("fechamentos_diarios")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .gte("data_fechamento", dataInicioISO)
        .lte("data_fechamento", dataFimISO)
        .order("data_fechamento", { ascending: false });

      if (filters.status === "confirmados") {
        query = query.not("confirmado_por", "is", null);
      } else if (filters.status === "pendentes") {
        query = query.is("confirmado_por", null);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
  });

  // Mutation para gerar fechamento
  const gerarMutation = useMutation({
    mutationFn: async (data: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      return await gerarFechamentoDiario(data, profile.empresa_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-fechamentos"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-dashboard"] });
      toast.success("Fechamento gerado com sucesso");
      setIsGerarDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Erro ao gerar fechamento: ${error.message}`);
    },
  });

  // Mutation para confirmar fechamento
  const confirmarMutation = useMutation({
    mutationFn: async (fechamentoId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { error } = await supabase
        .from("fechamentos_diarios")
        .update({
          confirmado_por: user.id,
          confirmado_em: new Date().toISOString(),
        })
        .eq("id", fechamentoId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-fechamentos"] });
      toast.success("Fechamento confirmado com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao confirmar fechamento: ${error.message}`);
    },
  });

  // Mutation para recalcular fechamento
  const recalcularMutation = useMutation({
    mutationFn: async (fechamentoId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      return await atualizarFechamentoDiario(fechamentoId, profile.empresa_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-fechamentos"] });
      toast.success("Fechamento recalculado com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao recalcular fechamento: ${error.message}`);
    },
  });

  const handleExportPDF = async (fechamento: FechamentoDiario) => {
    try {
      const url = await exportarFechamentoPDF(fechamento);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fechamento-${fechamento.data_fechamento}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("PDF gerado com sucesso");
    } catch (error) {
      toast.error(`Erro ao exportar PDF: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    }
  };

  const handleExportExcel = async (fechamento: FechamentoDiario) => {
    try {
      const url = await exportarFechamentoExcel(fechamento);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fechamento-${fechamento.data_fechamento}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Excel gerado com sucesso");
    } catch (error) {
      toast.error(`Erro ao exportar Excel: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fechamentos Diários</h1>
          <p className="text-muted-foreground">
            Gerencie fechamentos diários de cobrança bancária
          </p>
        </div>
        <Button onClick={() => setIsGerarDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Gerar Fechamento
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Data Início</Label>
              <Input
                type="date"
                value={filters.dataInicio}
                onChange={(e) => setFilters({ ...filters, dataInicio: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Fim</Label>
              <Input
                type="date"
                value={filters.dataFim}
                onChange={(e) => setFilters({ ...filters, dataFim: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters({ ...filters, status: value as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="confirmados">Confirmados</SelectItem>
                  <SelectItem value="pendentes">Pendentes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Fechamentos */}
      <Card>
        <CardHeader>
          <CardTitle>Fechamentos ({fechamentos?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : fechamentos && fechamentos.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Saldo Anterior</TableHead>
                    <TableHead>Entradas</TableHead>
                    <TableHead>Baixas</TableHead>
                    <TableHead>Saldo Atual</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Validação</TableHead>
                    <TableHead>PDF Banco</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fechamentos.map((fechamento) => (
                    <TableRow key={fechamento.id}>
                      <TableCell className="font-medium">
                        {new Date(fechamento.data_fechamento).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {fechamento.saldo_anterior_qtd} títulos
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(fechamento.saldo_anterior_valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-green-600">
                          {fechamento.entradas_qtd} títulos
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(fechamento.entradas_valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-red-600">
                          {fechamento.baixas_qtd} títulos
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(fechamento.baixas_valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-semibold">
                          {fechamento.saldo_atual_qtd} títulos
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(fechamento.saldo_atual_valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {fechamento.confirmado_por ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Confirmado
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {fechamento.validado_contra_banco ? (
                          <Badge variant="secondary">
                            {fechamento.divergencia_valor === 0 ? (
                              "OK"
                            ) : (
                              <span className="text-orange-600">
                                Divergência: {formatCurrency(Math.abs(fechamento.divergencia_valor))}
                              </span>
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Não validado</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {relatoriosPorFechamento?.[fechamento.id] ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="secondary"
                              className={
                                relatoriosPorFechamento[fechamento.id].validado_contra_fechamento
                                  ? relatoriosPorFechamento[fechamento.id].divergencia_valor === 0
                                    ? "bg-green-100 text-green-800"
                                    : "bg-orange-100 text-orange-800"
                                  : "bg-gray-100 text-gray-800"
                              }
                            >
                              <FileTextIcon className="mr-1 h-3 w-3" />
                              {relatoriosPorFechamento[fechamento.id].validado_contra_fechamento
                                ? relatoriosPorFechamento[fechamento.id].divergencia_valor === 0
                                  ? "OK"
                                  : "Divergência"
                                : "PDF"}
                            </Badge>
                            <Button
                              variant="link"
                              className="p-0 h-auto text-xs"
                              onClick={() => navigate("/financeiro/cobranca-bancaria/relatorios-banco")}
                            >
                              Ver
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setFechamentoParaUpload(fechamento);
                              setIsUploadPDFDialogOpen(true);
                            }}
                          >
                            <Upload className="mr-1 h-3 w-3" />
                            Upload
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setViewingFechamento(fechamento)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleExportPDF(fechamento)}
                            title="Exportar PDF"
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleExportExcel(fechamento)}
                            title="Exportar Excel"
                          >
                            <FileSpreadsheet className="h-4 w-4" />
                          </Button>
                          {isSuperAdmin && !fechamento.confirmado_por && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => confirmarMutation.mutate(fechamento.id)}
                              disabled={confirmarMutation.isPending}
                            >
                              Confirmar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum fechamento encontrado para o período selecionado
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de Gerar Fechamento */}
      <Dialog open={isGerarDialogOpen} onOpenChange={setIsGerarDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Fechamento Diário</DialogTitle>
            <DialogDescription>
              Selecione a data para gerar o fechamento
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Data do Fechamento</Label>
              <Input
                type="date"
                value={dataGerar}
                onChange={(e) => setDataGerar(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGerarDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => gerarMutation.mutate(dataGerar)}
              disabled={gerarMutation.isPending}
            >
              {gerarMutation.isPending ? "Gerando..." : "Gerar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Visualização */}
      {viewingFechamento && (
        <Dialog open={!!viewingFechamento} onOpenChange={() => setViewingFechamento(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Fechamento - {new Date(viewingFechamento.data_fechamento).toLocaleDateString("pt-BR")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* Resumo */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Saldo Anterior</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(viewingFechamento.saldo_anterior_valor)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewingFechamento.saldo_anterior_qtd} títulos
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-green-600">Entradas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(viewingFechamento.entradas_valor)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewingFechamento.entradas_qtd} títulos
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-red-600">Baixas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {formatCurrency(viewingFechamento.baixas_valor)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewingFechamento.baixas_qtd} títulos
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Saldo Atual</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(viewingFechamento.saldo_atual_valor)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewingFechamento.saldo_atual_qtd} títulos
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Indicadores */}
              {viewingFechamento.indicadores &&
                Object.keys(viewingFechamento.indicadores).length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Indicadores</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4">
                        {viewingFechamento.indicadores.liquidez !== undefined && (
                          <div>
                            <Label>Liquidez</Label>
                            <p className="text-sm font-semibold">
                              {viewingFechamento.indicadores.liquidez.toFixed(2)}%
                            </p>
                          </div>
                        )}
                        {viewingFechamento.indicadores.titulos_cartorio !== undefined && (
                          <div>
                            <Label>Títulos em Cartório</Label>
                            <p className="text-sm font-semibold">
                              {viewingFechamento.indicadores.titulos_cartorio} títulos -{" "}
                              {formatCurrency(viewingFechamento.indicadores.valor_cartorio || 0)}
                            </p>
                          </div>
                        )}
                        {viewingFechamento.indicadores.titulos_protesto !== undefined && (
                          <div>
                            <Label>Títulos com Protesto</Label>
                            <p className="text-sm font-semibold">
                              {viewingFechamento.indicadores.titulos_protesto} títulos -{" "}
                              {formatCurrency(viewingFechamento.indicadores.valor_protesto || 0)}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

              {/* Status */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>Status</Label>
                  <div className="mt-1">
                    {viewingFechamento.confirmado_por ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Confirmado
                      </Badge>
                    ) : (
                      <Badge variant="outline">Pendente</Badge>
                    )}
                  </div>
                  {viewingFechamento.confirmado_em && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Confirmado em: {new Date(viewingFechamento.confirmado_em).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>
                <div>
                  <Label>Validação</Label>
                  <div className="mt-1">
                    {viewingFechamento.validado_contra_banco ? (
                      <Badge variant="secondary">
                        {viewingFechamento.divergencia_valor === 0 ? (
                          "OK"
                        ) : (
                          <span className="text-orange-600">
                            Divergência: {formatCurrency(Math.abs(viewingFechamento.divergencia_valor))}
                          </span>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Não validado</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewingFechamento(null)}>
                Fechar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setFechamentoParaValidar(viewingFechamento);
                  setIsValidacaoDialogOpen(true);
                }}
              >
                <Upload className="mr-2 h-4 w-4" />
                Validar Contra Banco
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setFechamentoParaUpload(viewingFechamento);
                  setIsUploadPDFDialogOpen(true);
                }}
              >
                <FileTextIcon className="mr-2 h-4 w-4" />
                Upload PDF Banco
              </Button>
              <Button
                variant="outline"
                onClick={() => recalcularMutation.mutate(viewingFechamento.id)}
                disabled={recalcularMutation.isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Recalcular
              </Button>
              {isSuperAdmin && !viewingFechamento.confirmado_por && (
                <Button
                  onClick={() => {
                    confirmarMutation.mutate(viewingFechamento.id);
                    setViewingFechamento(null);
                  }}
                  disabled={confirmarMutation.isPending}
                >
                  Confirmar
                </Button>
              )}
              <Button onClick={() => handleExportPDF(viewingFechamento)}>
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button onClick={() => handleExportExcel(viewingFechamento)}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Excel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog de Upload PDF */}
      <Dialog open={isUploadPDFDialogOpen} onOpenChange={setIsUploadPDFDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload PDF do Banco</DialogTitle>
            <DialogDescription>
              Faça upload do PDF "Posição de Carteira" do banco para o fechamento de{" "}
              {fechamentoParaUpload &&
                new Date(fechamentoParaUpload.data_fechamento).toLocaleDateString("pt-BR")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Arquivo PDF</Label>
              <Input
                type="file"
                accept=".pdf"
                onChange={(e) => setUploadPDFFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadPDFDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!uploadPDFFile || !fechamentoParaUpload) return;

                try {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) throw new Error("Usuário não autenticado");

                  const { data: profile } = await supabase
                    .from("profiles")
                    .select("empresa_id")
                    .eq("id", user.id)
                    .single();

                  if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

                  const { uploadRelatorioBanco } = await import("@/utils/uploadRelatorioBanco");
                  await uploadRelatorioBanco(
                    uploadPDFFile,
                    profile.empresa_id,
                    fechamentoParaUpload.id,
                    null
                  );

                  queryClient.invalidateQueries({ queryKey: ["relatorios-banco-por-fechamento"] });
                  queryClient.invalidateQueries({ queryKey: ["cobranca-fechamentos"] });
                  toast.success("PDF importado com sucesso");
                  setIsUploadPDFDialogOpen(false);
                  setUploadPDFFile(null);
                  setFechamentoParaUpload(null);
                } catch (error) {
                  toast.error(
                    `Erro ao importar: ${error instanceof Error ? error.message : "Erro desconhecido"}`
                  );
                }
              }}
              disabled={!uploadPDFFile}
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Validação */}
      <Dialog open={isValidacaoDialogOpen} onOpenChange={setIsValidacaoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validar Contra Banco</DialogTitle>
            <DialogDescription>
              Faça upload do PDF do banco (Posição de Carteira) para comparar valores
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Arquivo PDF do Banco</Label>
              <Input
                type="file"
                accept=".pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !fechamentoParaValidar) return;

                  // Por enquanto, apenas marcamos como validado
                  // TODO: Implementar parsing do PDF e comparação real
                  toast.info("Validação contra PDF será implementada em breve");
                  setIsValidacaoDialogOpen(false);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Upload do PDF "Posição de Carteira" do banco para comparação
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsValidacaoDialogOpen(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

