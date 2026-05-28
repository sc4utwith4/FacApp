import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  getDeleteDevolucaoMessage,
  useOperacoesFornecedor,
  useCreateOperacaoEstoque,
  useDeleteOperacaoEstoque,
  useRegistrarRecompra,
  useDevolucoesEstoque,
  useUpdateDevolucaoEstoque,
  useDeleteDevolucaoEstoque,
} from "@/hooks/useEstoque";
import { useCreateRecebivelOperacaoEstoque } from "@/hooks/useRecebiveisEstoque";
import { useFornecedoresSelect } from "@/hooks/useFornecedores";
import { useDisecuritImport, normalizeCnpjValue } from "@/hooks/useDisecuritImport";
import type { OperacaoEstoqueComRelacoes, TipoEstoque, DistribuicaoConta } from "@/types/estoque";
import {
  calcularLiquidoSPPRO,
  calcularLiquidoSOI,
} from "@/types/estoque";
import { DistribuicaoContas } from "@/components/estoque/DistribuicaoContas";
import { ensureUUID } from "@/lib/uuid";
import type { DisecuritProgram, OperationImportDocument, OperationImportFile } from "@/types/disecurit-import";
import {
  getPayloadClientDocument,
  getPayloadDocumentNumber,
  getImportProgram,
  isImportPayloadReady,
  normalizeLegacyToCanonical,
  resolveProgramForPrefill,
  toOperationImportDocuments,
} from "@/lib/disecurit/disecuritAdapters";
import { mapToUiSOI, mapToUiSPPRO } from "@/lib/disecurit/disecuritMappers";
// Funções utilitárias locais
const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || isNaN(value)) {
    return "R$ 0,00";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "-";
  try {
    // Se já está no formato YYYY-MM-DD, adiciona T00:00:00 para evitar problemas de timezone
    const date = new Date(dateString.includes('T') ? dateString : dateString + "T00:00:00");
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("pt-BR");
  } catch {
    return dateString;
  }
};

const formatInputNumber = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(2);
};

const normalizeDateInput = (value?: string | null): string => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/");
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().split("T")[0];
};

interface OperacoesFornecedorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fornecedorId: string | number;
  fornecedorNome: string;
  tipoEstoque: "SPPRO" | "SOI";
  empresaId: string;
  estoquesSelect: Array<{ id: number; descricao: string; tipo: string }>;
  contasBancarias: Array<{ id: string; descricao: string }>;
  initialImportFileId?: string | null;
  onEditOperacao?: (operacao: OperacaoEstoqueComRelacoes) => void;
  onDeleteOperacao?: (operacao: OperacaoEstoqueComRelacoes) => void;
}

