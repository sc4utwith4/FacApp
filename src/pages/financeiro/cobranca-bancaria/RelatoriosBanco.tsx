import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Plus,
  Eye,
  Edit,
  Trash2,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  History,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { RelatorioBancoPDF, PDFBradescoParsed } from "@/types/relatorio-banco-pdf";
import { formatCurrency } from "@/lib/utils";
import { sanitizarNomeArquivo } from "@/utils/sanitizarNomeArquivo";
import { validarRelatorioBanco } from "@/utils/validarRelatorioBanco";
import { parsePDFBradesco } from "@/utils/parsePDFBradesco";
import { EditarRelatorioBanco } from "@/components/cobranca-bancaria/EditarRelatorioBanco";
import { HistoricoRelatorioBanco } from "@/components/cobranca-bancaria/HistoricoRelatorioBanco";

const STATUS_FILTER_VALUES = ["todos", "validado", "extraido", "divergencia", "erro"] as const;
type StatusFilterValue = (typeof STATUS_FILTER_VALUES)[number];

function isStatusFilterValue(value: string): value is StatusFilterValue {
  return STATUS_FILTER_VALUES.includes(value as StatusFilterValue);
}

export default function RelatoriosBanco() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const fechamentoIdFromUrl = searchParams.get("fechamentoId") || "";
  
  const [filters, setFilters] = useState({
    dataInicio: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split("T")[0],
    dataFim: new Date().toISOString().split("T")[0],
    status: "todos" as StatusFilterValue,
    fechamentoId: fechamentoIdFromUrl,
  });
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isHistoricoDialogOpen, setIsHistoricoDialogOpen] = useState(false);
  const [selectedRelatorio, setSelectedRelatorio] = useState<RelatorioBancoPDF | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFechamentoId, setUploadFechamentoId] = useState<string>(fechamentoIdFromUrl);
  const [uploadBancoId, setUploadBancoId] = useState<string>("");
  const [parsedData, setParsedData] = useState<PDFBradescoParsed | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  // Atualizar fechamentoId quando mudar na URL
  useEffect(() => {
    const fechamentoId = searchParams.get("fechamentoId") || "";
    if (fechamentoId) {
      setFilters((prev) => ({ ...prev, fechamentoId }));
      setUploadFechamentoId(fechamentoId);
    }
  }, [searchParams]);

  // Query para listar relatórios
  const { data: relatorios, isLoading } = useQuery<RelatorioBancoPDF[]>({
    queryKey: ["relatorios-banco", filters],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Validar datas antes de usar na query
      const dataInicioValida = filters.dataInicio && !isNaN(new Date(filters.dataInicio).getTime());
      const dataFimValida = filters.dataFim && !isNaN(new Date(filters.dataFim).getTime());

      let query = supabase
        .from("relatorios_banco_pdf")
        .select("*")
        .eq("empresa_id", profile.empresa_id);

      if (dataInicioValida) {
        // Converter para início do dia em formato ISO para comparação com TIMESTAMP
        const dataInicioISO = new Date(filters.dataInicio + "T00:00:00").toISOString();
        query = query.gte("data_upload", dataInicioISO);
      }
      if (dataFimValida) {
        // Converter para fim do dia em formato ISO para comparação com TIMESTAMP
        const dataFimISO = new Date(filters.dataFim + "T23:59:59.999").toISOString();
        query = query.lte("data_upload", dataFimISO);
      }

      query = query.order("data_upload", { ascending: false });

      if (filters.status !== "todos") {
        query = query.eq("status", filters.status);
      }

      if (filters.fechamentoId) {
        query = query.eq("fechamento_id", filters.fechamentoId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
  });

  // Query para fechamentos (para seleção no upload)
  const { data: fechamentos } = useQuery({
    queryKey: ["cobranca-fechamentos"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { data, error } = await supabase
        .from("fechamentos_diarios")
        .select("id, data_fechamento")
        .eq("empresa_id", profile.empresa_id)
        .order("data_fechamento", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
  });

  // Query para bancos
  const { data: bancos } = useQuery({
    queryKey: ["bancos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bancos")
        .select("id, nome, codigo")
        .order("nome");

      if (error) throw error;
      return data || [];
    },
  });

  // Mutation para upload
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error("Selecione um arquivo");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { uploadRelatorioBanco } = await import("@/utils/uploadRelatorioBanco");
      return await uploadRelatorioBanco(
        uploadFile,
        profile.empresa_id,
        uploadFechamentoId || null,
        uploadBancoId ? parseInt(uploadBancoId) : null
      );
    },
    onSuccess: async () => {
      // Invalidar todas as queries relacionadas
      await queryClient.invalidateQueries({ 
        queryKey: ["relatorios-banco"],
        exact: false // Invalida todas as queries que começam com essa key
      });
      await queryClient.invalidateQueries({ queryKey: ["cobranca-fechamentos"] });
      
      // Refetch explícito para garantir atualização imediata
      await queryClient.refetchQueries({ 
        queryKey: ["relatorios-banco"],
        exact: false 
      });
      
      toast.success("Relatório importado com sucesso");
      setIsUploadDialogOpen(false);
      setUploadFile(null);
      setParsedData(null);
      // Manter fechamentoId se veio da URL
      if (!fechamentoIdFromUrl) {
        setUploadFechamentoId("");
      }
      setUploadBancoId("");
    },
    onError: (error) => {
      toast.error(`Erro ao importar: ${error.message}`);
    },
  });

  // Mutation para validar
  const validarMutation = useMutation({
    mutationFn: async (relatorio: RelatorioBancoPDF) => {
      if (!relatorio.fechamento_id) {
        throw new Error("Relatório não está associado a um fechamento");
      }
      const resultado = await validarRelatorioBanco(relatorio.id, relatorio.fechamento_id);
      
      // Atualizar status do relatório com resultado da validação
      const { data: { user } } = await supabase.auth.getUser();
      await supabase
        .from("relatorios_banco_pdf")
        .update({
          validado_contra_fechamento: resultado.validado,
          divergencia_valor: resultado.divergencia_valor,
          divergencia_qtd: resultado.divergencia_qtd,
          divergencias_detalhadas: resultado.divergencias_detalhadas,
          validado_em: new Date().toISOString(),
          validado_por: user?.id || null,
          status: resultado.validado ? "validado" : "divergencia",
        })
        .eq("id", relatorio.id);
      
      return resultado;
    },
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: ["relatorios-banco"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-fechamentos"] });
      if (resultado.validado) {
        toast.success("Validação concluída - Dados conferem!");
      } else {
        toast.warning(`Validação concluída - Divergências encontradas: ${formatCurrency(resultado.divergencia_valor)}`);
      }
    },
    onError: (error) => {
      toast.error(`Erro ao validar: ${error.message}`);
    },
  });

  // Mutation para excluir
  const deleteMutation = useMutation({
    mutationFn: async (relatorioId: string) => {
      const { error } = await supabase
        .from("relatorios_banco_pdf")
        .delete()
        .eq("id", relatorioId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relatorios-banco"] });
      toast.success("Relatório excluído com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao excluir: ${error.message}`);
    },
  });

  const handleFileChange = async (file: File | null) => {
    setUploadFile(file);
    setParsedData(null);
    
    if (!file) return;
    
    // Validar se é PDF
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Por favor, selecione um arquivo PDF");
      setUploadFile(null);
      return;
    }

    // Parse do PDF
    setIsParsing(true);
    try {
      const parsed = await parsePDFBradesco(file);
      setParsedData(parsed);
      
      if (parsed.erros.length > 0) {
        parsed.erros.forEach((erro) => toast.error(`Erro no parsing: ${erro}`));
      }
      if (parsed.warnings.length > 0) {
        parsed.warnings.forEach((warning) => toast.warning(`Aviso no parsing: ${warning}`));
      }
    } catch (error) {
      toast.error(`Erro ao processar PDF: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
      setParsedData(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleUpload = () => {
    if (!uploadFile) {
      toast.error("Selecione um arquivo PDF");
      return;
    }
    
    if (parsedData && parsedData.erros.length > 0) {
      toast.error("Corrija os erros no PDF antes de fazer upload");
      return;
    }
    
    uploadMutation.mutate();
  };

  const handleEdit = (relatorio: RelatorioBancoPDF) => {
    setSelectedRelatorio(relatorio);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (relatorio: RelatorioBancoPDF) => {
    if (confirm("Tem certeza que deseja excluir este relatório?")) {
      deleteMutation.mutate(relatorio.id);
    }
  };

  const handleValidar = (relatorio: RelatorioBancoPDF) => {
    validarMutation.mutate(relatorio);
  };

  /**
   * Extrai o caminho do arquivo da URL ou reconstrói a partir dos dados do relatório
   */
  const extrairCaminhoDoArquivo = (relatorio: RelatorioBancoPDF): string => {
    // Prioridade 1: Extrair diretamente da URL pública (mais confiável)
    if (relatorio.arquivo_url) {
      try {
        const url = new URL(relatorio.arquivo_url);
        const pathParts = url.pathname.split('/').filter(part => part); // Remove partes vazias
        
        // Procurar pelo padrão: /storage/v1/object/public/bucket/caminho
        const publicIndex = pathParts.findIndex(part => part === 'public');
        if (publicIndex !== -1 && pathParts.length > publicIndex + 2) {
          // Formato: storage/v1/object/public/bucket/caminho
          // Pular 'public' e o nome do bucket, pegar o resto
          const caminhoDecodificado = decodeURIComponent(pathParts.slice(publicIndex + 2).join('/'));
          
          // Se o caminho contém espaços (arquivo antigo), sanitizar o nome do arquivo
          const caminhoParts = caminhoDecodificado.split('/');
          const nomeArquivo = caminhoParts[caminhoParts.length - 1];
          if (nomeArquivo.includes(' ') || nomeArquivo !== nomeArquivo.toLowerCase()) {
            // Sanitizar o nome do arquivo
            const nomeArquivoSanitizado = sanitizarNomeArquivo(nomeArquivo);
            caminhoParts[caminhoParts.length - 1] = nomeArquivoSanitizado;
            return caminhoParts.join('/');
          }
          
          return caminhoDecodificado;
        }
        
        // Alternativa: se a URL já contém o caminho direto após o bucket
        const bucketIndex = pathParts.findIndex(part => part === 'relatorios-banco-pdf');
        if (bucketIndex !== -1 && pathParts.length > bucketIndex + 1) {
          const caminhoDecodificado = decodeURIComponent(pathParts.slice(bucketIndex + 1).join('/'));
          
          // Se o caminho contém espaços (arquivo antigo), sanitizar o nome do arquivo
          const caminhoParts = caminhoDecodificado.split('/');
          const nomeArquivo = caminhoParts[caminhoParts.length - 1];
          if (nomeArquivo.includes(' ') || nomeArquivo !== nomeArquivo.toLowerCase()) {
            // Sanitizar o nome do arquivo
            const nomeArquivoSanitizado = sanitizarNomeArquivo(nomeArquivo);
            caminhoParts[caminhoParts.length - 1] = nomeArquivoSanitizado;
            return caminhoParts.join('/');
          }
          
          return caminhoDecodificado;
        }
      } catch (error) {
        console.warn("Erro ao extrair caminho da URL:", error);
      }
    }
    
    // Prioridade 2: Reconstruir a partir do nome do arquivo (fallback)
    // Para arquivos antigos que podem ter espaços no nome do banco, mas foram salvos sanitizados no storage
    const nomeArquivo = relatorio.arquivo_nome;
    // Extrair timestamp e nome do arquivo
    const match = nomeArquivo.match(/^(\d+)-(.+)$/);
    
    if (match) {
      const timestamp = match[1];
      const nomeOriginal = match[2];
      // Sanitizar o nome para corresponder ao nome no storage
      const nomeSanitizado = sanitizarNomeArquivo(nomeOriginal);
      const nomeArquivoCompleto = `${timestamp}-${nomeSanitizado}`;
      
      if (relatorio.fechamento_id) {
        return `${relatorio.empresa_id}/${relatorio.fechamento_id}/${nomeArquivoCompleto}`;
      } else {
        return `${relatorio.empresa_id}/${nomeArquivoCompleto}`;
      }
    }
    
    throw new Error("Não foi possível determinar o caminho do arquivo");
  };

  /**
   * Abre o PDF em nova aba, usando signed URL se necessário
   */
  const handleVisualizarPDF = async (relatorio: RelatorioBancoPDF) => {
    try {
      // Tentar usar URL pública primeiro
      if (relatorio.arquivo_url) {
        // Testar se a URL pública funciona fazendo uma requisição HEAD
        try {
          const response = await fetch(relatorio.arquivo_url, { method: 'HEAD' });
          if (response.ok) {
            window.open(relatorio.arquivo_url, "_blank");
            return;
          }
        } catch (error) {
          // Se falhar, continuar para gerar signed URL
          console.warn("URL pública não acessível, gerando signed URL:", error);
        }
      }
      
      // Se não houver URL pública ou se falhar, gerar signed URL
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuário não autenticado");
        return;
      }
      
      const caminho = extrairCaminhoDoArquivo(relatorio);
      
      const { data: signedUrlData, error } = await supabase.storage
        .from("relatorios-banco-pdf")
        .createSignedUrl(caminho, 3600); // URL válida por 1 hora
      
      if (error) {
        throw new Error(`Erro ao gerar URL assinada: ${error.message}`);
      }
      
      if (signedUrlData?.signedUrl) {
        window.open(signedUrlData.signedUrl, "_blank");
      } else {
        throw new Error("URL assinada não foi gerada");
      }
    } catch (error) {
      toast.error(`Erro ao abrir PDF: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
      console.error("Erro ao visualizar PDF:", error);
    }
  };

  const getStatusBadge = (relatorio: RelatorioBancoPDF) => {
    if (relatorio.status === "validado") {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Validado
        </Badge>
      );
    }
    if (relatorio.status === "divergencia") {
      return (
        <Badge variant="secondary" className="bg-orange-100 text-orange-800">
          <AlertCircle className="mr-1 h-3 w-3" />
          Divergência
        </Badge>
      );
    }
    if (relatorio.status === "erro") {
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Erro
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        <AlertCircle className="mr-1 h-3 w-3" />
        Extraído
      </Badge>
    );
  };

  const getValidacaoBadge = (relatorio: RelatorioBancoPDF) => {
    if (!relatorio.validado_contra_fechamento) {
      return <Badge variant="outline">Não validado</Badge>;
    }
    if (relatorio.divergencia_valor === 0) {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800">
          OK
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-orange-100 text-orange-800">
        Divergência: {formatCurrency(Math.abs(relatorio.divergencia_valor))}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios Bancários</h1>
          <p className="text-muted-foreground">
            Gerencie PDFs de relatórios bancários (Posição de Carteira)
          </p>
        </div>
        <Button onClick={() => setIsUploadDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Upload PDF
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
                onValueChange={(value) => {
                  if (isStatusFilterValue(value)) {
                    setFilters({ ...filters, status: value });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="validado">Validado</SelectItem>
                  <SelectItem value="extraido">Extraído</SelectItem>
                  <SelectItem value="divergencia">Divergência</SelectItem>
                  <SelectItem value="erro">Erro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {filters.fechamentoId && (
              <div className="space-y-2">
                <Label>Fechamento Filtrado</Label>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setFilters({ ...filters, fechamentoId: "" });
                    setSearchParams({});
                  }}
                >
                  Limpar Filtro
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lista de Relatórios */}
      <Card>
        <CardHeader>
          <CardTitle>Relatórios ({relatorios?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : relatorios && relatorios.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data Upload</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Fechamento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Validação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatorios.map((relatorio) => (
                    <TableRow key={relatorio.id}>
                      <TableCell>
                        {new Date(relatorio.data_upload).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          {relatorio.arquivo_nome}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Versão {relatorio.versao}
                        </div>
                      </TableCell>
                      <TableCell>
                        {relatorio.fechamento_id ? (
                          <Button
                            variant="link"
                            className="p-0 h-auto"
                            onClick={() => navigate(`/financeiro/cobranca-bancaria/fechamentos`)}
                          >
                            Ver Fechamento
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(relatorio)}</TableCell>
                      <TableCell>{getValidacaoBadge(relatorio)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleVisualizarPDF(relatorio)}
                            title="Visualizar PDF"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(relatorio)}
                            title="Editar"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {relatorio.fechamento_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleValidar(relatorio)}
                              disabled={validarMutation.isPending}
                              title="Validar"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedRelatorio(relatorio);
                              setIsHistoricoDialogOpen(true);
                            }}
                            title="Histórico"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(relatorio)}
                            disabled={deleteMutation.isPending}
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum relatório encontrado para o período selecionado
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de Upload */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Upload de Relatório Bancário</DialogTitle>
            <DialogDescription>
              Faça upload do PDF "Posição de Carteira" do banco
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2">
              <Label>Arquivo PDF</Label>
              <Input
                type="file"
                accept=".pdf"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                disabled={isParsing}
              />
              {isParsing && (
                <p className="text-sm text-muted-foreground">Processando PDF...</p>
              )}
            </div>
            
            {/* Preview dos dados parseados */}
            {parsedData && (
              <Card>
                <CardHeader>
                  <CardTitle>Prévia dos Dados Extraídos</CardTitle>
                  <CardDescription>
                    Verifique os dados antes de confirmar o upload
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Erros */}
                  {parsedData.erros.length > 0 && (
                    <div className="rounded-md bg-destructive/10 p-3">
                      <p className="text-sm font-medium text-destructive mb-2">Erros:</p>
                      <ul className="list-disc list-inside text-sm text-destructive space-y-1">
                        {parsedData.erros.map((erro, idx) => (
                          <li key={idx}>{erro}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {/* Warnings */}
                  {parsedData.warnings.length > 0 && (
                    <div className="rounded-md bg-yellow-50 p-3">
                      <p className="text-sm font-medium text-yellow-800 mb-2">Avisos:</p>
                      <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1">
                        {parsedData.warnings.map((warning, idx) => (
                          <li key={idx}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {/* Dados da Consulta */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Agência</Label>
                      <p className="text-sm font-medium">{parsedData.dados_consulta.agencia || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Conta</Label>
                      <p className="text-sm font-medium">{parsedData.dados_consulta.conta || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Beneficiário</Label>
                      <p className="text-sm font-medium">{parsedData.dados_consulta.beneficiario_nome || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Data Operação</Label>
                      <p className="text-sm font-medium">{parsedData.dados_consulta.data_operacao || "-"}</p>
                    </div>
                  </div>
                  
                  {/* Posição de Carteira - Principais */}
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <Label className="text-xs text-muted-foreground">Saldo Anterior</Label>
                      <p className="text-sm font-medium">
                        {parsedData.posicao_carteira.saldo_anterior.qtd} títulos - {formatCurrency(parsedData.posicao_carteira.saldo_anterior.valor)}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Saldo Atual</Label>
                      <p className="text-sm font-medium">
                        {parsedData.posicao_carteira.saldo_atual.qtd} títulos - {formatCurrency(parsedData.posicao_carteira.saldo_atual.valor)}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Entradas</Label>
                      <p className="text-sm font-medium">
                        {parsedData.posicao_carteira.saldo_entradas.qtd} títulos - {formatCurrency(parsedData.posicao_carteira.saldo_entradas.valor)}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Baixas</Label>
                      <p className="text-sm font-medium">
                        {parsedData.posicao_carteira.saldo_baixas.qtd} títulos - {formatCurrency(parsedData.posicao_carteira.saldo_baixas.valor)}
                      </p>
                    </div>
                  </div>
                  
                  {/* Índice de Liquidez */}
                  {(parsedData.indice_liquidez.diaria_percent > 0 || parsedData.indice_liquidez.mensal_percent > 0) && (
                    <div className="pt-2 border-t">
                      <Label className="text-xs text-muted-foreground">Índice de Liquidez</Label>
                      <div className="grid grid-cols-2 gap-4 mt-2">
                        <p className="text-sm">
                          <span className="font-medium">Diária:</span> {parsedData.indice_liquidez.diaria_percent}%
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Mensal:</span> {parsedData.indice_liquidez.mensal_percent}%
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              <Label>Fechamento (Opcional)</Label>
              <Select 
                value={uploadFechamentoId || undefined} 
                onValueChange={(value) => setUploadFechamentoId(value || "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um fechamento" />
                </SelectTrigger>
                <SelectContent>
                  {fechamentos?.map((fechamento) => (
                    <SelectItem key={fechamento.id} value={fechamento.id}>
                      {new Date(fechamento.data_fechamento).toLocaleDateString("pt-BR")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Banco (Opcional)</Label>
              <Select 
                value={uploadBancoId || undefined} 
                onValueChange={(value) => setUploadBancoId(value || "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um banco" />
                </SelectTrigger>
                <SelectContent>
                  {bancos?.map((banco) => (
                    <SelectItem key={banco.id} value={banco.id.toString()}>
                      {banco.nome} ({banco.codigo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!uploadFile || uploadMutation.isPending || isParsing || (parsedData?.erros.length || 0) > 0}
            >
              {uploadMutation.isPending ? "Enviando..." : isParsing ? "Processando..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Edição */}
      {selectedRelatorio && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar Relatório</DialogTitle>
              <DialogDescription>
                {selectedRelatorio.arquivo_nome}
              </DialogDescription>
            </DialogHeader>
            <EditarRelatorioBanco
              relatorio={selectedRelatorio}
              onSuccess={() => {
                setIsEditDialogOpen(false);
                setSelectedRelatorio(null);
              }}
              onCancel={() => {
                setIsEditDialogOpen(false);
                setSelectedRelatorio(null);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog de Histórico */}
      {selectedRelatorio && (
        <Dialog open={isHistoricoDialogOpen} onOpenChange={setIsHistoricoDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Histórico de Versões</DialogTitle>
              <DialogDescription>
                Versões anteriores deste relatório
              </DialogDescription>
            </DialogHeader>
            <HistoricoRelatorioBanco
              relatorioId={selectedRelatorio.id}
              onClose={() => {
                setIsHistoricoDialogOpen(false);
                setSelectedRelatorio(null);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
