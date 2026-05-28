import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
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
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TrendingUp, TrendingDown, Pencil, Trash2, ArrowLeftRight, RotateCcw, Search, Calendar, Paperclip, Ellipsis, ChevronDown, Copy } from "lucide-react";
import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { normalizeDateForDB, parseDateFromDB } from "@/lib/utils";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  getDeleteDevolucaoMessage,
  useCreateTransferenciaEstoque,
  useEstoquesSelect,
  useMovimentacoesComoLancamentos,
  useUpdateMovimentacaoEstoque,
  useDeleteMovimentacaoEstoque,
  useDeleteDevolucaoEstoque,
} from "@/hooks/useEstoque";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TipoTransferencia } from "@/types/estoque";
import { DevolucaoEstoqueDialog } from "@/components/estoque/DevolucaoEstoqueDialog";
import { TransferirDevolucoesDialog } from "@/components/estoque/TransferirDevolucoesDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useNavigate } from "react-router-dom";
import { VerificationStatusBadge } from "@/features/bank-reconciliation/VerificationStatusBadge";
import type { ConciliacaoItemStatus } from "@/types/bank-reconciliation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLancamentoAnexos } from "@/hooks/useLancamentoAnexos";
import { LancamentoDetailsPanel } from "@/components/financeiro/lancamentos/LancamentoDetailsPanel";
import {
  resolveTenantEmpresaId,
  type ProfileEmpresaRow,
} from "@/pages/financeiro/lancamentos/tenantResolution";
import type {
  LancamentoAnexo,
  LancamentoCategoriaOperacional,
  LancamentoOrigem,
} from "@/types/lancamentos";
import {
  getCategoriaOperacionalLabel,
  getLancamentoCategoriaOperacional,
  inferOperacaoByText,
} from "@/lib/lancamentos/categoria-operacional";
import { extractMovimentacaoLancamentoVinculoIds } from "@/hooks/movimentacaoLancamentoVinculo";

interface MovimentacaoOriginal {
  id: number;
  tipo: TipoTransferencia;
  data: string;
  valor: number | string;
  historico?: string | null;
  conta_bancaria_id?: string | null;
  conta_bancaria_destino_id?: string | null;
  estoque_origem_id?: number | null;
  estoque_destino_id?: number | null;
}

interface Lancamento {
  id: string;
  data: string;
  historico: string;
  tipo: "entrada" | "saida";
  valor: number;
  documento: string;
  conta_bancaria_id: string | null;
  grupo_contas_id: string | null;
  observacoes?: string | null;
  contas_bancarias?: { descricao: string };
  grupos_contas?: { nome: string };
  conta_bancaria_destino_id?: string | null;
  // Propriedades para movimentações
  _isMovimentacao?: boolean;
  _movimentacaoOriginal?: MovimentacaoOriginal;
}

interface ContaBancaria {
  id: string;
  descricao: string;
}

interface GrupoConta {
  id: string;
  nome: string;
  natureza: string;
}

type GroupByOption = "none" | "conta" | "grupo" | "tipo";
type LancamentosAba = "lancamentos" | "movimentacoes";
type TipoFiltro = "todos" | "entrada" | "saida";
type CategoriaOperacionalFiltro = "todas" | LancamentoCategoriaOperacional;

type VerificationStatusMap = Record<
  string,
  {
    status: ConciliacaoItemStatus;
    confirmado_centavos: number;
    valor_centavos: number;
    item_financeiro_id?: string;
    ai_suggested_and_human_approved?: boolean;
  }
>;

const VERIFIED_STATUS: ConciliacaoItemStatus = "verificado";

const TIPOS_TRANSFERENCIA_MOVIMENTACAO = new Set<TipoTransferencia>([
  "conta_para_conta",
  "conta_para_estoque",
  "estoque_para_conta",
  "estoque_para_estoque",
]);

const isMovimentacaoTransferencia = (lanc: Lancamento): boolean =>
  Boolean(lanc._movimentacaoOriginal?.tipo && TIPOS_TRANSFERENCIA_MOVIMENTACAO.has(lanc._movimentacaoOriginal.tipo));

const isTransferenciaEditRpcEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_TRANSFERENCIA_EDIT_RPC === "true";

const toLocalISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getTodayLocalISODate = (): string => toLocalISODate(new Date());

const TIPO_FILTER_OPTIONS: TipoFiltro[] = ["todos", "entrada", "saida"];

const CATEGORIAS_LANCAMENTOS: Array<{ value: CategoriaOperacionalFiltro; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "entrada", label: "Entradas" },
  { value: "saida", label: "Saídas" },
  { value: "devolucao", label: "Devoluções" },
  { value: "recompra", label: "Recompras" },
  { value: "operacao", label: "Operações" },
];

const CATEGORIAS_MOVIMENTACOES: Array<{ value: CategoriaOperacionalFiltro; label: string }> = [
  { value: "movimentacao", label: "Todas movimentações" },
];

function normalizeLegacyTipoFilter(tipo: string): TipoFiltro {
  return TIPO_FILTER_OPTIONS.includes(tipo as TipoFiltro) ? (tipo as TipoFiltro) : "todos";
}

type DevolucaoVinculadaRow = {
  id: number;
  lancamento_caixa_id: string;
  operacao_estoque_id?: number | null;
  tipo_origem_devolucao?: string | null;
};

type PrevistoVinculadoRow = {
  id: number;
  lancamento_caixa_id: string;
  fixa_id: number;
  vencimento: string;
  status: string;
};

type RecompraVinculadaRow = {
  id: number;
  operacao_estoque_id: number | null;
  status: "pendente" | "paga";
  data_recompra: string;
  data_pagamento: string | null;
  lancamento_saida_id: string | null;
  lancamento_entrada_id: string | null;
};

function getLancamentoOrigemKey(lanc: Lancamento): string | null {
  if (lanc._isMovimentacao) {
    const movId = lanc._movimentacaoOriginal?.id ?? Number(String(lanc.id).replace(/^mov_/, ""));
    if (!movId || Number.isNaN(Number(movId))) return null;
    return `movimentacao_estoque:${movId}`;
  }

  if (!lanc.id) return null;
  return `lancamento_caixa:${lanc.id}`;
}

function getConciliacaoLockErrorMessage(error: unknown, fallback: string): string {
  const raw = String((error as { message?: string })?.message || "");
  if (raw.includes("LANCAMENTO_VERIFICADO_BLOQUEADO") || raw.includes("MOVIMENTACAO_VERIFICADA_BLOQUEADA")) {
    return "Item verificado nao pode ser alterado/excluido. Desfaca a conciliacao antes.";
  }
  if (raw.includes("EDICAO_TRANSFERENCIA_RPC_DESATIVADA")) {
    return "Edição transacional de transferência ainda está desativada. Aplique a migration da RPC e ative VITE_ENABLE_TRANSFERENCIA_EDIT_RPC=true antes de editar.";
  }
  if (raw.includes("TIPO_TRANSFERENCIA_NAO_SUPORTADO")) {
    return "Edição de Estoque → Estoque segue bloqueada nesta fase por falta de rastreabilidade determinística da operação de origem.";
  }
  if (raw.includes("MOVIMENTACAO_SEM_VINCULO") || raw.includes("LEGADO_AMBIGUO")) {
    return "Esta movimentação não possui vínculos determinísticos suficientes para edição segura. Exclua e registre novamente, ou envie para auditoria.";
  }
  return raw || fallback;
}