export function OperacoesFornecedorDialog({
  open,
  onOpenChange,
  fornecedorId,
  fornecedorNome,
  tipoEstoque,
  empresaId,
  estoquesSelect,
  contasBancarias,
  initialImportFileId,
  onEditOperacao,
  onDeleteOperacao,
}: OperacoesFornecedorDialogProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"operacoes" | "nova" | "devolucoes">("operacoes");
  const [filtrosOperacoes, setFiltrosOperacoes] = useState({
    dataInicio: "",
    dataFim: "",
    tipoOperacao: "todos" as "entrada" | "saida" | "todos",
  });

  // Formulário para nova operação
  const [formData, setFormData] = useState(() => ({
    estoque_id: "",
    data: new Date().toISOString().split("T")[0],
    face_titulos: "",
    valor_compra: "",
    ad_valorem: "",
    iss: "",
    iof: "",
    iof_adicional: "",
    despesas: "",
    recompra: "",
    amortizacao_debitos: "",
    amortizacao_creditos: "",
    historico: "",
    documento: "",
  }));

  // Estado para distribuições
  const [distribuicoes, setDistribuicoes] = useState<DistribuicaoConta[]>([]);
  const [selectedImportFileId, setSelectedImportFileId] = useState<string>("");
  const [importDocuments, setImportDocuments] = useState<OperationImportDocument[]>([]);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [autoPrefillAppliedId, setAutoPrefillAppliedId] = useState<string | null>(null);

  // Converter fornecedorId para string se necessário
  const fornecedorIdStr = typeof fornecedorId === 'number' ? fornecedorId.toString() : fornecedorId;

  const disecuritImport = useDisecuritImport({
    includeLinked: false,
    statuses: ['parsed', 'parse_partial'],
    enabled: open,
  });
  const { data: fornecedoresSelect = [] } = useFornecedoresSelect();

  const fornecedorAtual = useMemo(() => {
    return fornecedoresSelect.find((item) => String(item.id) === fornecedorIdStr);
  }, [fornecedorIdStr, fornecedoresSelect]);

  const { data: operacoes, isLoading: isLoadingOperacoes } = useOperacoesFornecedor(
    fornecedorIdStr,
    tipoEstoque,
    {
      data_inicio: filtrosOperacoes.dataInicio || undefined,
      data_fim: filtrosOperacoes.dataFim || undefined,
      tipo_operacao: filtrosOperacoes.tipoOperacao !== "todos" ? filtrosOperacoes.tipoOperacao : undefined,
    }
  );

  // Buscar devoluções para todas as operações de entrada
  const operacoesEntradaIds = operacoes?.filter(op => op.tipo_operacao === 'entrada').map(op => op.id) || [];
  const { data: todasDevolucoes } = useDevolucoesEstoque();
  
  // Filtrar devoluções apenas das operações deste fornecedor
  const devolucoesFornecedor = useMemo(() => {
    if (!todasDevolucoes || !operacoesEntradaIds.length) return [];
    return todasDevolucoes.filter(dev => operacoesEntradaIds.includes(dev.operacao_estoque_id));
  }, [todasDevolucoes, operacoesEntradaIds]);
  
  // Criar mapa de devoluções por operação
  const devolucoesPorOperacao = useMemo(() => {
    if (!devolucoesFornecedor.length) return new Map<number, number>();
    const mapa = new Map<number, number>();
    devolucoesFornecedor.forEach(dev => {
      const atual = mapa.get(dev.operacao_estoque_id) || 0;
      mapa.set(dev.operacao_estoque_id, atual + (Number(dev.valor_devolucao) || 0));
    });
    return mapa;
  }, [devolucoesFornecedor]);

  const createOperacao = useCreateOperacaoEstoque();
  const deleteOperacao = useDeleteOperacaoEstoque();
  const registrarRecompra = useRegistrarRecompra();
  const updateDevolucao = useUpdateDevolucaoEstoque();
  const deleteDevolucao = useDeleteDevolucaoEstoque();
  const createRecebivel = useCreateRecebivelOperacaoEstoque();

  // Filtrar estoques por tipo
  const estoquesFiltrados = useMemo(
    () => estoquesSelect.filter((e) => e.tipo === tipoEstoque),
    [estoquesSelect, tipoEstoque]
  );

  // Resetar formulário quando dialog abrir
  useEffect(() => {
    if (open) {
      const primeiroEstoque = estoquesFiltrados[0]?.id?.toString() || "";
      setFormData({
        estoque_id: primeiroEstoque,
        data: new Date().toISOString().split("T")[0],
        face_titulos: "",
        valor_compra: "",
        ad_valorem: "",
        iss: "",
        iof: "",
        iof_adicional: "",
        despesas: "",
        recompra: "",
        amortizacao_debitos: "",
      amortizacao_creditos: "",
      historico: "",
        documento: "",
      });
      setDistribuicoes([]);
      setSelectedImportFileId("");
      setImportDocuments([]);
      setImportWarning(null);
      setAutoPrefillAppliedId(null);
      setActiveTab("operacoes");
    }
  }, [open, estoquesFiltrados]);

  const parseCurrency = (value: string): number => {
    if (!value) return 0;
    const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
    if (!cleaned) return 0;

    let normalized = cleaned;

    if (cleaned.includes(",") && cleaned.includes(".")) {
      const lastComma = cleaned.lastIndexOf(",");
      const lastDot = cleaned.lastIndexOf(".");

      normalized =
        lastComma > lastDot
          ? cleaned.replace(/\./g, "").replace(",", ".")
          : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }

    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const importsDisponiveis = disecuritImport.availableForPrefill || [];
  const importsCompativeis = useMemo(() => {
    return importsDisponiveis.filter((item) => {
      return getImportProgram(item) === tipoEstoque;
    });
  }, [importsDisponiveis, tipoEstoque]);
  const selectedImportFile = useMemo(() => {
    if (!selectedImportFileId) return null;
    return importsDisponiveis.find((item) => item.id === selectedImportFileId) || null;
  }, [importsDisponiveis, selectedImportFileId]);

  const buildImportWarning = (
    importFile: OperationImportFile,
    resolvedProgram?: DisecuritProgram,
  ) => {
    const cnpjImportRaw = getPayloadClientDocument(importFile.parsed_payload);
    const cnpjImport = normalizeCnpjValue(cnpjImportRaw || null);
    const cnpjFornecedorAtual = normalizeCnpjValue(fornecedorAtual?.cnpj || null);
    const parsedCanonical = normalizeLegacyToCanonical(importFile.parsed_payload);
    const hasCriticalConflict =
      Boolean(parsedCanonical?.debug?.has_critical_conflict) ||
      Boolean(
        parsedCanonical?.debug?.extraction_diagnostics?.some(
          (diagnostic: unknown) => {
            const row = (diagnostic || {}) as Record<string, unknown>;
            return Boolean(row.critical) && Boolean(row.conflict_flag);
          }
        )
      );

    if (hasCriticalConflict) {
      return 'Conflito crítico de extração numérica detectado no PDF. Revise os valores manualmente antes de salvar.';
    }

    if (parsedCanonical && resolvedProgram && parsedCanonical.program !== resolvedProgram) {
      return `Atenção: o PDF foi detectado como ${parsedCanonical.program}, mas o estoque selecionado está em ${resolvedProgram}. Revise os valores antes de salvar.`;
    }

    if (!cnpjImport) {
      return "CNPJ do cliente não foi identificado no PDF. Confira o fornecedor selecionado antes de salvar.";
    }

    if (!cnpjFornecedorAtual) {
      return "Fornecedor selecionado não possui CNPJ cadastrado. Valide manualmente antes de salvar.";
    }

    if (cnpjImport !== cnpjFornecedorAtual) {
      return `Atenção: o CNPJ do PDF (${cnpjImportRaw || cnpjImport}) não corresponde ao fornecedor atual (${fornecedorAtual?.cnpj || cnpjFornecedorAtual}).`;
    }

    return null;
  };

  const clearImportPrefill = () => {
    setSelectedImportFileId("");
    setImportDocuments([]);
    setImportWarning(null);
  };

  const applyImportToForm = (importFile: OperationImportFile) => {
    if (!isImportPayloadReady(importFile)) {
      toast.error("Import inconsistente: payload indisponível. Reprocesse o PDF antes do prefill.");
      return;
    }

    const payload = importFile.parsed_payload || null;
    const canonical = normalizeLegacyToCanonical(payload);

    if (!canonical) {
      toast.error("Não foi possível interpretar o payload do import DISECURIT. Reprocesse este item.");
      return;
    }

    const resolvedProgram = resolveProgramForPrefill(tipoEstoque, canonical);
    const uiDefaultsSPPRO = resolvedProgram === "SPPRO" ? mapToUiSPPRO(canonical) : null;
    const uiDefaultsSOI = resolvedProgram === "SOI" ? mapToUiSOI(canonical) : null;
    const baseDate = uiDefaultsSPPRO?.data || uiDefaultsSOI?.data;
    const baseDocumento = uiDefaultsSPPRO?.documento || uiDefaultsSOI?.documento;
    const baseFace = uiDefaultsSPPRO?.faceDosTitulos ?? uiDefaultsSOI?.faceDosTitulos ?? null;
    const baseValorCompra =
      uiDefaultsSPPRO?.valorDeCompra ?? uiDefaultsSOI?.valorDeCompra ?? null;
    const baseDespesas = uiDefaultsSPPRO?.despesas ?? uiDefaultsSOI?.despesas ?? null;
    const baseAmortDeb =
      uiDefaultsSPPRO?.amortizacaoDebitos ?? uiDefaultsSOI?.amortizacaoDebitos ?? null;
    const baseAmortCred =
      uiDefaultsSPPRO?.amortizacaoCreditos ?? uiDefaultsSOI?.amortizacaoCreditos ?? null;
    const baseHistorico = uiDefaultsSOI?.historico;
    const documents = toOperationImportDocuments(canonical);

    setSelectedImportFileId(importFile.id);
    setImportWarning(buildImportWarning(importFile, resolvedProgram));
    setImportDocuments(documents);

    setFormData((prev) => ({
      ...prev,
      data: normalizeDateInput(baseDate) || prev.data,
      face_titulos:
        baseFace !== undefined && baseFace !== null
          ? formatInputNumber(Number(baseFace))
          : prev.face_titulos,
      valor_compra:
        baseValorCompra !== undefined && baseValorCompra !== null
          ? formatInputNumber(Number(baseValorCompra))
          : prev.valor_compra,
      ad_valorem:
        uiDefaultsSPPRO?.adValorem !== undefined && uiDefaultsSPPRO?.adValorem !== null
          ? formatInputNumber(Number(uiDefaultsSPPRO.adValorem))
          : "0.00",
      iss:
        uiDefaultsSPPRO?.iss !== undefined && uiDefaultsSPPRO?.iss !== null
          ? formatInputNumber(Number(uiDefaultsSPPRO.iss))
          : "0.00",
      iof:
        uiDefaultsSPPRO?.iof !== undefined && uiDefaultsSPPRO?.iof !== null
          ? formatInputNumber(Number(uiDefaultsSPPRO.iof))
          : "0.00",
      iof_adicional:
        uiDefaultsSPPRO?.iofAdicional !== undefined && uiDefaultsSPPRO?.iofAdicional !== null
          ? formatInputNumber(Number(uiDefaultsSPPRO.iofAdicional))
          : "0.00",
      despesas:
        baseDespesas !== undefined && baseDespesas !== null
          ? formatInputNumber(Number(baseDespesas))
          : prev.despesas || "0.00",
      amortizacao_debitos:
        baseAmortDeb !== undefined && baseAmortDeb !== null
          ? formatInputNumber(Number(baseAmortDeb))
          : prev.amortizacao_debitos || "0.00",
      amortizacao_creditos:
        baseAmortCred !== undefined && baseAmortCred !== null
          ? formatInputNumber(Number(baseAmortCred))
          : prev.amortizacao_creditos || "0.00",
      historico: baseHistorico || prev.historico || "Importado via DISECURIT",
      documento:
        baseDocumento ||
        getPayloadDocumentNumber(importFile.parsed_payload) ||
        importFile.operation_number ||
        prev.documento,
    }));

    setActiveTab("nova");

    const hasCriticalConflict =
      Boolean(canonical?.debug?.has_critical_conflict) ||
      Boolean(
        canonical?.debug?.extraction_diagnostics?.some(
          (diagnostic: unknown) => {
            const row = (diagnostic || {}) as Record<string, unknown>;
            return Boolean(row.critical) && Boolean(row.conflict_flag);
          }
        )
      );

    if (importFile.parse_status === "parse_partial" || hasCriticalConflict) {
      toast.warning("Import com divergência de extração. Revise os campos antes de salvar.");
    } else {
      toast.success("Prefill aplicado com sucesso.");
    }
  };

  const updateImportDocumentField = (
    index: number,
    field: keyof OperationImportDocument,
    value: string
  ) => {
    setImportDocuments((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        if (["flt", "prz_flt", "valor", "desagio", "liquido", "prz"].includes(field)) {
          return {
            ...item,
            [field]: value === "" ? null : parseCurrency(value),
          } as OperationImportDocument;
        }

        return {
          ...item,
          [field]: value,
        } as OperationImportDocument;
      })
    );
  };

  const removeImportDocumentRow = (index: number) => {
    setImportDocuments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const addImportDocumentRow = () => {
    setImportDocuments((prev) => [
      ...prev,
      {
        sacado_nome: "",
        sacado_cnpj: "",
        documento: "",
        vencimento: "",
        flt: null,
        prz_flt: null,
        valor: null,
        desagio: null,
        liquido: null,
        prz: null,
        carteira: "",
        tipo_doc: "",
      },
    ]);
  };

  useEffect(() => {
    if (!open || !initialImportFileId || autoPrefillAppliedId === initialImportFileId) {
      return;
    }

    if (!importsDisponiveis.length) {
      return;
    }

    const importFile =
      importsCompativeis.find((item) => item.id === initialImportFileId) ||
      importsDisponiveis.find((item) => item.id === initialImportFileId);
    if (!importFile) {
      return;
    }

    applyImportToForm(importFile);
    setAutoPrefillAppliedId(initialImportFileId);
  }, [autoPrefillAppliedId, importsCompativeis, importsDisponiveis, initialImportFileId, open]);

  const handleSubmitNovaOperacao = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.estoque_id) {
      toast.error("Selecione um estoque");
      return;
    }

    if (!formData.face_titulos || parseCurrency(formData.face_titulos) <= 0) {
      toast.error("Informe o valor da face dos títulos");
      return;
    }

    if (!formData.valor_compra || parseCurrency(formData.valor_compra) <= 0) {
      toast.error("Informe o valor de compra");
      return;
    }


    try {
      // Converter fornecedorId para UUID string
      const fornecedorIdStr = typeof fornecedorId === 'number' 
        ? fornecedorId.toString() 
        : fornecedorId;
      
      const fornecedorIdUUID = ensureUUID(fornecedorIdStr);
      if (!fornecedorIdUUID) {
        toast.error("ID do fornecedor inválido");
        return;
      }

      const payload: any = {
        empresa_id: empresaId,
        estoque_id: Number.parseInt(formData.estoque_id, 10),
        fornecedor_id: fornecedorIdUUID,
        tipo_operacao: "entrada" as const, // Sempre entrada para operações do fornecedor
        tipo_estoque: tipoEstoque, // Campo obrigatório para validação
        data: formData.data,
        face_titulos: parseCurrency(formData.face_titulos),
        valor_compra: parseCurrency(formData.valor_compra),
        despesas: parseCurrency(formData.despesas || "0"),
        // Recompra agora é registrada separadamente via aba Recompras, sempre usar 0 ao criar operação
        recompra: 0,
        historico: formData.historico || "",
        documento: formData.documento || null,
        distribuicoes: distribuicoes.length > 0 ? distribuicoes : undefined,
      };

      if (tipoEstoque === "SPPRO") {
        payload.ad_valorem = parseCurrency(formData.ad_valorem || "0");
        payload.iss = parseCurrency(formData.iss || "0");
        payload.iof = parseCurrency(formData.iof || "0");
        payload.amortizacao_debitos = parseCurrency(formData.amortizacao_debitos || "0");
        payload.amortizacao_creditos = parseCurrency(formData.amortizacao_creditos || "0");
        const iofAdicional = parseCurrency(formData.iof_adicional || "0");
        payload.liquido_operacao = calcularLiquidoSPPRO({
          face_titulos: payload.face_titulos,
          valor_compra: payload.valor_compra,
          ad_valorem: payload.ad_valorem,
          iss: payload.iss,
          iof: payload.iof,
          iof_adicional: iofAdicional,
          despesas: payload.despesas,
          recompra: payload.recompra,
          amortizacao_debitos: payload.amortizacao_debitos,
          amortizacao_creditos: payload.amortizacao_creditos,
        });
      } else {
        payload.amortizacao_debitos = parseCurrency(formData.amortizacao_debitos || "0");
        payload.amortizacao_creditos = parseCurrency(formData.amortizacao_creditos || "0");
        payload.liquido_operacao = calcularLiquidoSOI({
          face_titulos: payload.face_titulos,
          valor_compra: payload.valor_compra,
          despesas: payload.despesas,
          recompra: payload.recompra,
          amortizacao_debitos: payload.amortizacao_debitos,
          amortizacao_creditos: payload.amortizacao_creditos,
        });
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('📦 Payload da operação:', payload);
      }

      const operacaoCriada = await createOperacao.mutateAsync(payload);
      let importLinkError: string | null = null;

      // Criar recebível automaticamente após criar operação
      if (operacaoCriada && operacaoCriada.id) {
        let valorRecebivel = 0;
        let descricao = "";

        if (tipoEstoque === "SPPRO") {
          // Calcular soma dos valores para SPPRO
          valorRecebivel = payload.valor_compra + payload.ad_valorem + payload.iss + payload.iof + 
                          parseCurrency(formData.iof_adicional || "0") + payload.despesas +
                          payload.amortizacao_debitos + payload.amortizacao_creditos;
        } else {
          // Calcular soma dos valores para SOI (incluindo créditos normalmente)
          valorRecebivel = payload.valor_compra + payload.amortizacao_debitos + 
                          payload.amortizacao_creditos + payload.despesas;
        }

        // Formatar data da operação para o histórico
        const dataOperacaoFormatada = new Date(formData.data).toLocaleDateString('pt-BR');
        
        // Criar descrição formatada
        descricao = `Recebível Operação #${operacaoCriada.id} - ${fornecedorNome} - ${dataOperacaoFormatada}`;

        // Criar recebível usando a data da operação
        await createRecebivel.mutateAsync({
          operacao_estoque_id: operacaoCriada.id,
          empresa_id: empresaId,
          valor: valorRecebivel,
          data_vencimento: formData.data,
          descricao: descricao,
          tipo_estoque: tipoEstoque,
        });

        if (selectedImportFileId) {
          try {
            await disecuritImport.linkImportMutation.mutateAsync({
              importFileId: selectedImportFileId,
              operacaoEstoqueId: operacaoCriada.id,
              documents: importDocuments,
            });
          } catch (linkError: any) {
            importLinkError = linkError?.message || 'Erro ao vincular import DISECURIT';
          }
        }
      }

      // Invalidar queries
      queryClient.invalidateQueries({ queryKey: ["operacoes-estoque"] });
      queryClient.invalidateQueries({ queryKey: ["operacoes-fornecedor"] });
      queryClient.invalidateQueries({ queryKey: ["estoques-resumo"] });
      queryClient.invalidateQueries({ queryKey: ["recebiveis-estoque"] });
      queryClient.invalidateQueries({ queryKey: ["lancamentos-previstos"] });
      queryClient.invalidateQueries({ queryKey: ["disecurit-import-files"] });

      if (importLinkError) {
        toast.warning(`Operação criada, mas houve falha ao vincular o import: ${importLinkError}`);
      } else {
        toast.success("Operação criada com sucesso!");
      }
      
      // Resetar formulário e voltar para aba de operações
      setActiveTab("operacoes");
      setFormData({
        ...formData,
        face_titulos: "",
        valor_compra: "",
        ad_valorem: "",
        iss: "",
        iof: "",
        iof_adicional: "",
        despesas: "",
        recompra: "",
        amortizacao_debitos: "",
      amortizacao_creditos: "",
      historico: "",
        documento: "",
      });
      setDistribuicoes([]);
      clearImportPrefill();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao criar operação");
    }
  };

  const handleDeleteOperacao = async (operacao: OperacaoEstoqueComRelacoes) => {
    if (!operacao.id) return;

    try {
      await deleteOperacao.mutateAsync(operacao.id);

      queryClient.invalidateQueries({ queryKey: ["operacoes-estoque"] });
      queryClient.invalidateQueries({ queryKey: ["operacoes-fornecedor"] });
      queryClient.invalidateQueries({ queryKey: ["estoques-resumo"] });

      toast.success("Operação excluída com sucesso!");
    } catch (error: any) {
      toast.error(error?.message || "Erro ao excluir operação");
    }
  };

  const handleEdit = (operacao: OperacaoEstoqueComRelacoes) => {
    if (onEditOperacao) {
      onEditOperacao(operacao);
      onOpenChange(false);
    }
  };


  const liquidoPreview = useMemo(() => {
    if (tipoEstoque === "SPPRO") {
      return calcularLiquidoSPPRO({
        face_titulos: parseCurrency(formData.face_titulos || "0"),
        valor_compra: parseCurrency(formData.valor_compra || "0"),
        ad_valorem: parseCurrency(formData.ad_valorem || "0"),
        iss: parseCurrency(formData.iss || "0"),
        iof: parseCurrency(formData.iof || "0"),
        iof_adicional: parseCurrency(formData.iof_adicional || "0"),
        despesas: parseCurrency(formData.despesas || "0"),
        // Recompra agora é registrada separadamente via aba Recompras
        recompra: 0,
        amortizacao_debitos: parseCurrency(formData.amortizacao_debitos || "0"),
        amortizacao_creditos: parseCurrency(formData.amortizacao_creditos || "0"),
      });
    } else {
      return calcularLiquidoSOI({
        face_titulos: parseCurrency(formData.face_titulos || "0"),
        valor_compra: parseCurrency(formData.valor_compra || "0"),
        despesas: parseCurrency(formData.despesas || "0"),
        // Recompra agora é registrada separadamente via aba Recompras
        recompra: 0,
        amortizacao_debitos: parseCurrency(formData.amortizacao_debitos || "0"),
        amortizacao_creditos: parseCurrency(formData.amortizacao_creditos || "0"),
      });
    }
  }, [formData, tipoEstoque]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Operações - {fornecedorNome}</DialogTitle>
          <DialogDescription>
            Visualize e gerencie todas as operações {tipoEstoque} deste fornecedor
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "operacoes" | "nova" | "devolucoes")}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="operacoes">Operações ({operacoes?.length || 0})</TabsTrigger>
            <TabsTrigger value="devolucoes">Devoluções ({devolucoesFornecedor.length})</TabsTrigger>
            <TabsTrigger value="nova">Nova Operação</TabsTrigger>
          </TabsList>

          <TabsContent value="operacoes" className="space-y-4 mt-4">
            {/* Filtros */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Filtros</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="dataInicio">Data Início</Label>
                    <Input
                      id="dataInicio"
                      type="date"
                      value={filtrosOperacoes.dataInicio}
                      onChange={(e) =>
                        setFiltrosOperacoes({ ...filtrosOperacoes, dataInicio: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="dataFim">Data Fim</Label>
                    <Input
                      id="dataFim"
                      type="date"
                      value={filtrosOperacoes.dataFim}
                      onChange={(e) =>
                        setFiltrosOperacoes({ ...filtrosOperacoes, dataFim: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="tipoOperacao">Tipo de Operação</Label>
                    <Select
                      value={filtrosOperacoes.tipoOperacao}
                      onValueChange={(value) =>
                        setFiltrosOperacoes({
                          ...filtrosOperacoes,
                          tipoOperacao: value as "entrada" | "saida" | "todos",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todas</SelectItem>
                        <SelectItem value="entrada">Entradas</SelectItem>
                        <SelectItem value="saida">Saídas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tabela de Operações */}
            <Card>
              <CardContent className="p-0">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Estoque</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Face dos Títulos</TableHead>
                        {tipoEstoque === "SPPRO" ? (
                          <>
                            <TableHead>Ad-Valorem</TableHead>
                            <TableHead>ISS</TableHead>
                            <TableHead>IOF</TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead>Amort. Débitos</TableHead>
                            <TableHead>Amort. Créditos</TableHead>
                          </>
                        )}
                        <TableHead>Despesas</TableHead>
                        <TableHead>Recompra</TableHead>
                        <TableHead className="text-right">Líquido</TableHead>
                        <TableHead className="text-right">Devoluções</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoadingOperacoes ? (
                        <TableRow>
                          <TableCell colSpan={tipoEstoque === "SPPRO" ? 13 : 12} className="text-center">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : !operacoes || operacoes.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={tipoEstoque === "SPPRO" ? 13 : 12}
                            className="text-center text-muted-foreground"
                          >
                            Nenhuma operação encontrada
                          </TableCell>
                        </TableRow>
                      ) : (
                        operacoes.map((op) => {
                          const liquido = Number(op.liquido_operacao) || 0;
                          const totalDevolvido = op.tipo_operacao === 'entrada' ? (devolucoesPorOperacao.get(op.id) || 0) : 0;
                          return (
                            <TableRow key={op.id}>
                              <TableCell>{formatDate(op.data)}</TableCell>
                              <TableCell>
                                {op.estoques?.descricao || `Estoque #${op.estoque_id || "-"}`}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`px-2 py-1 rounded text-xs ${
                                    op.tipo_operacao === "entrada"
                                      ? "bg-success/10 text-success"
                                      : "bg-destructive/10 text-destructive"
                                  }`}
                                >
                                  {op.tipo_operacao === "entrada" ? "Entrada" : "Saída"}
                                </span>
                              </TableCell>
                              <TableCell>{formatCurrency(Number(op.face_titulos) || 0)}</TableCell>
                              {tipoEstoque === "SPPRO" ? (
                                <>
                                  <TableCell>{formatCurrency(Number(op.ad_valorem) || 0)}</TableCell>
                                  <TableCell>{formatCurrency(Number(op.iss) || 0)}</TableCell>
                                  <TableCell>{formatCurrency(Number(op.iof) || 0)}</TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell>
                                    {formatCurrency(Number(op.amortizacao_debitos) || 0)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCurrency(Number(op.amortizacao_creditos) || 0)}
                                  </TableCell>
                                </>
                              )}
                              <TableCell>{formatCurrency(Number(op.despesas) || 0)}</TableCell>
                              <TableCell>{formatCurrency(Number(op.recompra) || 0)}</TableCell>
                              <TableCell
                                className={`text-right font-medium ${
                                  op.tipo_operacao === "saida" ? "text-destructive" : "text-success"
                                }`}
                              >
                                {formatCurrency(liquido)}
                              </TableCell>
                              <TableCell className="text-right">
                                {op.tipo_operacao === "entrada" ? (
                                  <div className="flex flex-col items-end">
                                    <span className={`text-sm font-medium ${totalDevolvido > 0 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                                      {formatCurrency(totalDevolvido)}
                                    </span>
                                    {totalDevolvido > 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        de {formatCurrency(Number(op.face_titulos) || 0)}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => handleEdit(op)}
                                    aria-label="Editar operação"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground"
                                    onClick={() => handleDeleteOperacao(op)}
                                    aria-label="Excluir operação"
                                    disabled={deleteOperacao.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="nova" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Nova Operação {tipoEstoque}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitNovaOperacao} className="space-y-4">
                  <div className="rounded-md border border-muted/60 bg-muted/20 p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="import_file_id">PDF Importado (DISECURIT)</Label>
                        <Select
                          value={selectedImportFileId || "none"}
                          onValueChange={(value) => {
                            if (value === "none") {
                              clearImportPrefill();
                              return;
                            }

                            const importFile = importsCompativeis.find((item) => item.id === value);
                            if (importFile) {
                              applyImportToForm(importFile);
                            }
                          }}
                        >
                          <SelectTrigger id="import_file_id">
                            <SelectValue placeholder="Selecione um PDF parseado para prefill" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem prefill</SelectItem>
                            {importsCompativeis.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                                {(item.operation_number || getPayloadDocumentNumber(item.parsed_payload) || item.original_filename || item.id).slice(0, 70)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {disecuritImport.importsQuery.isLoading && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Carregando imports disponíveis...
                          </p>
                        )}
                        {!disecuritImport.importsQuery.isLoading && importsCompativeis.length === 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Nenhum import compatível com {tipoEstoque} disponível para prefill.
                          </p>
                        )}
                      </div>

                      <div className="text-sm text-muted-foreground">
                        <p>
                          Use um PDF parseado para pré-preencher os campos da operação e editar os documentos antes de salvar.
                        </p>
                        {selectedImportFile && (
                          <p className="mt-2">
                            <strong>Selecionado:</strong>{" "}
                            {selectedImportFile.operation_number || getPayloadDocumentNumber(selectedImportFile.parsed_payload) || selectedImportFile.original_filename || selectedImportFile.id}
                          </p>
                        )}
                      </div>
                    </div>

                    {importWarning && (
                      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
                        {importWarning}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="estoque_id">Estoque *</Label>
                      <Select
                        value={formData.estoque_id}
                        onValueChange={(value) =>
                          setFormData({ ...formData, estoque_id: value })
                        }
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o estoque" />
                        </SelectTrigger>
                        <SelectContent>
                          {estoquesFiltrados.map((estoque) => (
                            <SelectItem key={estoque.id} value={estoque.id.toString()}>
                              {estoque.descricao || `Estoque #${estoque.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="data">Data *</Label>
                      <Input
                        id="data"
                        type="date"
                        value={formData.data}
                        onChange={(e) => setFormData({ ...formData, data: e.target.value })}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="face_titulos">Face dos Títulos *</Label>
                      <Input
                        id="face_titulos"
                        type="text"
                        value={formData.face_titulos}
                        onChange={(e) =>
                          setFormData({ ...formData, face_titulos: e.target.value })
                        }
                        placeholder="0,00"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="valor_compra">Valor de Compra *</Label>
                      <Input
                        id="valor_compra"
                        type="text"
                        value={formData.valor_compra}
                        onChange={(e) =>
                          setFormData({ ...formData, valor_compra: e.target.value })
                        }
                        placeholder="0,00"
                        required
                      />
                    </div>

                    {tipoEstoque === "SPPRO" ? (
                      <>
                        <div>
                          <Label htmlFor="ad_valorem">Ad-Valorem</Label>
                          <Input
                            id="ad_valorem"
                            type="text"
                            value={formData.ad_valorem}
                            onChange={(e) =>
                              setFormData({ ...formData, ad_valorem: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                        <div>
                          <Label htmlFor="iss">ISS</Label>
                          <Input
                            id="iss"
                            type="text"
                            value={formData.iss}
                            onChange={(e) =>
                              setFormData({ ...formData, iss: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                        <div>
                          <Label htmlFor="iof">IOF</Label>
                          <Input
                            id="iof"
                            type="text"
                            value={formData.iof}
                            onChange={(e) =>
                              setFormData({ ...formData, iof: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                        <div>
                          <Label htmlFor="iof_adicional">IOF Adicional</Label>
                          <Input
                            id="iof_adicional"
                            type="text"
                            value={formData.iof_adicional}
                            onChange={(e) =>
                              setFormData({ ...formData, iof_adicional: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <Label htmlFor="amortizacao_debitos">Amortização de Débitos</Label>
                          <Input
                            id="amortizacao_debitos"
                            type="text"
                            value={formData.amortizacao_debitos}
                            onChange={(e) =>
                              setFormData({ ...formData, amortizacao_debitos: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                        <div>
                          <Label htmlFor="amortizacao_creditos">Amortização de Créditos</Label>
                          <Input
                            id="amortizacao_creditos"
                            type="text"
                            value={formData.amortizacao_creditos}
                            onChange={(e) =>
                              setFormData({ ...formData, amortizacao_creditos: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <Label htmlFor="despesas">Despesas</Label>
                      <Input
                        id="despesas"
                        type="text"
                        value={formData.despesas}
                        onChange={(e) =>
                          setFormData({ ...formData, despesas: e.target.value })
                        }
                        placeholder="0,00"
                      />
                    </div>

                    {tipoEstoque === "SPPRO" && (
                      <>
                        <div>
                          <Label htmlFor="amortizacao_debitos">Amortização de Débitos</Label>
                          <Input
                            id="amortizacao_debitos"
                            type="text"
                            value={formData.amortizacao_debitos}
                            onChange={(e) =>
                              setFormData({ ...formData, amortizacao_debitos: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                        <div>
                          <Label htmlFor="amortizacao_creditos">Amortização de Créditos</Label>
                          <Input
                            id="amortizacao_creditos"
                            type="text"
                            value={formData.amortizacao_creditos}
                            onChange={(e) =>
                              setFormData({ ...formData, amortizacao_creditos: e.target.value })
                            }
                            placeholder="0,00"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <Label htmlFor="documento">Documento</Label>
                      <Input
                        id="documento"
                        type="text"
                        value={formData.documento}
                        onChange={(e) =>
                          setFormData({ ...formData, documento: e.target.value })
                        }
                        placeholder="Número do documento"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="historico">Histórico</Label>
                    <Textarea
                      id="historico"
                      value={formData.historico}
                      onChange={(e) =>
                        setFormData({ ...formData, historico: e.target.value })
                      }
                      placeholder="Descrição da operação"
                      rows={3}
                    />
                  </div>

                  {(selectedImportFileId || importDocuments.length > 0) && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Documentos importados (editáveis)</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {importDocuments.length === 0 ? (
                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            Nenhum documento extraído neste import. Você pode adicionar manualmente.
                          </div>
                        ) : (
                          <div className="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Sacado</TableHead>
                                  <TableHead>CNPJ</TableHead>
                                  <TableHead>Documento</TableHead>
                                  <TableHead>Vencimento</TableHead>
                                  <TableHead>Valor</TableHead>
                                  <TableHead>Deságio</TableHead>
                                  <TableHead>Líquido</TableHead>
                                  <TableHead>Carteira</TableHead>
                                  <TableHead>Tipo</TableHead>
                                  <TableHead className="text-right">Ação</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {importDocuments.map((doc, index) => (
                                  <TableRow key={`import-doc-${index}`}>
                                    <TableCell className="min-w-[220px]">
                                      <Input
                                        value={doc.sacado_nome || ""}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "sacado_nome", event.target.value)
                                        }
                                        placeholder="Nome do sacado"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[170px]">
                                      <Input
                                        value={doc.sacado_cnpj || ""}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "sacado_cnpj", event.target.value)
                                        }
                                        placeholder="CNPJ"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[120px]">
                                      <Input
                                        value={doc.documento || ""}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "documento", event.target.value)
                                        }
                                        placeholder="Documento"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[150px]">
                                      <Input
                                        type="date"
                                        value={normalizeDateInput(doc.vencimento || "")}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "vencimento", event.target.value)
                                        }
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[120px]">
                                      <Input
                                        value={doc.valor === null || doc.valor === undefined ? "" : String(doc.valor)}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "valor", event.target.value)
                                        }
                                        placeholder="0,00"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[120px]">
                                      <Input
                                        value={doc.desagio === null || doc.desagio === undefined ? "" : String(doc.desagio)}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "desagio", event.target.value)
                                        }
                                        placeholder="0,00"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[120px]">
                                      <Input
                                        value={doc.liquido === null || doc.liquido === undefined ? "" : String(doc.liquido)}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "liquido", event.target.value)
                                        }
                                        placeholder="0,00"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[100px]">
                                      <Input
                                        value={doc.carteira === null || doc.carteira === undefined ? "" : String(doc.carteira)}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "carteira", event.target.value)
                                        }
                                        placeholder="Carteira"
                                      />
                                    </TableCell>
                                    <TableCell className="min-w-[90px]">
                                      <Input
                                        value={doc.tipo_doc || ""}
                                        onChange={(event) =>
                                          updateImportDocumentField(index, "tipo_doc", event.target.value)
                                        }
                                        placeholder="DP"
                                      />
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => removeImportDocumentRow(index)}
                                        aria-label="Remover documento"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}

                        <div className="flex justify-end">
                          <Button type="button" variant="outline" onClick={addImportDocumentRow}>
                            Adicionar documento
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="bg-muted/50 p-4 rounded-md">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Líquido da Operação:</span>
                      <span className="text-lg font-bold text-success">
                        {formatCurrency(liquidoPreview)}
                      </span>
                    </div>
                  </div>

                  {liquidoPreview > 0 && (
                    <DistribuicaoContas
                      liquidoOperacao={liquidoPreview}
                      contasBancarias={contasBancarias}
                      distribuicoes={distribuicoes}
                      onChange={setDistribuicoes}
                    />
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={createOperacao.isPending}>
                      {createOperacao.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Criando...
                        </>
                      ) : (
                        "Criar Operação"
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="devolucoes" className="space-y-4 mt-4">
            {/* Tabela de Devoluções */}
            <Card>
              <CardContent className="p-0">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Operação</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Histórico</TableHead>
                        <TableHead>Observações</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!devolucoesFornecedor || devolucoesFornecedor.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            Nenhuma devolução encontrada
                          </TableCell>
                        </TableRow>
                      ) : (
                        devolucoesFornecedor.map((dev) => {
                          const operacao = operacoes?.find(op => op.id === dev.operacao_estoque_id);
                          return (
                            <TableRow key={dev.id}>
                              <TableCell>{formatDate(dev.data_devolucao)}</TableCell>
                              <TableCell>
                                {operacao ? (
                                  <span className="text-sm">
                                    Operação #{dev.operacao_estoque_id} - {formatDate(operacao.data)}
                                  </span>
                                ) : (
                                  <span className="text-sm text-muted-foreground">
                                    Operação #{dev.operacao_estoque_id}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium text-orange-600">
                                {formatCurrency(dev.valor_devolucao)}
                              </TableCell>
                              <TableCell>{dev.historico || "-"}</TableCell>
                              <TableCell>{dev.observacoes || "-"}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => {
                                      // TODO: Implementar edição
                                      toast.info('Edição de devolução em desenvolvimento');
                                    }}
                                    aria-label="Editar devolução"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground"
                                    onClick={async () => {
                                      if (confirm('Tem certeza que deseja excluir esta devolução?')) {
                                        try {
                                          await deleteDevolucao.mutateAsync(dev.id);
                                        } catch (error: unknown) {
                                          const erro = error as { code?: string; message?: string };
                                          toast.error(getDeleteDevolucaoMessage(erro?.code, erro?.message));
                                        }
                                      }
                                    }}
                                    aria-label="Excluir devolução"
                                    disabled={deleteDevolucao.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