export default function Lancamentos() {
  const navigate = useNavigate();
  const isBelowLg = useMediaQuery("(max-width: 1023px)");
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([]);
  const [gruposContas, setGruposContas] = useState<GrupoConta[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [editingLancamento, setEditingLancamento] = useState<Lancamento | null>(null);
  const [lancamentoToDelete, setLancamentoToDelete] = useState<Lancamento | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isMovimentacaoDialogOpen, setIsMovimentacaoDialogOpen] = useState(false);
  const [isDevolucaoDialogOpen, setIsDevolucaoDialogOpen] = useState(false);
  const [lancamentoParaDevolucao, setLancamentoParaDevolucao] = useState<{
    data: string;
    valor: string;
    historico: string;
    documento?: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const createTransferencia = useCreateTransferenciaEstoque();
  const updateMovimentacao = useUpdateMovimentacaoEstoque();
  const deleteMovimentacao = useDeleteMovimentacaoEstoque();
  const deleteDevolucao = useDeleteDevolucaoEstoque();
  const { data: movimentacoes, isLoading: isLoadingMovimentacoes } = useMovimentacoesComoLancamentos();

  const [filters, setFilters] = useState({
    dataInicio: "",
    dataFim: "",
    tipo: "todos" as TipoFiltro,
    categoriaOperacional: "todas" as CategoriaOperacionalFiltro,
    contaId: "todos",
    fornecedorId: "todos",
    busca: "",
    valorMin: "",
    valorMax: "",
    documento: "",
  });
  const [isLancamentosLoading, setIsLancamentosLoading] = useState(false);
  const [lancamentosError, setLancamentosError] = useState<string | null>(null);
  const [isTransferirDevolucoesOpen, setIsTransferirDevolucoesOpen] = useState(false);
  const [abaLancamentos, setAbaLancamentos] = useState<LancamentosAba>("lancamentos");
  const [currentPage, setCurrentPage] = useState(1);
  const [verificationStatusByKey, setVerificationStatusByKey] = useState<VerificationStatusMap>({});
  const [origemByLancamentoId, setOrigemByLancamentoId] = useState<Record<string, LancamentoOrigem>>({});
  const [selectedLancamento, setSelectedLancamento] = useState<Lancamento | null>(null);
  const [isAnexosDialogOpen, setIsAnexosDialogOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByOption>("none");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const PAGE_SIZE = 50;
  
  const [formData, setFormData] = useState({
    data: getTodayLocalISODate(),
    historico: "",
    tipo: "entrada" as "entrada" | "saida",
    valor: "",
    documento: "",
    conta_bancaria_id: "",
    grupo_contas_id: "",
  });

  const [tipoMovimentacao, setTipoMovimentacao] = useState<TipoTransferencia>("conta_para_conta");
  const [movimentacaoData, setMovimentacaoData] = useState({
    conta_origem_id: "",
    conta_destino_id: "",
    estoque_origem_id: "",
    estoque_destino_id: "",
    valor: "",
    data: getTodayLocalISODate(),
    historico: "",
  });
  
  const { data: estoquesSelect = [] } = useEstoquesSelect();
  const selectedLancamentoIdForAnexo =
    selectedLancamento && !selectedLancamento._isMovimentacao && isValidUUID(selectedLancamento.id)
      ? selectedLancamento.id
      : null;
  const { anexosQuery, uploadAnexoMutation, removeAnexoMutation, openAnexoMutation } =
    useLancamentoAnexos(empresaId, selectedLancamentoIdForAnexo);

  const fetchEmpresaId = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", session.user.id)
        .maybeSingle();

      const profile = (profileData as ProfileEmpresaRow | null) || null;
      
      if (error) {
        logger.error("Erro ao buscar empresa_id:", error);
        return;
      }
      
      const tenant = resolveTenantEmpresaId(profile);
      if (tenant.reason === "ok") {
        setEmpresaId(tenant.empresaId);
        return;
      }

      if (tenant.reason === "missing_profile") {
        toast.error("Perfil não encontrado para o usuário. Contate o administrador.");
        return;
      }

      if (tenant.reason === "missing_empresa_id") {
        toast.error("Perfil sem empresa vinculada. Contate o administrador.");
        return;
      }

      toast.error("Erro: empresa_id inválido no perfil. Contate o administrador.");
    } catch (error: unknown) {
      logger.error("Erro ao buscar empresa_id:", error);
    }
  }, []);

  const getVerificationStatus = (lanc: Lancamento): ConciliacaoItemStatus => {
    const origemKey = getLancamentoOrigemKey(lanc);
    if (!origemKey) return "nao_conciliado";
    return verificationStatusByKey[origemKey]?.status || "nao_conciliado";
  };

  const isVerifiedLancamento = (lanc: Lancamento): boolean => {
    return getVerificationStatus(lanc) === VERIFIED_STATUS;
  };

  const hasAiConciliationProvenance = (lanc: Lancamento): boolean => {
    const origemKey = getLancamentoOrigemKey(lanc);
    if (!origemKey) return false;
    return Boolean(verificationStatusByKey[origemKey]?.ai_suggested_and_human_approved);
  };

  const getItemFinanceiroCode = (lanc: Lancamento): string | null => {
    const origemKey = getLancamentoOrigemKey(lanc);
    if (!origemKey) return null;
    const code = verificationStatusByKey[origemKey]?.item_financeiro_id;
    return code ? String(code) : null;
  };

  const getOrigemLancamento = useCallback((lanc: Lancamento): LancamentoOrigem => {
    if (lanc._isMovimentacao) {
      return {
        tipo: "movimentacao",
        label: "Movimentação",
        referencia: lanc._movimentacaoOriginal?.id ? `MOV-${lanc._movimentacaoOriginal.id}` : null,
      };
    }

    return (
      origemByLancamentoId[lanc.id] || {
        tipo: "manual",
        label: "Manual",
      }
    );
  }, [origemByLancamentoId]);

  const getCategoriaOperacional = useCallback((lanc: Lancamento): LancamentoCategoriaOperacional => {
    const origem = getOrigemLancamento(lanc);
    return getLancamentoCategoriaOperacional(lanc, origem);
  }, [getOrigemLancamento]);

  const getCategoriaBadge = (lanc: Lancamento) => {
    const categoria = getCategoriaOperacional(lanc);
    const label = getCategoriaOperacionalLabel(categoria);

    if (categoria === "devolucao") {
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
          {label}
        </Badge>
      );
    }

    if (categoria === "movimentacao") {
      return <Badge variant="secondary">{label}</Badge>;
    }

    if (categoria === "recompra") {
      return (
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
          {label}
        </Badge>
      );
    }

    if (categoria === "operacao") {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          {label}
        </Badge>
      );
    }

    return <Badge variant={categoria === "entrada" ? "default" : "destructive"}>{label}</Badge>;
  };

  const copyCodeToClipboard = async (code: string, label: string) => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("clipboard indisponível");
      }
      await navigator.clipboard.writeText(code);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error(`Não foi possível copiar ${label.toLowerCase()}.`);
    }
  };

  const loadLancamentoOrigens = useCallback(async (rows: Lancamento[]) => {
    if (!empresaId || !isValidUUID(empresaId)) {
      setOrigemByLancamentoId({});
      return;
    }

    const nextMap: Record<string, LancamentoOrigem> = {};
    const lancamentoIds = rows
      .filter((row) => !row._isMovimentacao && isValidUUID(row.id))
      .map((row) => row.id);

    for (const row of rows) {
      if (row._isMovimentacao) {
        nextMap[row.id] = {
          tipo: "movimentacao",
          label: "Movimentação",
          referencia: row._movimentacaoOriginal?.id ? `MOV-${row._movimentacaoOriginal.id}` : null,
        };
      } else if (isValidUUID(row.id)) {
        nextMap[row.id] = {
          tipo: "manual",
          label: "Manual",
        };
      }
    }

    if (!lancamentoIds.length) {
      setOrigemByLancamentoId(nextMap);
      return;
    }

    try {
      const chunkSize = 200;
      for (let index = 0; index < lancamentoIds.length; index += chunkSize) {
        const chunk = lancamentoIds.slice(index, index + chunkSize);

        const { data: devolucoes, error: devolucoesError } = await supabase
          .from("devolucoes_estoque")
          .select("id,lancamento_caixa_id,operacao_estoque_id,tipo_origem_devolucao")
          .eq("empresa_id", empresaId)
          .in("lancamento_caixa_id", chunk);

        if (devolucoesError) throw devolucoesError;

        for (const row of (devolucoes || []) as DevolucaoVinculadaRow[]) {
          if (!row.lancamento_caixa_id) continue;
          nextMap[row.lancamento_caixa_id] = {
            tipo: "devolucao_estoque",
            label: "Devolução de estoque",
            referencia: `DEV-${row.id}`,
            metadata: {
              operacao_estoque_id: row.operacao_estoque_id || null,
              tipo_origem_devolucao: row.tipo_origem_devolucao || null,
            },
          };
        }

        const { data: recomprasBySaida, error: recompraSaidaError } = await supabase
          .from("recompras_estoque")
          .select(
            "id,operacao_estoque_id,status,data_recompra,data_pagamento,lancamento_saida_id,lancamento_entrada_id",
          )
          .eq("empresa_id", empresaId)
          .in("lancamento_saida_id", chunk);

        if (recompraSaidaError) throw recompraSaidaError;

        for (const row of (recomprasBySaida || []) as RecompraVinculadaRow[]) {
          if (!row.lancamento_saida_id) continue;
          if (nextMap[row.lancamento_saida_id]?.tipo === "devolucao_estoque") continue;
          nextMap[row.lancamento_saida_id] = {
            tipo: "recompra_estoque",
            label: "Recompra de estoque",
            referencia: `REC-${row.id}`,
            metadata: {
              operacao_estoque_id: row.operacao_estoque_id,
              status: row.status,
              etapa: "saida",
              data_recompra: row.data_recompra,
            },
          };
        }

        const { data: recomprasByEntrada, error: recompraEntradaError } = await supabase
          .from("recompras_estoque")
          .select(
            "id,operacao_estoque_id,status,data_recompra,data_pagamento,lancamento_saida_id,lancamento_entrada_id",
          )
          .eq("empresa_id", empresaId)
          .in("lancamento_entrada_id", chunk);

        if (recompraEntradaError) throw recompraEntradaError;

        for (const row of (recomprasByEntrada || []) as RecompraVinculadaRow[]) {
          if (!row.lancamento_entrada_id) continue;
          if (nextMap[row.lancamento_entrada_id]?.tipo === "devolucao_estoque") continue;
          nextMap[row.lancamento_entrada_id] = {
            tipo: "recompra_estoque",
            label: "Recompra de estoque",
            referencia: `REC-${row.id}`,
            metadata: {
              operacao_estoque_id: row.operacao_estoque_id,
              status: row.status,
              etapa: "pagamento",
              data_pagamento: row.data_pagamento,
            },
          };
        }

        const { data: previstos, error: previstosError } = await supabase
          .from("lancamentos_previstos")
          .select("id,lancamento_caixa_id,fixa_id,vencimento,status")
          .eq("empresa_id", empresaId)
          .eq("status", "pago")
          .in("lancamento_caixa_id", chunk);

        if (previstosError) throw previstosError;

        for (const row of (previstos || []) as PrevistoVinculadoRow[]) {
          if (!row.lancamento_caixa_id) continue;
          const tipoAtual = nextMap[row.lancamento_caixa_id]?.tipo;
          if (tipoAtual === "devolucao_estoque" || tipoAtual === "recompra_estoque") continue;

          nextMap[row.lancamento_caixa_id] = {
            tipo: "previsto_pago",
            label: "Previsto pago",
            referencia: `PREV-${row.id}`,
            metadata: {
              fixa_id: row.fixa_id,
              vencimento: row.vencimento,
              status: row.status,
            },
          };
        }

        for (const row of rows) {
          if (!chunk.includes(row.id)) continue;
          const origemAtual = nextMap[row.id];
          if (!origemAtual || origemAtual.tipo !== "manual") continue;
          if (!inferOperacaoByText(row.historico, row.observacoes)) continue;

          nextMap[row.id] = {
            tipo: "operacao_estoque",
            label: "Operação de estoque",
          };
        }
      }

      setOrigemByLancamentoId(nextMap);
    } catch (error: unknown) {
      logger.error("Erro ao carregar origem dos lançamentos:", error);
      setOrigemByLancamentoId(nextMap);
    }
  }, [empresaId]);

  const loadVerificationStatuses = useCallback(async (rows: Lancamento[]) => {
    if (!empresaId || !isValidUUID(empresaId)) {
      setVerificationStatusByKey({});
      return;
    }

    const origemKeys = Array.from(
      new Set(rows.map((row) => getLancamentoOrigemKey(row)).filter((value): value is string => !!value))
    );

    if (!origemKeys.length) {
      setVerificationStatusByKey({});
      return;
    }

    try {
      const statusMap: VerificationStatusMap = {};
      const chunkSize = 200;

      for (let i = 0; i < origemKeys.length; i += chunkSize) {
        const chunk = origemKeys.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("vw_conciliacao_item_status")
          .select("origem_key,status_verificacao,confirmado_centavos,valor_centavos")
          .eq("empresa_id", empresaId)
          .in("origem_key", chunk);

        if (error) throw error;

        for (const row of data || []) {
          const status = String(row.status_verificacao || "nao_conciliado") as ConciliacaoItemStatus;
          statusMap[row.origem_key] = {
            status,
            confirmado_centavos: Number(row.confirmado_centavos || 0),
            valor_centavos: Number(row.valor_centavos || 0),
          };
        }

        const { data: itemRows, error: itemError } = await supabase
          .from("conciliacao_itens_financeiros")
          .select("id,origem_key")
          .eq("empresa_id", empresaId)
          .in("origem_key", chunk);

        if (itemError) throw itemError;

        const itemIdToOrigemKey = new Map<string, string>();
        const itemIds: string[] = [];
        for (const itemRow of itemRows || []) {
          if (!itemRow?.id || !itemRow?.origem_key) continue;
          itemIds.push(String(itemRow.id));
          const origemKey = String(itemRow.origem_key);
          const itemId = String(itemRow.id);
          itemIdToOrigemKey.set(itemId, origemKey);
          statusMap[origemKey] = {
            status: statusMap[origemKey]?.status || "nao_conciliado",
            confirmado_centavos: statusMap[origemKey]?.confirmado_centavos || 0,
            valor_centavos: statusMap[origemKey]?.valor_centavos || 0,
            item_financeiro_id: itemId,
            ai_suggested_and_human_approved: statusMap[origemKey]?.ai_suggested_and_human_approved,
          };
        }

        if (itemIds.length > 0) {
          const { data: aiRows, error: aiError } = await supabase
            .from("conciliacoes_bancarias")
            .select("item_financeiro_id,method,status,confirmed_by")
            .eq("empresa_id", empresaId)
            .eq("status", "confirmed")
            .eq("method", "ai")
            .not("confirmed_by", "is", null)
            .in("item_financeiro_id", itemIds);

          if (aiError) throw aiError;

          for (const aiRow of aiRows || []) {
            const itemId = String(aiRow.item_financeiro_id || "");
            const origemKey = itemIdToOrigemKey.get(itemId);
            if (!origemKey) continue;
            statusMap[origemKey] = {
              status: statusMap[origemKey]?.status || "nao_conciliado",
              confirmado_centavos: statusMap[origemKey]?.confirmado_centavos || 0,
              valor_centavos: statusMap[origemKey]?.valor_centavos || 0,
              item_financeiro_id: statusMap[origemKey]?.item_financeiro_id,
              ai_suggested_and_human_approved: true,
            };
          }
        }
      }

      setVerificationStatusByKey(statusMap);
    } catch (error) {
      logger.error("Erro ao carregar status de verificacao da conciliacao:", error);
    }
  }, [empresaId]);

  const fetchLancamentos = useCallback(async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    setIsLancamentosLoading(true);
    setLancamentosError(null);
    try {
      let query = supabase
        .from("lancamentos_caixa")
        .select(`
          id,
          data,
          historico,
          tipo,
          valor,
          documento,
          conta_bancaria_id,
          grupo_contas_id,
          observacoes,
          created_at,
          updated_at,
          contas_bancarias(descricao),
          grupos_contas(nome)
        `)
        .eq("empresa_id", empresaId)
        .order("data", { ascending: false })
        .order("id", { ascending: false });

      // Aplicar filtros
      if (filters.dataInicio) {
        query = query.gte("data", filters.dataInicio);
      }
      if (filters.dataFim) {
        query = query.lte("data", filters.dataFim);
      }
      if (filters.contaId !== "todos") {
        query = query.eq("conta_bancaria_id", filters.contaId);
      }
      if (filters.fornecedorId !== "todos") {
        query = query.eq("grupo_contas_id", filters.fornecedorId);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Combinar lançamentos normais com movimentações
      let todosLancamentos = [...(data || [])];
      
      // Adicionar movimentações se disponíveis
      if (movimentacoes && movimentacoes.length > 0) {
        // Filtrar movimentações baseado nos filtros aplicados
        let movimentacoesFiltradas = [...movimentacoes];
        
        // Aplicar filtros de data às movimentações
        if (filters.dataInicio) {
          movimentacoesFiltradas = movimentacoesFiltradas.filter(mov => mov.data >= filters.dataInicio);
        }
        if (filters.dataFim) {
          movimentacoesFiltradas = movimentacoesFiltradas.filter(mov => mov.data <= filters.dataFim);
        }
        if (filters.contaId !== "todos") {
          movimentacoesFiltradas = movimentacoesFiltradas.filter((mov) => {
            const origem = mov.conta_bancaria_id;
            const destino = mov.conta_bancaria_destino_id;
            return origem === filters.contaId || destino === filters.contaId;
          });
        }
        todosLancamentos = [...todosLancamentos, ...movimentacoesFiltradas];
      }
      
      // Ordenar todos os lançamentos por data e ID
      todosLancamentos.sort((a, b) => {
        const dateA = new Date(a.data);
        const dateB = new Date(b.data);
        if (dateA.getTime() !== dateB.getTime()) {
          return dateB.getTime() - dateA.getTime(); // Mais recente primeiro
        }
        // Se as datas são iguais, ordenar por ID (mais recente primeiro)
        const idA = a._isMovimentacao ? parseInt(a.id.replace('mov_', '')) : parseInt(a.id);
        const idB = b._isMovimentacao ? parseInt(b.id.replace('mov_', '')) : parseInt(b.id);
        return idB - idA;
      });

      const lancamentosFinal = todosLancamentos as Lancamento[];
      setLancamentos(lancamentosFinal);
      await Promise.all([
        loadVerificationStatuses(lancamentosFinal),
        loadLancamentoOrigens(lancamentosFinal),
      ]);
    } catch (error: unknown) {
      logger.error("Erro ao carregar lançamentos:", error);
      const msg = error instanceof Error ? error.message : "Erro ao carregar lançamentos";
      setLancamentosError(msg);
      toast.error("Erro ao carregar lançamentos");
    } finally {
      setIsLancamentosLoading(false);
    }
  }, [
    empresaId,
    filters.contaId,
    filters.dataFim,
    filters.dataInicio,
    filters.fornecedorId,
    loadLancamentoOrigens,
    loadVerificationStatuses,
    movimentacoes,
  ]);

  const fetchContasBancarias = useCallback(async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from("contas_bancarias")
        .select("id, descricao")
        .eq("empresa_id", empresaId)
        .eq("status", true)
        .order("descricao");
      
      if (error) throw error;
      setContasBancarias(data || []);
    } catch (error) {
      logger.error("Erro ao carregar contas bancárias:", error);
      toast.error("Erro ao carregar contas bancárias");
    }
  }, [empresaId]);

  const fetchGruposContas = useCallback(async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from("grupos_contas")
        .select("id, nome, natureza")
        .eq("empresa_id", empresaId)
        .order("nome");
      
      if (error) throw error;
      setGruposContas(data || []);
    } catch (error) {
      logger.error("Erro ao carregar grupos de contas:", error);
      toast.error("Erro ao carregar grupos de contas");
    }
  }, [empresaId]);

  useEffect(() => {
    void fetchEmpresaId();
  }, [fetchEmpresaId]);

  useEffect(() => {
    if (empresaId) {
      void fetchContasBancarias();
      void fetchGruposContas();
    }
  }, [empresaId, fetchContasBancarias, fetchGruposContas]);

  useEffect(() => {
    if (empresaId) {
      void fetchLancamentos();
    }
  }, [empresaId, fetchLancamentos]);

  useEffect(() => {
    const normalizedTipo = normalizeLegacyTipoFilter(String(filters.tipo));
    if (normalizedTipo !== filters.tipo) {
      setFilters((prev) => ({ ...prev, tipo: normalizedTipo }));
    }
  }, [filters.tipo]);

  // Vigilante de Segurança: Limpeza global de body styles residuais do Radix UI
  useEffect(() => {
    const anyOpen = isDialogOpen || isMovimentacaoDialogOpen || isDevolucaoDialogOpen || isTransferirDevolucoesOpen;
    
    if (!anyOpen) {
      // Timer de segurança para garantir que todas as animações de saída do Radix terminaram
      const timer = setTimeout(() => {
        document.body.style.pointerEvents = "";
        document.body.style.overflow = "";
        // Limpeza de redundância shadcn/radix
        document.documentElement.style.pointerEvents = "";
        document.documentElement.style.overflow = "";
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isDialogOpen, isMovimentacaoDialogOpen, isDevolucaoDialogOpen, isTransferirDevolucoesOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaId) {
      toast.error("Empresa não encontrada. Aguarde o carregamento ou faça login novamente.");
      return;
    }

    if (!isValidUUID(empresaId)) {
      logger.error('empresaId inválido para insert lançamento:', empresaId, typeof empresaId);
      toast.error("Erro: empresa_id inválido. Recarregue a página.");
      return;
    }

    if (editingLancamento && isVerifiedLancamento(editingLancamento)) {
      toast.error("Lancamento verificado nao pode ser editado. Desfaca a conciliacao antes.");
      return;
    }

    try {
      // Normalizar data antes de salvar para evitar problemas de timezone
      const normalizedDate = normalizeDateForDB(formData.data);
      
      if (!normalizedDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        toast.error("Formato de data inválido");
        return;
      }

      const payload = {
        empresa_id: empresaId,
        data: normalizedDate, // Usar data normalizada
        historico: formData.historico,
        tipo: formData.tipo,
        valor: parseFloat(formData.valor),
        documento: formData.documento || null,
        conta_bancaria_id: formData.conta_bancaria_id || null,
        grupo_contas_id: formData.grupo_contas_id || null,
      };

      if (editingLancamento) {
        // Atualizar lançamento - os triggers do banco atualizam o saldo automaticamente
        const { error } = await supabase
          .from("lancamentos_caixa")
          .update(payload)
          .eq("id", editingLancamento.id);

        if (error) throw error;
        toast.success("Lançamento atualizado com sucesso!");
      } else {
        // Inserir novo lançamento - os triggers do banco atualizam o saldo automaticamente
        const { error } = await supabase.from("lancamentos_caixa").insert(payload);
        if (error) throw error;
        toast.success("Lançamento registrado com sucesso!");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchLancamentos();
      // Invalidar query de contas para atualizar saldos
      if (payload.conta_bancaria_id || editingLancamento?.conta_bancaria_id) {
        queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
      }
    } catch (error: unknown) {
      toast.error(getConciliacaoLockErrorMessage(error, "Erro ao registrar lançamento"));
    }
  };

  const resetForm = () => {
    try {
      setEditingLancamento(null);
      setFormData({
        data: getTodayLocalISODate(),
        historico: "",
        tipo: "entrada",
        valor: "",
        documento: "",
        conta_bancaria_id: "",
        grupo_contas_id: "",
      });
    } catch (e) {
      logger.error("resetForm", e);
    }
  };

  /** Abre o diálogo no próximo tick para o DropdownMenu fechar antes e evitar conflito de foco/overlay. */
  const openLancamentoDialog = (tipo: "entrada" | "saida") => {
    setTimeout(() => {
      setFormData((prev) => ({ ...prev, tipo }));
      setEditingLancamento(null);
      setIsDialogOpen(true);
    }, 0);
  };

  const handleEditLancamento = (lanc: Lancamento) => {
    if (isVerifiedLancamento(lanc)) {
      toast.error("Lancamento verificado nao pode ser editado. Desfaca a conciliacao antes.");
      return;
    }

    // Fecha o Sheet para evitar múltiplos modais sobrepostos
    setSelectedLancamento(null);
    // Abre o Dialog no próximo tick para o DropdownMenu fechar antes e evitar conflito de foco/overlay
    setTimeout(() => {
      setEditingLancamento(lanc);
      // Normalizar data ao editar para garantir formato correto
      const parsedDate = parseDateFromDB(lanc.data);
      const normalizedData = parsedDate ? format(parsedDate, "yyyy-MM-dd") : getTodayLocalISODate();
      
      setFormData({
        data: normalizedData,
        historico: lanc.historico,
        tipo: lanc.tipo,
        valor: lanc.valor.toString(),
        documento: lanc.documento || "",
        conta_bancaria_id: lanc.conta_bancaria_id ? lanc.conta_bancaria_id.toString() : "",
        grupo_contas_id: lanc.grupo_contas_id ? lanc.grupo_contas_id.toString() : "",
      });
      setIsDialogOpen(true);
    }, 0);
  };

  const handleDuplicateLancamento = (lanc: Lancamento) => {
    // Fecha o Sheet para evitar múltiplos modais sobrepostos
    setSelectedLancamento(null);
    // Abre o Dialog no próximo tick para o DropdownMenu fechar antes e evitar conflito de foco/overlay
    setTimeout(() => {
      const hojeIso = getTodayLocalISODate();
      setEditingLancamento(null);
      setFormData({
        data: hojeIso,
        historico: lanc.historico,
        tipo: lanc.tipo,
        valor: lanc.valor != null ? lanc.valor.toString() : "",
        documento: lanc.documento || "",
        conta_bancaria_id: lanc.conta_bancaria_id || "",
        grupo_contas_id: lanc.grupo_contas_id || "",
      });
      setIsDialogOpen(true);
    }, 0);
  };

  const handleDeleteLancamento = async () => {
    if (!lancamentoToDelete || !empresaId) return;
    if (isVerifiedLancamento(lancamentoToDelete)) {
      toast.error("Item verificado nao pode ser excluido. Desfaca a conciliacao antes.");
      setLancamentoToDelete(null);
      setIsDeleteDialogOpen(false);
      return;
    }
    
    // Se for movimentação, usar hook de deletar movimentação
    if (lancamentoToDelete._isMovimentacao && lancamentoToDelete._movimentacaoOriginal) {
      try {
        await deleteMovimentacao.mutateAsync(lancamentoToDelete._movimentacaoOriginal.id);
        setLancamentoToDelete(null);
        setIsDeleteDialogOpen(false);
        fetchLancamentos();
      } catch (error: unknown) {
        toast.error(getConciliacaoLockErrorMessage(error, "Erro ao excluir movimentação"));
      }
      return;
    }
    
    const movimentacaoVinculoIds = extractMovimentacaoLancamentoVinculoIds(lancamentoToDelete.observacoes);
    if (movimentacaoVinculoIds.length > 0) {
      if (movimentacaoVinculoIds.length > 1) {
        toast.error("Este lançamento possui múltiplos vínculos de movimentação. Exclusão bloqueada para auditoria.");
        return;
      }

      try {
        await deleteMovimentacao.mutateAsync(movimentacaoVinculoIds[0]);
        setLancamentoToDelete(null);
        setIsDeleteDialogOpen(false);
        fetchLancamentos();
      } catch (error: unknown) {
        toast.error(getConciliacaoLockErrorMessage(error, "Erro ao excluir movimentação vinculada"));
      }
      return;
    }

    // Verificar se o lançamento está vinculado a uma devolução
    try {
      // Buscar devolução vinculada ao lançamento
      const { data: devolucao } = await supabase
        .from('devolucoes_estoque')
        .select('id')
        .eq('lancamento_caixa_id', lancamentoToDelete.id)
        .eq('empresa_id', empresaId)
        .maybeSingle();

      // Exclusão de devolução deve ser SEM heurística por histórico/data/valor.
      // Só executar o fluxo de devolução quando o vínculo lancamento_caixa_id existir.
      if (devolucao) {
        try {
          await deleteDevolucao.mutateAsync(devolucao.id);
          // O hook já deleta a devolução e o lançamento vinculado.
          setLancamentoToDelete(null);
          setIsDeleteDialogOpen(false);
          fetchLancamentos();
          queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
          queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
          queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
          queryClient.invalidateQueries({ queryKey: ['estoques'] });
          if (lancamentoToDelete.conta_bancaria_id) {
            queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
          }
          return;
        } catch (error: unknown) {
          const erro = error as { code?: string; message?: string };
          toast.error(getDeleteDevolucaoMessage(erro?.code, erro?.message));
          return; // Não continuar para deletar lançamento se falhou ao deletar devolução
        }
      }

      // Caso contrário, deletar lançamento normal (não está vinculado a devolução)
      const { error } = await supabase
        .from("lancamentos_caixa")
        .delete()
        .eq("id", lancamentoToDelete.id);

      if (error) throw error;
      toast.success("Lançamento excluído com sucesso!");
      setLancamentoToDelete(null);
      setIsDeleteDialogOpen(false);
      fetchLancamentos();
      // Invalidar query de contas para atualizar saldos exibidos
      if (lancamentoToDelete.conta_bancaria_id) {
        queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
      }
    } catch (error: unknown) {
      toast.error(getConciliacaoLockErrorMessage(error, "Erro ao excluir lançamento"));
    }
  };

  const handleEditMovimentacao = (lanc: Lancamento) => {
    if (!lanc._movimentacaoOriginal) return;
    if (isVerifiedLancamento(lanc)) {
      toast.error("Movimentacao verificada nao pode ser editada. Desfaca a conciliacao antes.");
      return;
    }
    if (lanc._movimentacaoOriginal?.tipo === "estoque_para_estoque") {
      toast.error("Edição de Estoque → Estoque segue bloqueada nesta fase. Exclua e registre novamente.");
      return;
    }
    if (isMovimentacaoTransferencia(lanc) && !isTransferenciaEditRpcEnabled()) {
      toast.error("Edição transacional de transferência ainda está desativada. Exclua e registre novamente por enquanto.");
      return;
    }
    
    // Fecha o Sheet para evitar múltiplos modais sobrepostos
    setSelectedLancamento(null);
    // Abre o Dialog no próximo tick para o DropdownMenu fechar antes e evitar conflito de foco/overlay
    setTimeout(() => {
      const mov = lanc._movimentacaoOriginal!;
      setEditingLancamento(lanc);
      setTipoMovimentacao(mov.tipo as TipoTransferencia);
      
      // Preencher dados da movimentação
      const parsedDate = parseDateFromDB(mov.data);
      const normalizedData = parsedDate ? format(parsedDate, "yyyy-MM-dd") : getTodayLocalISODate();
      
      setMovimentacaoData({
        conta_origem_id: mov.conta_bancaria_id || "",
        conta_destino_id: mov.conta_bancaria_destino_id || "",
        estoque_origem_id: mov.estoque_origem_id?.toString() || "",
        estoque_destino_id: mov.estoque_destino_id?.toString() || "",
        valor: mov.valor?.toString() || "",
        data: normalizedData,
        historico: mov.historico || "",
      });
      
      setIsMovimentacaoDialogOpen(true);
    }, 0);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const displayedLancamentos = useMemo(() => {
    let base = [...lancamentos];
    const isMovimentacoesTab = abaLancamentos === "movimentacoes";
    const categoriaFiltroAtivo: CategoriaOperacionalFiltro = isMovimentacoesTab
      ? "movimentacao"
      : filters.categoriaOperacional;

    const term = filters.busca.trim().toLowerCase();
    if (term) {
      base = base.filter(
        (l) =>
          (l.historico || "").toLowerCase().includes(term) ||
          (l.documento || "").toLowerCase().includes(term) ||
          (l.observacoes || "").toLowerCase().includes(term)
      );
    }

    if (filters.documento.trim()) {
      const docTerm = filters.documento.trim().toLowerCase();
      base = base.filter((l) => (l.documento || "").toLowerCase().includes(docTerm));
    }

    const valorMin = filters.valorMin ? Number(filters.valorMin) : null;
    const valorMax = filters.valorMax ? Number(filters.valorMax) : null;

    if (valorMin !== null || valorMax !== null) {
      base = base.filter((l) => {
        const v = Number(l.valor);
        if (Number.isNaN(v)) return false;
        if (valorMin !== null && v < valorMin) return false;
        if (valorMax !== null && v > valorMax) return false;
        return true;
      });
    }

    if (isMovimentacoesTab && filters.contaId !== "todos") {
      base = base.filter((l) => {
        if (!l._isMovimentacao) return false;
        const contaOrigem = l._movimentacaoOriginal?.conta_bancaria_id || l.conta_bancaria_id;
        const contaDestino = l._movimentacaoOriginal?.conta_bancaria_destino_id || null;
        return contaOrigem === filters.contaId || contaDestino === filters.contaId;
      });
    }

    if (filters.tipo !== "todos" && categoriaFiltroAtivo === "todas") {
      base = base.filter((l) => l.tipo === filters.tipo);
    }

    if (categoriaFiltroAtivo !== "todas") {
      base = base.filter((l) => getCategoriaOperacional(l) === categoriaFiltroAtivo);
    }

    if (isMovimentacoesTab) {
      base = base.filter((l) => getCategoriaOperacional(l) === "movimentacao");
    } else {
      base = base.filter((l) => getCategoriaOperacional(l) !== "movimentacao");
    }

    return base;
  }, [
    lancamentos,
    abaLancamentos,
    filters.busca,
    filters.categoriaOperacional,
    filters.contaId,
    filters.documento,
    filters.tipo,
    filters.valorMin,
    filters.valorMax,
    getCategoriaOperacional,
  ]);

  const isGrouped = groupBy !== "none";

  const groupedLancamentos = useMemo(() => {
    if (!isGrouped) return {} as Record<
      string,
      { label: string; lancs: Lancamento[]; totais: { entradas: number; saidas: number; movimentado: number } }
    >;

    const groups: Record<
      string,
      { label: string; lancs: Lancamento[]; totais: { entradas: number; saidas: number; movimentado: number } }
    > = {};

    for (const lanc of displayedLancamentos) {
      let key = "";
      let label = "";

      if (groupBy === "conta") {
        key = lanc.conta_bancaria_id || "sem_conta";
        label = lanc.contas_bancarias?.descricao || "Sem conta bancária";
      } else if (groupBy === "grupo") {
        key = lanc.grupo_contas_id || "sem_grupo";
        label = lanc.grupos_contas?.nome || "Sem grupo de contas";
      } else if (groupBy === "tipo") {
        key = lanc.tipo;
        label = lanc.tipo === "entrada" ? "Entradas" : "Saídas";
      }

      if (!groups[key]) {
        groups[key] = {
          label,
          lancs: [],
          totais: { entradas: 0, saidas: 0, movimentado: 0 },
        };
      }

      groups[key].lancs.push(lanc);

      if (abaLancamentos === "movimentacoes") {
        groups[key].totais.movimentado += Number(lanc.valor);
      } else if (lanc.tipo === "entrada") {
        groups[key].totais.entradas += Number(lanc.valor);
      } else {
        groups[key].totais.saidas += Number(lanc.valor);
      }
    }

    return groups;
  }, [abaLancamentos, displayedLancamentos, groupBy, isGrouped]);

  const groupedLancamentoEntries = useMemo(
    () =>
      Object.entries(groupedLancamentos).sort(([, groupA], [, groupB]) =>
        groupA.label.localeCompare(groupB.label, "pt-BR", { sensitivity: "base" })
      ),
    [groupedLancamentos]
  );

  const paginatedLancamentos = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return displayedLancamentos.slice(start, start + PAGE_SIZE);
  }, [displayedLancamentos, currentPage]);

  const totalPages = Math.ceil(displayedLancamentos.length / PAGE_SIZE) || 1;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [displayedLancamentos.length, totalPages, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    filters.dataInicio,
    filters.dataFim,
    filters.tipo,
    filters.categoriaOperacional,
    filters.contaId,
    filters.fornecedorId,
    filters.busca,
    filters.valorMin,
    filters.valorMax,
    filters.documento,
    groupBy,
    abaLancamentos,
  ]);

  useEffect(() => {
    if (!selectedLancamento) return;
    const existsInCurrentList = displayedLancamentos.some((item) => item.id === selectedLancamento.id);
    if (!existsInCurrentList) {
      setSelectedLancamento(null);
      setIsAnexosDialogOpen(false);
    }
  }, [displayedLancamentos, selectedLancamento, abaLancamentos]);

  const totais = displayedLancamentos.reduce(
    (acc, lanc) => {
      if (abaLancamentos === "movimentacoes") {
        acc.movimentado += Number(lanc.valor);
        return acc;
      }
      if (lanc.tipo === "entrada") acc.entradas += Number(lanc.valor);
      else acc.saidas += Number(lanc.valor);
      return acc;
    },
    { entradas: 0, saidas: 0, movimentado: 0 }
  );

  const handleSubmitMovimentacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaId) {
      toast.error("Empresa não encontrada. Aguarde o carregamento ou faça login novamente.");
      return;
    }

    if (!isValidUUID(empresaId)) {
      toast.error("Erro: empresa_id inválido. Recarregue a página.");
      return;
    }

    if (editingLancamento?._isMovimentacao && isVerifiedLancamento(editingLancamento)) {
      toast.error("Movimentacao verificada nao pode ser editada. Desfaca a conciliacao antes.");
      return;
    }

    // Validações baseadas no tipo
    if (tipoMovimentacao === "conta_para_conta") {
      if (!movimentacaoData.conta_origem_id || !movimentacaoData.conta_destino_id) {
        toast.error("Selecione a conta de origem e destino");
        return;
      }
      if (movimentacaoData.conta_origem_id === movimentacaoData.conta_destino_id) {
        toast.error("A conta de origem e destino devem ser diferentes");
        return;
      }
    } else if (tipoMovimentacao === "conta_para_estoque") {
      if (!movimentacaoData.conta_origem_id || !movimentacaoData.estoque_destino_id) {
        toast.error("Selecione a conta de origem e o estoque de destino");
        return;
      }
    } else if (tipoMovimentacao === "estoque_para_conta") {
      if (!movimentacaoData.estoque_origem_id || !movimentacaoData.conta_destino_id) {
        toast.error("Selecione o estoque de origem e a conta de destino");
        return;
      }
    } else if (tipoMovimentacao === "estoque_para_estoque") {
      if (!movimentacaoData.estoque_origem_id || !movimentacaoData.estoque_destino_id) {
        toast.error("Selecione o estoque de origem e destino");
        return;
      }
      if (movimentacaoData.estoque_origem_id === movimentacaoData.estoque_destino_id) {
        toast.error("O estoque de origem e destino devem ser diferentes");
        return;
      }
    }

    if (!movimentacaoData.valor || parseFloat(movimentacaoData.valor) <= 0) {
      toast.error("Valor deve ser maior que zero");
      return;
    }

    try {
      const normalizedDate = normalizeDateForDB(movimentacaoData.data);
      
      if (!normalizedDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        toast.error("Formato de data inválido");
        return;
      }

      const origemId = tipoMovimentacao === "conta_para_conta" || tipoMovimentacao === "conta_para_estoque"
        ? movimentacaoData.conta_origem_id
        : parseInt(movimentacaoData.estoque_origem_id);
      
      const destinoId = tipoMovimentacao === "conta_para_conta" || tipoMovimentacao === "estoque_para_conta"
        ? movimentacaoData.conta_destino_id
        : parseInt(movimentacaoData.estoque_destino_id);

      // Se estiver editando uma movimentação
      if (editingLancamento?._isMovimentacao && editingLancamento._movimentacaoOriginal) {
        const movId = editingLancamento._movimentacaoOriginal.id;
        
        // Preparar dados de atualização
        const updateData: {
          id: number;
          valor?: number;
          data?: string;
          historico?: string;
          conta_bancaria_id?: string | null;
          estoque_origem_id?: number | null;
          estoque_destino_id?: number | null;
          conta_bancaria_destino_id?: string | null;
        } = {
          id: movId,
          valor: parseFloat(movimentacaoData.valor),
          data: normalizedDate,
          historico: movimentacaoData.historico || undefined,
        };
        
        // Adicionar IDs conforme o tipo
        if (tipoMovimentacao === "conta_para_conta") {
          updateData.conta_bancaria_id = movimentacaoData.conta_origem_id || null;
          updateData.conta_bancaria_destino_id = movimentacaoData.conta_destino_id || null;
        } else if (tipoMovimentacao === "conta_para_estoque") {
          updateData.conta_bancaria_id = movimentacaoData.conta_origem_id || null;
          updateData.estoque_destino_id = parseInt(movimentacaoData.estoque_destino_id) || null;
        } else if (tipoMovimentacao === "estoque_para_conta") {
          updateData.estoque_origem_id = parseInt(movimentacaoData.estoque_origem_id) || null;
          updateData.conta_bancaria_id = movimentacaoData.conta_destino_id || null;
        } else if (tipoMovimentacao === "estoque_para_estoque") {
          updateData.estoque_origem_id = parseInt(movimentacaoData.estoque_origem_id) || null;
          updateData.estoque_destino_id = parseInt(movimentacaoData.estoque_destino_id) || null;
        }
        
        await updateMovimentacao.mutateAsync(updateData);
      } else {
        // Criar nova movimentação
        await createTransferencia.mutateAsync({
          tipo: tipoMovimentacao,
          origem_id: origemId,
          destino_id: destinoId,
          valor: parseFloat(movimentacaoData.valor),
          data: normalizedDate,
          historico: movimentacaoData.historico || undefined,
        });
      }

      setIsMovimentacaoDialogOpen(false);
      setEditingLancamento(null);
      setTipoMovimentacao("conta_para_conta");
      setMovimentacaoData({
        conta_origem_id: "",
        conta_destino_id: "",
        estoque_origem_id: "",
        estoque_destino_id: "",
        valor: "",
        data: getTodayLocalISODate(),
        historico: "",
      });
      fetchLancamentos();
      queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
      queryClient.invalidateQueries({ queryKey: ["estoques-select", empresaId] });
      toast.success("Movimentação registrada com sucesso!");
    } catch (error: unknown) {
      toast.error(getConciliacaoLockErrorMessage(error, "Erro ao registrar movimentação"));
    }
  };

  const handleAbaChange = (value: string) => {
    const novaAba = value as LancamentosAba;
    setAbaLancamentos(novaAba);
    setFilters((f) => ({
      ...f,
      tipo: "todos",
      categoriaOperacional: novaAba === "movimentacoes" ? "movimentacao" : "todas",
    }));
  };

  const handleCategoriaOperacionalChange = (value: string) => {
    if (!value) return;
    setFilters((prev) => ({
      ...prev,
      categoriaOperacional: value as CategoriaOperacionalFiltro,
    }));
  };

  const openAnexosForLancamento = (lanc: Lancamento) => {
    setSelectedLancamento(lanc);
    if (lanc._isMovimentacao) {
      toast.info("Anexos disponíveis apenas para lançamentos de caixa.");
      return;
    }
    setIsAnexosDialogOpen(true);
  };

  const handleUploadAnexoFile = async (file: File | null) => {
    if (!file) return;
    await uploadAnexoMutation.mutateAsync({ file });
  };

  const handleOpenAnexo = async (anexo: LancamentoAnexo) => {
    const signedUrl = await openAnexoMutation.mutateAsync(anexo);
    if (typeof window !== "undefined") {
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleGoToConciliacao = (lanc: Lancamento) => {
    const params = new URLSearchParams();
    if (lanc.conta_bancaria_id) params.set("conta", lanc.conta_bancaria_id);
    if (lanc.data) params.set("data", lanc.data);

    const itemCode = getItemFinanceiroCode(lanc);
    if (itemCode) params.set("item", itemCode);

    const origemKey = getLancamentoOrigemKey(lanc);
    if (origemKey) params.set("origem_key", origemKey);

    const query = params.toString();
    navigate(`/financeiro/conciliacao-bancaria${query ? `?${query}` : ""}`);
  };

  const handleGoToContasFixas = (lanc: Lancamento) => {
    const origem = getOrigemLancamento(lanc);
    const params = new URLSearchParams();
    params.set("from", "lancamentos");
    params.set("lancamentoId", lanc.id);
    if (origem.tipo === "previsto_pago") {
      params.set("origem", origem.tipo);
      if (origem.referencia) params.set("referencia", origem.referencia);
    }
    navigate(`/financeiro/contas-fixas?${params.toString()}`);
  };

  const handleGoToOperacoes = (lanc: Lancamento) => {
    const origem = getOrigemLancamento(lanc);
    const params = new URLSearchParams();
    params.set("from", "lancamentos");
    params.set("lancamentoId", lanc.id);
    params.set("origem", origem.tipo);
    if (origem.referencia) params.set("referencia", origem.referencia);
    navigate(`/operacoes?${params.toString()}`);
  };

  const formatFileSize = (sizeBytes: number | null): string => {
    if (!sizeBytes || sizeBytes <= 0) return "—";
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderLancamentoDetails = (lanc: Lancamento) => {
    const itemFinanceiroCode = getItemFinanceiroCode(lanc);
    const origem = getOrigemLancamento(lanc);
    const categoriaOperacional = getCategoriaOperacional(lanc);

    return (
      <LancamentoDetailsPanel
        lancamento={{
          id: lanc.id,
          data: lanc.data,
          tipo: lanc.tipo,
          valor: Number(lanc.valor),
          historico: lanc.historico,
          documento: lanc.documento,
          observacoes: lanc.observacoes,
          contaDescricao: lanc.contas_bancarias?.descricao || null,
          grupoNome: lanc.grupos_contas?.nome || null,
        }}
        itemFinanceiroCode={itemFinanceiroCode}
        origemLabel={origem.label}
        origemReferencia={origem.referencia || null}
        categoriaLabel={getCategoriaOperacionalLabel(categoriaOperacional)}
        verificationStatus={getVerificationStatus(lanc)}
        hasAiProvenance={hasAiConciliationProvenance(lanc)}
        isVerified={isVerifiedLancamento(lanc)}
        isMovimentacao={Boolean(lanc._isMovimentacao)}
        formatCurrency={formatCurrency}
        onCopyLancamentoCode={(code) => void copyCodeToClipboard(code, "Código do lançamento")}
        onCopyItemCode={(code) => void copyCodeToClipboard(code, "Código de conciliação")}
        onEditar={() => handleEditLancamento(lanc)}
        onDuplicar={() => handleDuplicateLancamento(lanc)}
        onAnexos={() => openAnexosForLancamento(lanc)}
        onConciliacao={() => handleGoToConciliacao(lanc)}
        onContasFixas={() => handleGoToContasFixas(lanc)}
        onOperacoes={() => handleGoToOperacoes(lanc)}
      />
    );
  };

  const detailsSheetContentClassName = isBelowLg
    ? "w-[92vw] sm:max-w-lg p-0 overflow-y-auto"
    : "w-[702px] max-w-[calc(100vw-24px)] p-0 overflow-y-auto";
  const detailsSheetBodyClassName = isBelowLg ? "px-4 pt-10 pb-6" : "px-10 pt-5 pb-8";

  const conteudoAba = (
    <div className="space-y-6">
          <div className="rounded-md border border-border/60 bg-card p-2">
            <ToggleGroup
              type="single"
              value={abaLancamentos === "movimentacoes" ? "movimentacao" : filters.categoriaOperacional}
              onValueChange={handleCategoriaOperacionalChange}
              className="flex w-full flex-wrap justify-start gap-2"
            >
              {(abaLancamentos === "movimentacoes" ? CATEGORIAS_MOVIMENTACOES : CATEGORIAS_LANCAMENTOS).map(
                (categoria) => (
                  <ToggleGroupItem
                    key={categoria.value}
                    value={categoria.value}
                    className="h-8 rounded-md px-3 text-xs"
                  >
                    {categoria.label}
                  </ToggleGroupItem>
                )
              )}
            </ToggleGroup>
          </div>
          {/* Barra de filtros inline */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por histórico, documento ou observações"
                value={filters.busca}
                onChange={(e) => setFilters({ ...filters, busca: e.target.value })}
                className="pl-10"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <Calendar className="mr-2 h-4 w-4" />
                  {filters.dataInicio && filters.dataFim
                    ? `${format(new Date(filters.dataInicio + "T12:00:00"), "dd/MM/yyyy")} - ${format(new Date(filters.dataFim + "T12:00:00"), "dd/MM/yyyy")}`
                    : "Selecione o período"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="start">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const hoje = new Date();
                        const iso = toLocalISODate(hoje);
                        setFilters((f) => ({ ...f, dataInicio: iso, dataFim: iso }));
                      }}
                    >
                      Hoje
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() - 1);
                        const iso = toLocalISODate(d);
                        setFilters((f) => ({ ...f, dataInicio: iso, dataFim: iso }));
                      }}
                    >
                      Ontem
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const hoje = new Date();
                        const fim = toLocalISODate(hoje);
                        const inicioDate = new Date(hoje);
                        inicioDate.setDate(inicioDate.getDate() - 6);
                        const inicio = toLocalISODate(inicioDate);
                        setFilters((f) => ({ ...f, dataInicio: inicio, dataFim: fim }));
                      }}
                    >
                      Últimos 7 dias
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const hoje = new Date();
                        const fim = toLocalISODate(hoje);
                        const inicioDate = new Date(hoje);
                        inicioDate.setDate(inicioDate.getDate() - 29);
                        const inicio = toLocalISODate(inicioDate);
                        setFilters((f) => ({ ...f, dataInicio: inicio, dataFim: fim }));
                      }}
                    >
                      Últimos 30 dias
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const hoje = new Date();
                        const inicioDate = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
                        const inicio = toLocalISODate(inicioDate);
                        const fim = toLocalISODate(hoje);
                        setFilters((f) => ({ ...f, dataInicio: inicio, dataFim: fim }));
                      }}
                    >
                      Este mês
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const hoje = new Date();
                        const inicioDate = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
                        const fimDate = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
                        const inicio = toLocalISODate(inicioDate);
                        const fim = toLocalISODate(fimDate);
                        setFilters((f) => ({ ...f, dataInicio: inicio, dataFim: fim }));
                      }}
                    >
                      Mês anterior
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Data Início</Label>
                      <Input
                        type="date"
                        value={filters.dataInicio}
                        onChange={(e) => setFilters({ ...filters, dataInicio: e.target.value })}
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>Data Fim</Label>
                      <Input
                        type="date"
                        value={filters.dataFim}
                        onChange={(e) => setFilters({ ...filters, dataFim: e.target.value })}
                        className="mt-2"
                      />
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Select
              value={filters.tipo}
              onValueChange={(v) => setFilters({ ...filters, tipo: normalizeLegacyTipoFilter(v) })}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="entrada">Entradas</SelectItem>
                <SelectItem value="saida">Saídas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.contaId} onValueChange={(v) => setFilters({ ...filters, contaId: v })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todas as contas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as contas</SelectItem>
                {contasBancarias.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.fornecedorId} onValueChange={(v) => setFilters({ ...filters, fornecedorId: v })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todas as tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as tags</SelectItem>
                {(() => {
                  const gruposImob = gruposContas.filter(g => g.natureza === "escrito_imob").sort((a, b) => a.nome.localeCompare(b.nome));
                  const gruposAplic = gruposContas.filter(g => g.natureza === "aplic").sort((a, b) => a.nome.localeCompare(b.nome));
                  const gruposEntrada = gruposContas.filter(g => g.natureza === "entrada").sort((a, b) => a.nome.localeCompare(b.nome));
                  const gruposSaida = gruposContas.filter(g => g.natureza === "saida").sort((a, b) => a.nome.localeCompare(b.nome));
                  return (
                    <>
                      {gruposImob.length > 0 && <><SelectGroup><SelectLabel>Imob</SelectLabel>{gruposImob.map((g) => <SelectItem key={g.id} value={g.id.toString()}>{g.nome}</SelectItem>)}</SelectGroup><SelectSeparator /></>}
                      {gruposAplic.length > 0 && <><SelectGroup><SelectLabel>Aplic</SelectLabel>{gruposAplic.map((g) => <SelectItem key={g.id} value={g.id.toString()}>{g.nome}</SelectItem>)}</SelectGroup><SelectSeparator /></>}
                      {gruposEntrada.length > 0 && <><SelectGroup><SelectLabel>Entradas</SelectLabel>{gruposEntrada.map((g) => <SelectItem key={g.id} value={g.id.toString()}>{g.nome}</SelectItem>)}</SelectGroup><SelectSeparator /></>}
                      {gruposSaida.length > 0 && <SelectGroup><SelectLabel>Saídas</SelectLabel>{gruposSaida.map((g) => <SelectItem key={g.id} value={g.id.toString()}>{g.nome}</SelectItem>)}</SelectGroup>}
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <div className="w-32">
                <Label className="sr-only">Valor mín.</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Valor mín."
                  value={filters.valorMin}
                  onChange={(e) => setFilters({ ...filters, valorMin: e.target.value })}
                />
              </div>
              <div className="w-32">
                <Label className="sr-only">Valor máx.</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Valor máx."
                  value={filters.valorMax}
                  onChange={(e) => setFilters({ ...filters, valorMax: e.target.value })}
                />
              </div>
              <div className="w-40">
                <Label className="sr-only">Documento</Label>
                <Input
                  type="text"
                  placeholder="Filtrar por doc."
                  value={filters.documento}
                  onChange={(e) => setFilters({ ...filters, documento: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Agrupar por</Label>
              <Select
                value={groupBy}
                onValueChange={(v) => {
                  const value = v as GroupByOption;
                  setGroupBy(value);
                  setExpandedGroups({});
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Sem agrupamento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  <SelectItem value="conta">Conta bancária</SelectItem>
                  <SelectItem value="grupo">Grupo de contas</SelectItem>
                  <SelectItem value="tipo">Tipo (Entrada/Saída)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tabela */}
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <div className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Histórico</TableHead>
                      <TableHead>Conta</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Tag</TableHead>
                      <TableHead>Recorrência</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Conciliação</TableHead>
                      <TableHead>Código do lançamento</TableHead>
                      <TableHead>Código de conciliação</TableHead>
                      <TableHead className="text-right min-w-[120px]">Valor</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lancamentosError ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-destructive py-8">
                          {lancamentosError}
                        </TableCell>
                      </TableRow>
                    ) : isLancamentosLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={`skeleton-${i}`}>
                          <TableCell>
                            <Skeleton className="h-5 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-full max-w-[200px]" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-28" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-28" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-28" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-24 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-8 w-20" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : displayedLancamentos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-muted-foreground">
                          Nenhum lançamento encontrado para os filtros selecionados.
                        </TableCell>
                      </TableRow>
                    ) : !isGrouped ? (
                      paginatedLancamentos.map((lanc) => (
                        <TableRow
                          key={lanc.id}
                          className={`cursor-pointer hover:bg-muted/30 ${
                            selectedLancamento?.id === lanc.id ? "bg-muted/50" : ""
                          }`}
                          onClick={() => setSelectedLancamento(lanc)}
                        >
                          <TableCell className="min-w-0">
                            {parseDateFromDB(lanc.data)
                              ? parseDateFromDB(lanc.data)!.toLocaleDateString("pt-BR")
                              : "-"}
                          </TableCell>
                          <TableCell className="min-w-0">
                            <span className="font-medium">{lanc.historico}</span>
                          </TableCell>
                          <TableCell className="min-w-0">
                            {lanc.contas_bancarias?.descricao || "-"}
                          </TableCell>
                          <TableCell className="min-w-0">
                            {lanc.grupos_contas?.nome || "-"}
                          </TableCell>
                          <TableCell className="min-w-0">-</TableCell>
                          <TableCell className="min-w-0">-</TableCell>
                          <TableCell className="min-w-0">{getCategoriaBadge(lanc)}</TableCell>
                          <TableCell className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <VerificationStatusBadge
                                status={getVerificationStatus(lanc)}
                                labelMode="operational"
                              />
                              {hasAiConciliationProvenance(lanc) ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] uppercase tracking-wide"
                                >
                                  IA
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="flex items-center gap-1">
                              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                {String(lanc.id || "—")}
                              </code>
                              {lanc.id ? (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void copyCodeToClipboard(String(lanc.id), "Código do lançamento");
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="flex items-center gap-1">
                              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                {getItemFinanceiroCode(lanc) || "—"}
                              </code>
                              {getItemFinanceiroCode(lanc) ? (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void copyCodeToClipboard(String(getItemFinanceiroCode(lanc)), "Código de conciliação");
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium min-w-[120px] whitespace-nowrap ${
                              getCategoriaOperacional(lanc) === "movimentacao"
                                ? "text-muted-foreground"
                                : lanc.tipo === "entrada"
                                ? "text-success"
                                : "text-destructive"
                            }`}
                          >
                            {formatCurrency(Number(lanc.valor))}
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                title="Anexos"
                                aria-label="Anexos"
                                disabled={Boolean(lanc._isMovimentacao)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAnexosForLancamento(lanc);
                                }}
                              >
                                <Paperclip className="h-4 w-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label="Ações"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                  >
                                    <Ellipsis className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {lanc._isMovimentacao ? (
                                    <>
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          handleEditMovimentacao(lanc);
                                        }}
                                        disabled={isVerifiedLancamento(lanc)}
                                      >
                                        Editar movimentação
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        disabled={isVerifiedLancamento(lanc)}
                                        onSelect={() => {
                                          if (isVerifiedLancamento(lanc)) {
                                            toast.error(
                                              "Movimentacao verificada nao pode ser excluida."
                                            );
                                            return;
                                          }
                                          setSelectedLancamento(null);
                                          setTimeout(() => {
                                            setLancamentoToDelete(lanc);
                                            setIsDeleteDialogOpen(true);
                                          }, 10);
                                        }}
                                      >
                                        Excluir
                                      </DropdownMenuItem>
                                    </>
                                  ) : (
                                    <>
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          handleEditLancamento(lanc);
                                        }}
                                        disabled={isVerifiedLancamento(lanc)}
                                      >
                                        Editar lançamento
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          handleDuplicateLancamento(lanc);
                                        }}
                                      >
                                        Duplicar lançamento
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        disabled={isVerifiedLancamento(lanc)}
                                        onSelect={() => {
                                          if (isVerifiedLancamento(lanc)) {
                                            toast.error(
                                              "Lancamento verificado nao pode ser excluido."
                                            );
                                            return;
                                          }
                                          setSelectedLancamento(null);
                                          setTimeout(() => {
                                            setLancamentoToDelete(lanc);
                                            setIsDeleteDialogOpen(true);
                                          }, 10);
                                        }}
                                      >
                                        Excluir
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
	                      groupedLancamentoEntries.map(([key, group]) => {
	                        const expanded = expandedGroups[key] ?? true;
	                        const saldoGrupo = group.totais.entradas - group.totais.saidas;
	                        return (
                          <React.Fragment key={key}>
                            <TableRow className="bg-muted/40">
                              <TableCell colSpan={12} className="py-2">
                                <div className="flex items-center justify-between gap-4">
                                  <button
                                    type="button"
                                    className="flex items-center gap-2 text-sm font-semibold"
                                    onClick={() =>
                                      setExpandedGroups((prev) => ({
                                        ...prev,
                                        [key]: !(prev[key] ?? true),
                                      }))
                                    }
                                  >
                                    <span>{expanded ? "▾" : "▸"}</span>
                                    <span>{group.label}</span>
                                  </button>
	                                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
	                                    {abaLancamentos === "movimentacoes" ? (
	                                      <span>
	                                        Total movimentado:{" "}
	                                        <span className="font-semibold text-foreground">
	                                          {formatCurrency(group.totais.movimentado)}
	                                        </span>
	                                      </span>
	                                    ) : (
	                                      <>
	                                        <span>
	                                          Entradas:{" "}
	                                          <span className="font-semibold text-foreground">
	                                            {formatCurrency(group.totais.entradas)}
	                                          </span>
	                                        </span>
	                                        <span>
	                                          Saídas:{" "}
	                                          <span className="font-semibold text-foreground">
	                                            {formatCurrency(group.totais.saidas)}
	                                          </span>
	                                        </span>
	                                        <span>
	                                          Saldo:{" "}
	                                          <span
	                                            className={`font-semibold ${
	                                              saldoGrupo >= 0 ? "text-primary" : "text-destructive"
	                                            }`}
	                                          >
	                                            {formatCurrency(saldoGrupo)}
	                                          </span>
	                                        </span>
	                                      </>
	                                    )}
	                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                            {expanded &&
                              group.lancs.map((lanc) => (
                                <TableRow
                                  key={lanc.id}
                                  className={`cursor-pointer hover:bg-muted/30 ${
                                    selectedLancamento?.id === lanc.id ? "bg-muted/50" : ""
                                  }`}
                                  onClick={() => setSelectedLancamento(lanc)}
                                >
                                  <TableCell className="min-w-0">
                                    {parseDateFromDB(lanc.data)
                                      ? parseDateFromDB(lanc.data)!.toLocaleDateString("pt-BR")
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="min-w-0">
                                    <span className="font-medium">{lanc.historico}</span>
                                  </TableCell>
                                  <TableCell className="min-w-0">
                                    {lanc.contas_bancarias?.descricao || "-"}
                                  </TableCell>
                                  <TableCell className="min-w-0">
                                    {lanc.grupos_contas?.nome || "-"}
                                  </TableCell>
                                  <TableCell className="min-w-0">-</TableCell>
                                  <TableCell className="min-w-0">-</TableCell>
                                  <TableCell className="min-w-0">{getCategoriaBadge(lanc)}</TableCell>
                                  <TableCell className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1">
                                      <VerificationStatusBadge
                                        status={getVerificationStatus(lanc)}
                                        labelMode="operational"
                                      />
                                      {hasAiConciliationProvenance(lanc) ? (
                                        <Badge
                                          variant="secondary"
                                          className="text-[10px] uppercase tracking-wide"
                                        >
                                          IA
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="min-w-0">
                                    <div className="flex items-center gap-1">
                                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                        {String(lanc.id || "—")}
                                      </code>
                                      {lanc.id ? (
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void copyCodeToClipboard(String(lanc.id), "Código do lançamento");
                                          }}
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="min-w-0">
                                    <div className="flex items-center gap-1">
                                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                        {getItemFinanceiroCode(lanc) || "—"}
                                      </code>
                                      {getItemFinanceiroCode(lanc) ? (
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void copyCodeToClipboard(String(getItemFinanceiroCode(lanc)), "Código de conciliação");
                                          }}
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell
                                    className={`text-right font-medium min-w-[120px] whitespace-nowrap ${
                                      getCategoriaOperacional(lanc) === "movimentacao"
                                        ? "text-muted-foreground"
                                        : lanc.tipo === "entrada"
                                        ? "text-success"
                                        : "text-destructive"
                                    }`}
                                  >
                                    {formatCurrency(Number(lanc.valor))}
                                  </TableCell>
                                  <TableCell className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        title="Anexos"
                                        aria-label="Anexos"
                                        disabled={Boolean(lanc._isMovimentacao)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openAnexosForLancamento(lanc);
                                        }}
                                      >
                                        <Paperclip className="h-4 w-4" />
                                      </Button>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8"
                                            aria-label="Ações"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                            }}
                                          >
                                            <Ellipsis className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          {lanc._isMovimentacao ? (
                                            <>
                                              <DropdownMenuItem
                                                onSelect={() => {
                                                  handleEditMovimentacao(lanc);
                                                }}
                                                disabled={isVerifiedLancamento(lanc)}
                                              >
                                                Editar movimentação
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                disabled={isVerifiedLancamento(lanc)}
                                                onSelect={() => {
                                                  if (isVerifiedLancamento(lanc)) {
                                                    toast.error(
                                                      "Movimentacao verificada nao pode ser excluida."
                                                    );
                                                    return;
                                                  }
                                                  setSelectedLancamento(null);
                                                  setTimeout(() => {
                                                    setLancamentoToDelete(lanc);
                                                    setIsDeleteDialogOpen(true);
                                                  }, 10);
                                                }}
                                              >
                                                Excluir
                                              </DropdownMenuItem>
                                            </>
                                          ) : (
                                            <>
                                              <DropdownMenuItem
                                                onSelect={() => {
                                                  handleEditLancamento(lanc);
                                                }}
                                                disabled={isVerifiedLancamento(lanc)}
                                              >
                                                Editar lançamento
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                onSelect={() => {
                                                  handleDuplicateLancamento(lanc);
                                                }}
                                              >
                                                Duplicar lançamento
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                disabled={isVerifiedLancamento(lanc)}
                                                onSelect={() => {
                                                  if (isVerifiedLancamento(lanc)) {
                                                    toast.error(
                                                      "Lancamento verificado nao pode ser excluido."
                                                    );
                                                    return;
                                                  }
                                                  setSelectedLancamento(null);
                                                  setTimeout(() => {
                                                    setLancamentoToDelete(lanc);
                                                    setIsDeleteDialogOpen(true);
                                                  }, 10);
                                                }}
                                              >
                                                Excluir
                                              </DropdownMenuItem>
                                            </>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                          </React.Fragment>
                        );
                      })
                    )}
              </TableBody>
	              <TableFooter className="bg-muted/30">
	                <TableRow>
	                  <TableCell colSpan={12} className="p-0">
	                    {abaLancamentos === "movimentacoes" ? (
	                      <div className="flex items-center gap-6 py-4 px-4 bg-muted/30 justify-end border-t border-border">
	                        <div className="flex flex-col items-end">
	                          <span className="text-xs font-medium text-muted-foreground mb-1.5">
	                            Total movimentado
	                          </span>
	                          <span className="text-sm font-semibold">
	                            {formatCurrency(totais.movimentado)}
	                          </span>
	                        </div>
	                      </div>
	                    ) : (
	                      <div className="flex items-center gap-6 py-4 px-4 bg-muted/30 justify-end border-t border-border">
	                        <div className="flex flex-col items-end pr-6 border-r border-border">
	                          <span className="text-xs font-medium text-muted-foreground mb-1.5">
	                            Total de Entradas
	                          </span>
	                          <span className="text-sm font-semibold">
	                            {formatCurrency(totais.entradas)}
	                          </span>
	                        </div>
	                        <div className="flex flex-col items-end pr-6 border-r border-border">
	                          <span className="text-xs font-medium text-muted-foreground mb-1.5">
	                            Total de Saídas
	                          </span>
	                          <span className="text-sm font-semibold">
	                            {formatCurrency(totais.saidas)}
	                          </span>
	                        </div>
	                        <div className="flex flex-col items-end">
	                          <span className="text-xs font-medium text-muted-foreground mb-1.5">
	                            Saldo
	                          </span>
	                          <span
	                            className={`font-bold text-base ${
	                              totais.entradas - totais.saidas >= 0
	                                ? "text-primary"
	                                : "text-destructive"
	                            }`}
	                          >
	                            {formatCurrency(totais.entradas - totais.saidas)}
	                          </span>
	                        </div>
	                      </div>
	                    )}
	                  </TableCell>
	                </TableRow>
	              </TableFooter>
            </Table>
          </div>

          {/* Paginação */}
          {!isGrouped && (
            <div className="flex items-center justify-between px-2 py-4">
              <div className="text-sm text-muted-foreground">
                Mostrando {displayedLancamentos.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1} a{" "}
                {Math.min(currentPage * PAGE_SIZE, displayedLancamentos.length)} de {displayedLancamentos.length}
              </div>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage > 1) setCurrentPage((p) => p - 1);
                      }}
                      className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      aria-disabled={currentPage <= 1}
                    />
                  </PaginationItem>
                  {totalPages <= 7 ? (
                    Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          href="#"
                          isActive={currentPage === page}
                          onClick={(e) => {
                            e.preventDefault();
                            setCurrentPage(page);
                          }}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))
                  ) : (
                    <>
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          isActive={currentPage === 1}
                          onClick={(e) => {
                            e.preventDefault();
                            setCurrentPage(1);
                          }}
                          className="cursor-pointer"
                        >
                          1
                        </PaginationLink>
                      </PaginationItem>
                      {currentPage > 3 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                      {[currentPage - 1, currentPage, currentPage + 1]
                        .filter((p) => p > 1 && p < totalPages)
                        .map((page) => (
                          <PaginationItem key={page}>
                            <PaginationLink
                              href="#"
                              isActive={currentPage === page}
                              onClick={(e) => {
                                e.preventDefault();
                                setCurrentPage(page);
                              }}
                              className="cursor-pointer"
                            >
                              {page}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                      {currentPage < totalPages - 2 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                      {totalPages > 1 && (
                        <PaginationItem>
                          <PaginationLink
                            href="#"
                            isActive={currentPage === totalPages}
                            onClick={(e) => {
                              e.preventDefault();
                              setCurrentPage(totalPages);
                            }}
                            className="cursor-pointer"
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      )}
                    </>
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage < totalPages) setCurrentPage((p) => p + 1);
                      }}
                      className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      aria-disabled={currentPage >= totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>

      </div>

      <Sheet open={Boolean(selectedLancamento)} onOpenChange={(open) => !open && setSelectedLancamento(null)}>
        <SheetContent
          side="right"
          overlayClassName="bg-black/45"
          className={detailsSheetContentClassName}
          title="Detalhes do lançamento"
          description="Visualize os dados completos do lançamento selecionado."
        >
          {selectedLancamento ? (
            <div className={detailsSheetBodyClassName}>{renderLancamentoDetails(selectedLancamento)}</div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Lançamentos</h1>
            <p className="text-muted-foreground">Controle completo de entradas, saídas e movimentações financeiras</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="default" className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Lançamentos
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => {
                    openLancamentoDialog("entrada");
                  }}
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Nova Entrada
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setTimeout(() => {
                      setLancamentoParaDevolucao({
                        data: getTodayLocalISODate(),
                        valor: "",
                        historico: "",
                        documento: "",
                      });
                      setIsDevolucaoDialogOpen(true);
                    }, 10);
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Devolução
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    openLancamentoDialog("saida");
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <TrendingDown className="mr-2 h-4 w-4" />
                  Nova Saída
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Ações
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => {
                    setTimeout(() => setIsMovimentacaoDialogOpen(true), 10);
                  }}
                >
                  <ArrowLeftRight className="mr-2 h-4 w-4" />
                  Nova Movimentação
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setTimeout(() => setIsTransferirDevolucoesOpen(true), 10);
                  }}
                  disabled={!empresaId || contasBancarias.length === 0}
                >
                  <ArrowLeftRight className="mr-2 h-4 w-4" />
                  Transferir Devoluções
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    navigate("/financeiro/conciliacao-bancaria");
                  }}
                >
                  Conciliação Bancária
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              resetForm();
              // Forçar limpeza de estilos residuais do body que o Radix pode deixar ao fechar no X
              requestAnimationFrame(() => {
                document.body.style.pointerEvents = "";
                document.body.style.overflow = "";
              });
            }
          }}>
            <DialogContent
              className="max-w-2xl"
            >
              <DialogHeader>
                <DialogTitle>{editingLancamento ? "Editar Lançamento" : "Novo Lançamento"}</DialogTitle>
                <DialogDescription>{editingLancamento ? "Altere os dados do lançamento selecionado" : "Registre uma entrada ou saída"}</DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                {editingLancamento ? (
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Código do lançamento</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="rounded bg-background px-2 py-1 text-xs">{String(editingLancamento.id || "—")}</code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => void copyCodeToClipboard(String(editingLancamento.id || ""), "Código do lançamento")}
                            disabled={!editingLancamento.id}
                          >
                            <Copy className="mr-1 h-3 w-3" />
                            Copiar
                          </Button>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Código de conciliação (item financeiro)</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="rounded bg-background px-2 py-1 text-xs">
                            {getItemFinanceiroCode(editingLancamento) || "—"}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => void copyCodeToClipboard(String(getItemFinanceiroCode(editingLancamento) || ""), "Código de conciliação")}
                            disabled={!getItemFinanceiroCode(editingLancamento)}
                          >
                            <Copy className="mr-1 h-3 w-3" />
                            Copiar
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-4">
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
                    <Label htmlFor="tipo">Tipo *</Label>
                    <Select value={formData.tipo} onValueChange={(value: "entrada" | "saida") => setFormData({ ...formData, tipo: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        <SelectItem value="entrada">Entrada</SelectItem>
                        <SelectItem value="saida">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="valor">Valor *</Label>
                    <Input
                      id="valor"
                      type="number"
                      step="0.01"
                      value={formData.valor}
                      onChange={(e) => setFormData({ ...formData, valor: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="documento">Documento</Label>
                    <Input
                      id="documento"
                      value={formData.documento}
                      onChange={(e) => setFormData({ ...formData, documento: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor="conta">Conta Bancária (Opcional)</Label>
                    <Select value={formData.conta_bancaria_id || undefined} onValueChange={(value) => setFormData({ ...formData, conta_bancaria_id: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma conta..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {contasBancarias.map((conta) => (
                          <SelectItem key={conta.id} value={conta.id.toString()}>
                            {conta.descricao}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="grupo">Grupo de Contas (Opcional)</Label>
                    <Select value={formData.grupo_contas_id || undefined} onValueChange={(value) => setFormData({ ...formData, grupo_contas_id: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um grupo..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {gruposContas
                          .filter((g) => {
                            // Para entradas, incluir grupos de entrada, escrito_imob e aplic
                            if (formData.tipo === "entrada") {
                              return g.natureza === "entrada" || g.natureza === "escrito_imob" || g.natureza === "aplic";
                            }
                            // Para saídas, apenas grupos de saída
                            return g.natureza === "saida";
                          })
                          .map((grupo) => (
                            <SelectItem key={grupo.id} value={grupo.id.toString()}>
                              {grupo.nome}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="historico">Histórico *</Label>
                    <Textarea
                      id="historico"
                      value={formData.historico}
                      onChange={(e) => setFormData({ ...formData, historico: e.target.value })}
                      required
                      rows={3}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set("fromLanc", "1");
                      if (formData.valor) params.set("valor", formData.valor);
                      if (formData.historico) params.set("historico", formData.historico);
                      navigate(`/financeiro/contas-fixas?${params.toString()}`);
                    }}
                  >
                    Criar como conta fixa
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">Salvar</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={abaLancamentos} onValueChange={handleAbaChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="lancamentos">Lançamentos Caixa</TabsTrigger>
            <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>
          </TabsList>

          <TabsContent value="lancamentos" className="mt-6">
            {conteudoAba}
          </TabsContent>
          <TabsContent value="movimentacoes" className="mt-6">
            {conteudoAba}
          </TabsContent>
        </Tabs>

        <Dialog
          open={isAnexosDialogOpen}
          onOpenChange={(open) => {
            setIsAnexosDialogOpen(open);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Anexos do lançamento</DialogTitle>
              <DialogDescription>
                Upload e gestão de comprovantes do lançamento selecionado.
              </DialogDescription>
            </DialogHeader>

            {!selectedLancamentoIdForAnexo ? (
              <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
                Selecione um lançamento de caixa para gerenciar anexos.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Enviar novo comprovante</p>
                  <Input
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    disabled={uploadAnexoMutation.isPending}
                    onChange={async (event) => {
                      const file = event.target.files?.[0] || null;
                      await handleUploadAnexoFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>

                <div className="rounded-md border border-border/60">
                  <div className="border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                    Arquivos anexados
                  </div>
                  <div className="divide-y divide-border/60">
                    {anexosQuery.isLoading ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">Carregando anexos...</div>
                    ) : (anexosQuery.data || []).length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">Nenhum anexo encontrado.</div>
                    ) : (
                      (anexosQuery.data || []).map((anexo) => (
                        <div key={anexo.id} className="px-3 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{anexo.nome_arquivo}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(anexo.tamanho_bytes)} • {new Date(anexo.created_at).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleOpenAnexo(anexo)}
                              disabled={openAnexoMutation.isPending}
                            >
                              Abrir
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => removeAnexoMutation.mutate(anexo)}
                              disabled={removeAnexoMutation.isPending}
                            >
                              Excluir
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir lançamento</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Confirme se deseja remover o lançamento selecionado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setLancamentoToDelete(null);
                }}
              >
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteLancamento}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={isMovimentacaoDialogOpen} onOpenChange={(open) => {
          setIsMovimentacaoDialogOpen(open);
          if (!open) {
            setEditingLancamento(null);
            setTipoMovimentacao("conta_para_conta");
              setMovimentacaoData({
                conta_origem_id: "",
                conta_destino_id: "",
                estoque_origem_id: "",
                estoque_destino_id: "",
                valor: "",
                data: getTodayLocalISODate(),
                historico: "",
              });
            
            // Forçar limpeza de estilos residuais do body ao fechar movimentação
            requestAnimationFrame(() => {
              document.body.style.pointerEvents = "";
              document.body.style.overflow = "";
            });
          }
        }}>
          <DialogContent
            className="max-w-2xl"
          >
            <DialogHeader>
              <DialogTitle>{editingLancamento?._isMovimentacao ? "Editar Movimentação" : "Nova Movimentação"}</DialogTitle>
              <DialogDescription>
                {editingLancamento?._isMovimentacao 
                  ? "Edite os dados da movimentação de valores entre contas e/ou estoques"
                  : "Registre uma movimentação de valores entre contas e/ou estoques"}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmitMovimentacao} className="space-y-4">
              <Tabs value={tipoMovimentacao} onValueChange={(v) => {
                if (!editingLancamento?._isMovimentacao) {
                  setTipoMovimentacao(v as TipoTransferencia);
                }
              }}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="conta_para_conta">Conta → Conta</TabsTrigger>
                  <TabsTrigger value="conta_para_estoque">Conta → Estoque</TabsTrigger>
                  <TabsTrigger value="estoque_para_conta">Estoque → Conta</TabsTrigger>
                  <TabsTrigger value="estoque_para_estoque">Estoque → Estoque</TabsTrigger>
                </TabsList>

                <TabsContent value="conta_para_conta" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="conta-origem-cc">Conta de Origem *</Label>
                      <Select 
                        value={movimentacaoData.conta_origem_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, conta_origem_id: value })}
                        required
                      >
                        <SelectTrigger id="conta-origem-cc">
                          <SelectValue placeholder="Selecione a conta de origem..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {contasBancarias.map((conta) => (
                            <SelectItem key={conta.id} value={conta.id.toString()}>
                              {conta.descricao}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="conta-destino-cc">Conta de Destino *</Label>
                      <Select 
                        value={movimentacaoData.conta_destino_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, conta_destino_id: value })}
                        required
                      >
                        <SelectTrigger id="conta-destino-cc">
                          <SelectValue placeholder="Selecione a conta de destino..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {contasBancarias
                            .filter((conta) => conta.id.toString() !== movimentacaoData.conta_origem_id)
                            .map((conta) => (
                              <SelectItem key={conta.id} value={conta.id.toString()}>
                                {conta.descricao}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="conta_para_estoque" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="conta-origem-ce">Conta de Origem *</Label>
                      <Select 
                        value={movimentacaoData.conta_origem_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, conta_origem_id: value })}
                        required
                      >
                        <SelectTrigger id="conta-origem-ce">
                          <SelectValue placeholder="Selecione a conta de origem..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {contasBancarias.map((conta) => (
                            <SelectItem key={conta.id} value={conta.id.toString()}>
                              {conta.descricao}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="estoque-destino-ce">Estoque de Destino *</Label>
                      <Select 
                        value={movimentacaoData.estoque_destino_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, estoque_destino_id: value })}
                        required
                      >
                        <SelectTrigger id="estoque-destino-ce">
                          <SelectValue placeholder="Selecione o estoque de destino..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {estoquesSelect.map((estoque) => (
                            <SelectItem key={estoque.id} value={estoque.id.toString()}>
                              {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="estoque_para_conta" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="estoque-origem-ec">Estoque de Origem *</Label>
                      <Select 
                        value={movimentacaoData.estoque_origem_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, estoque_origem_id: value })}
                        required
                      >
                        <SelectTrigger id="estoque-origem-ec">
                          <SelectValue placeholder="Selecione o estoque de origem..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {estoquesSelect.map((estoque) => (
                            <SelectItem key={estoque.id} value={estoque.id.toString()}>
                              {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="conta-destino-ec">Conta de Destino *</Label>
                      <Select 
                        value={movimentacaoData.conta_destino_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, conta_destino_id: value })}
                        required
                      >
                        <SelectTrigger id="conta-destino-ec">
                          <SelectValue placeholder="Selecione a conta de destino..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {contasBancarias.map((conta) => (
                            <SelectItem key={conta.id} value={conta.id.toString()}>
                              {conta.descricao}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="estoque_para_estoque" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="estoque-origem-ee">Estoque de Origem *</Label>
                      <Select 
                        value={movimentacaoData.estoque_origem_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, estoque_origem_id: value })}
                        required
                      >
                        <SelectTrigger id="estoque-origem-ee">
                          <SelectValue placeholder="Selecione o estoque de origem..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {estoquesSelect.map((estoque) => (
                            <SelectItem key={estoque.id} value={estoque.id.toString()}>
                              {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="estoque-destino-ee">Estoque de Destino *</Label>
                      <Select 
                        value={movimentacaoData.estoque_destino_id} 
                        onValueChange={(value) => setMovimentacaoData({ ...movimentacaoData, estoque_destino_id: value })}
                        required
                      >
                        <SelectTrigger id="estoque-destino-ee">
                          <SelectValue placeholder="Selecione o estoque de destino..." />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-50">
                          {estoquesSelect
                            .filter((e) => e.id.toString() !== movimentacaoData.estoque_origem_id)
                            .map((estoque) => (
                              <SelectItem key={estoque.id} value={estoque.id.toString()}>
                                {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="data-mov">Data *</Label>
                  <Input
                    id="data-mov"
                    type="date"
                    value={movimentacaoData.data}
                    onChange={(e) => setMovimentacaoData({ ...movimentacaoData, data: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="valor-mov">Valor *</Label>
                  <Input
                    id="valor-mov"
                    type="number"
                    step="0.01"
                    value={movimentacaoData.valor}
                    onChange={(e) => setMovimentacaoData({ ...movimentacaoData, valor: e.target.value })}
                    required
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="historico-mov">Histórico</Label>
                  <Textarea
                    id="historico-mov"
                    value={movimentacaoData.historico}
                    onChange={(e) => setMovimentacaoData({ ...movimentacaoData, historico: e.target.value })}
                    rows={3}
                    placeholder="Descrição da movimentação (opcional)"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsMovimentacaoDialogOpen(false);
                    setEditingLancamento(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={createTransferencia.isPending || updateMovimentacao.isPending}
                >
                  {editingLancamento?._isMovimentacao 
                    ? (updateMovimentacao.isPending ? "Atualizando..." : "Atualizar Movimentação")
                    : (createTransferencia.isPending ? "Registrando..." : "Registrar Movimentação")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Dialog de Devolução */}
        {empresaId && lancamentoParaDevolucao && (
          <DevolucaoEstoqueDialog
            open={isDevolucaoDialogOpen}
            onOpenChange={(open) => {
              setIsDevolucaoDialogOpen(open);
              if (!open) {
                setLancamentoParaDevolucao(null);
                // Fallback: limpar body styles residuais do Radix ao fechar modal
                requestAnimationFrame(() => {
                  document.body.style.pointerEvents = "";
                });
              }
            }}
            lancamentoData={lancamentoParaDevolucao}
            empresaId={empresaId}
          />
        )}

        {empresaId && (
          <TransferirDevolucoesDialog
            open={isTransferirDevolucoesOpen}
            onOpenChange={(open) => {
              setIsTransferirDevolucoesOpen(open);
              if (!open) {
                fetchLancamentos();
                requestAnimationFrame(() => {
                  document.body.style.pointerEvents = "";
                  document.body.style.overflow = "";
                });
              }
            }}
            empresaId={empresaId}
            contasBancarias={contasBancarias.map((c) => ({ id: c.id, descricao: c.descricao }))}
          />
        )}
      </div>
  );
}
