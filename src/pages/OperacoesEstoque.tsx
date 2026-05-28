import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Plus, Warehouse, Wallet, Loader2, TrendingUp, DollarSign, ArrowLeftRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isValidUUID } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEstoques,
  useEstoquesSelect,
  useEstoquesResumo,
  useCreateOperacaoEstoque,
  useEmpresaId,
  useCreateTransferenciaEstoque,
  useOperacoesEstoqueTotais,
  useDeleteOperacaoEstoque,
  useDevolucoesTotais,
  useDevolucoesEstoque,
  useRecomprasEstoque,
  useDevolucoesPendentesCount,
} from "@/hooks/useEstoque";
import { useCreateRecebivelOperacaoEstoque, useRecebiveisPorOperacao } from "@/hooks/useRecebiveisEstoque";
import type { OperacaoEstoqueComRelacoes, DistribuicaoConta } from "@/types/estoque";
import {
  calcularLiquidoSPPRO,
  calcularLiquidoSOI,
} from "@/types/estoque";
import { DistribuicaoContas } from "@/components/estoque/DistribuicaoContas";
import { TransferenciasEstoque } from "@/components/estoque/TransferenciasEstoque";
import { DevolucoesEstoque } from "@/components/estoque/DevolucoesEstoque";
import { RecomprasEstoque } from "@/components/estoque/RecomprasEstoque";
import { OperacoesFornecedorDialog } from "@/components/estoque/OperacoesFornecedorDialog";
import { ListaFornecedoresOperacoes } from "@/components/estoque/ListaFornecedoresOperacoes";
import { useFornecedores } from "@/hooks/useFornecedores";
import type { DisecuritProgram } from "@/types/disecurit-import";

interface ContaBancaria {
  id: string; // UUID
  descricao: string;
}

interface Fornecedor {
  id: string; // UUID
  nome: string;
  nome_fantasia: string | null;
}

type OperacoesTab = "SPPRO" | "SOI" | "Transferencias" | "Devolucoes" | "Recompras";

const getDiffColorClass = (diff: number | null) => {
  if (diff === null) return "";
  if (diff < 0) return "text-destructive";
  if (diff > 0) return "text-success";
  return "text-muted-foreground";
};

// Função para formatar moeda
const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || isNaN(value)) {
    return "R$ 0,00";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

// Componente para Cards de Devoluções
function DevolucoesCards() {
  const { data: devolucoesTotais, isLoading } = useDevolucoesTotais();

  return (
    <>
      <Card className="border border-muted/60" style={{ animationDelay: "0.7s" }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Devoluções</CardTitle>
          <ArrowLeftRight className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-lg sm:text-xl font-bold text-orange-600 whitespace-nowrap">
            {isLoading ? "..." : formatCurrency(devolucoesTotais?.total || 0)}
          </div>
          <p className="text-xs text-muted-foreground">Total geral de devoluções registradas</p>
        </CardContent>
      </Card>

      <Card className="border border-muted/60" style={{ animationDelay: "0.8s" }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Devoluções SPPRO</CardTitle>
          <ArrowLeftRight className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-lg sm:text-xl font-bold text-blue-600 whitespace-nowrap">
            {isLoading ? "..." : formatCurrency(devolucoesTotais?.sppro || 0)}
          </div>
          <p className="text-xs text-muted-foreground">Devoluções de operações SPPRO</p>
        </CardContent>
      </Card>

      <Card className="border border-muted/60" style={{ animationDelay: "0.9s" }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Devoluções SOI</CardTitle>
          <ArrowLeftRight className="h-4 w-4 text-purple-500" />
        </CardHeader>
        <CardContent>
          <div className="text-lg sm:text-xl font-bold text-purple-600 whitespace-nowrap">
            {isLoading ? "..." : formatCurrency(devolucoesTotais?.soi || 0)}
          </div>
          <p className="text-xs text-muted-foreground">Devoluções de operações SOI</p>
        </CardContent>
      </Card>
    </>
  );
}

// Componente para contador de recompras (total)
function RecomprasPendentesCounter() {
  const { data: recompras, isLoading } = useRecomprasEstoque();
  const total = (recompras || []).length;
  if (isLoading) return ' (...)';
  return ` (${total})`;
}

// Componente para contador de devoluções (contagem apenas de pendentes/parcialmente transferidas)
function DevolucoesCounter() {
  const { data: count = 0, isLoading } = useDevolucoesPendentesCount();
  if (isLoading) return ' (...)';
  if (count === 0) return null; // Não mostrar se não houver devoluções pendentes
  return ` (${count})`;
}

export default function OperacoesEstoque() {
  const [activeTab, setActiveTab] = useState<OperacoesTab>("SPPRO");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedOperacao, setSelectedOperacao] = useState<OperacaoEstoqueComRelacoes | null>(null);
  const [operacaoToDelete, setOperacaoToDelete] = useState<OperacaoEstoqueComRelacoes | null>(null);
  const [fornecedorDialogOpen, setFornecedorDialogOpen] = useState(false);
  const [selectedFornecedor, setSelectedFornecedor] = useState<{id: string, nome: string} | null>(null);
  const [selecionarFornecedorDialogOpen, setSelecionarFornecedorDialogOpen] = useState(false);
  const [tipoEstoquePrefill, setTipoEstoquePrefill] = useState<"SPPRO" | "SOI">("SPPRO");
  const [pendingImportFileId, setPendingImportFileId] = useState<string | null>(null);
  const [pendingImportClientCnpj, setPendingImportClientCnpj] = useState<string | null>(null);
  const [pendingImportOperationNumber, setPendingImportOperationNumber] = useState<string | null>(null);
  const [pendingImportTargetProgram, setPendingImportTargetProgram] = useState<DisecuritProgram | null>(null);
  const queryClient = useQueryClient();

  const { data: empresaId, error: empresaIdError, isLoading: isLoadingEmpresaId } = useEmpresaId();
  const tipoEstoqueParaFiltro = activeTab === "SPPRO" || activeTab === "SOI" ? activeTab : undefined;
  const { error: estoquesError } = useEstoques(tipoEstoqueParaFiltro);
  // Buscar estoques filtrados por tipo para os dropdowns principais
  const { data: estoquesSelectFiltrados, error: estoquesSelectFiltradosError, refetch: refetchEstoquesSelectFiltrados } = useEstoquesSelect(tipoEstoqueParaFiltro);
  // Buscar todos os estoques (sem filtro de tipo) para permitir transferências entre tipos
  const { data: estoquesSelect, error: estoquesSelectError, refetch: refetchEstoquesSelect } = useEstoquesSelect();
  // Buscar todos os fornecedores para o dialog de seleção
  const { data: todosFornecedores, isLoading: isLoadingFornecedores } = useFornecedores();

  // Log de erros para debug
  useEffect(() => {
    if (empresaIdError) {
      logger.error('Erro ao buscar empresa_id:', empresaIdError);
    }
    if (estoquesError) {
      logger.error('Erro ao buscar estoques:', estoquesError);
    }
    if (estoquesSelectError) {
      logger.error('Erro ao buscar estoques select:', estoquesSelectError);
    }
  }, [empresaIdError, estoquesError, estoquesSelectError]);

  useEffect(() => {
    if (activeTab === "SPPRO" || activeTab === "SOI") {
      setTipoEstoquePrefill(activeTab);
    }
  }, [activeTab]);

  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [selectedEstoqueId, setSelectedEstoqueId] = useState<string>("");
  const [selectedEstoqueSaldo, setSelectedEstoqueSaldo] = useState<number>(0);
  const [ultimoEstoquePorTipo, setUltimoEstoquePorTipo] = useState<{ SPPRO?: string; SOI?: string }>({});
  const ultimoEstoqueAtual =
    activeTab === "SPPRO" || activeTab === "SOI" ? ultimoEstoquePorTipo[activeTab] : undefined;

  const createOperacao = useCreateOperacaoEstoque();
  const createTransferencia = useCreateTransferenciaEstoque();
  const deleteOperacao = useDeleteOperacaoEstoque();
  const createRecebivel = useCreateRecebivelOperacaoEstoque();
  const { data: resumoEstoquesOperacao, isLoading: isLoadingResumoCards } = useEstoquesResumo();
  const { data: operacoesTotais, isLoading: isLoadingOperacoesTotais } = useOperacoesEstoqueTotais();
  
  // Calcular receitas e lucro
  const receitasLucro = useMemo(() => {
    if (!operacoesTotais) {
      return {
        sppro: {
          receitaLiquida: 0,
          despesas: 0,
          lucroLiquido: 0,
          totalOperacoes: 0,
        },
        soi: {
          receitaLiquida: 0,
          despesas: 0,
          lucroLiquido: 0,
          totalOperacoes: 0,
        },
        total: {
          receitaLiquida: 0,
          despesas: 0,
          lucroLiquido: 0,
          totalOperacoes: 0,
        },
      };
    }

    // Calcular SPPRO
    // IMPORTANTE: Receita Líquida deve somar o face dos títulos, não o líquido
    const receitaLiquidaSPPRO = operacoesTotais.sppro.entradas.reduce(
      (sum, op) => sum + (Number(op.face_titulos) || 0),
      0
    );
    const despesasSPPRO = operacoesTotais.sppro.saidas.reduce(
      (sum, op) => sum + (Number(op.liquido_operacao) || 0),
      0
    );
    const lucroLiquidoSPPRO = receitaLiquidaSPPRO - despesasSPPRO;
    const totalOperacoesSPPRO = receitaLiquidaSPPRO + despesasSPPRO;

    // Calcular SOI
    // IMPORTANTE: Receita Líquida deve somar o face dos títulos, não o líquido
    const receitaLiquidaSOI = operacoesTotais.soi.entradas.reduce(
      (sum, op) => sum + (Number(op.face_titulos) || 0),
      0
    );
    const despesasSOI = operacoesTotais.soi.saidas.reduce(
      (sum, op) => sum + (Number(op.liquido_operacao) || 0),
      0
    );
    const lucroLiquidoSOI = receitaLiquidaSOI - despesasSOI;
    const totalOperacoesSOI = receitaLiquidaSOI + despesasSOI;

    // Totais gerais
    const receitaLiquidaTotal = receitaLiquidaSPPRO + receitaLiquidaSOI;
    const despesasTotal = despesasSPPRO + despesasSOI;
    const lucroLiquidoTotal = receitaLiquidaTotal - despesasTotal;
    const totalOperacoesTotal = totalOperacoesSPPRO + totalOperacoesSOI;

    return {
      sppro: {
        receitaLiquida: receitaLiquidaSPPRO,
        despesas: despesasSPPRO,
        lucroLiquido: lucroLiquidoSPPRO,
        totalOperacoes: totalOperacoesSPPRO,
      },
      soi: {
        receitaLiquida: receitaLiquidaSOI,
        despesas: despesasSOI,
        lucroLiquido: lucroLiquidoSOI,
        totalOperacoes: totalOperacoesSOI,
      },
      total: {
        receitaLiquida: receitaLiquidaTotal,
        despesas: despesasTotal,
        lucroLiquido: lucroLiquidoTotal,
        totalOperacoes: totalOperacoesTotal,
      },
    };
  }, [operacoesTotais]);
  
  // Estados para distribuição de contas
  const [distribuicoesSPPRO, setDistribuicoesSPPRO] = useState<DistribuicaoConta[]>([]);
  const [distribuicoesSOI, setDistribuicoesSOI] = useState<DistribuicaoConta[]>([]);
  const [mostrarDistribuicaoSPPRO, setMostrarDistribuicaoSPPRO] = useState(false);
  const [mostrarDistribuicaoSOI, setMostrarDistribuicaoSOI] = useState(false);
  const [mostrarDistribuicaoEstoquesSPPRO, setMostrarDistribuicaoEstoquesSPPRO] = useState(false);
  const [mostrarDistribuicaoEstoquesSOI, setMostrarDistribuicaoEstoquesSOI] = useState(false);
  const [estoqueDestinoSPPRO, setEstoqueDestinoSPPRO] = useState<string>("");
  const [estoqueDestinoSOI, setEstoqueDestinoSOI] = useState<string>("");
  // O hook useEstoquesResumo já aplica o valor base fixo para SPPRO (9.936.614,12)
  // Fórmula: valor_final = base_fixa + soma_dos_saldos_dos_estoques_no_banco
  const resumoCards = useMemo(() => {
    const sppro = resumoEstoquesOperacao?.sppro ?? 0;
    const soi = resumoEstoquesOperacao?.soi ?? 0;
    const devolucoes = resumoEstoquesOperacao?.devolucoes ?? 0;
    return {
      sppro,
      soi,
      devolucoes,
      total: sppro + soi + devolucoes,
    };
  }, [resumoEstoquesOperacao?.sppro, resumoEstoquesOperacao?.soi, resumoEstoquesOperacao?.devolucoes]);

  const getSaldoById = useCallback(
    (estoqueId?: string | null) => {
      if (!estoqueId) {
        return 0;
      }

      const estoque = (estoquesSelect || []).find((item) => item?.id?.toString?.() === estoqueId);

      if (!estoque || typeof estoque.saldo_atual !== "number") {
        return 0;
      }

      return estoque.saldo_atual;
    },
    [estoquesSelect]
  );

  // Formulário SPPRO
  const [formDataSPPRO, setFormDataSPPRO] = useState({
    estoque_id: "",
    data: new Date().toISOString().split("T")[0],
    fornecedor_id: "",
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

  // Formulário SOI
  const [formDataSOI, setFormDataSOI] = useState({
    estoque_id: "",
    data: new Date().toISOString().split("T")[0],
    fornecedor_id: "",
    face_titulos: "",
    valor_compra: "",
    despesas: "",
    recompra: "",
    amortizacao_debitos: "",
    amortizacao_creditos: "",
    historico: "",
    documento: "",
  });


  const parseCurrency = (value: string) => {
    if (!value) return 0;
    const normalized = value.includes(",")
      ? value.replace(/\./g, "").replace(",", ".")
      : value;
    const parsed = Number.parseFloat(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const liquidoSPPROCalculado = useMemo(() => {
    return calcularLiquidoSPPRO({
      face_titulos: parseCurrency(formDataSPPRO.face_titulos),
      valor_compra: parseCurrency(formDataSPPRO.valor_compra),
      ad_valorem: parseCurrency(formDataSPPRO.ad_valorem),
      iss: parseCurrency(formDataSPPRO.iss),
      iof: parseCurrency(formDataSPPRO.iof),
      iof_adicional: parseCurrency(formDataSPPRO.iof_adicional || ""),
      despesas: parseCurrency(formDataSPPRO.despesas),
      recompra: parseCurrency(formDataSPPRO.recompra),
      amortizacao_debitos: parseCurrency(formDataSPPRO.amortizacao_debitos || ""),
      amortizacao_creditos: parseCurrency(formDataSPPRO.amortizacao_creditos || ""),
    });
  }, [
    formDataSPPRO.face_titulos,
    formDataSPPRO.valor_compra,
    formDataSPPRO.ad_valorem,
    formDataSPPRO.iss,
    formDataSPPRO.iof,
    formDataSPPRO.iof_adicional,
    formDataSPPRO.despesas,
    formDataSPPRO.recompra,
    formDataSPPRO.amortizacao_debitos,
    formDataSPPRO.amortizacao_creditos,
  ]);

  const liquidoSOICalculado = useMemo(() => {
    return calcularLiquidoSOI({
      face_titulos: parseCurrency(formDataSOI.face_titulos),
      valor_compra: parseCurrency(formDataSOI.valor_compra),
      despesas: parseCurrency(formDataSOI.despesas),
      recompra: parseCurrency(formDataSOI.recompra),
      amortizacao_debitos: parseCurrency(formDataSOI.amortizacao_debitos),
      amortizacao_creditos: parseCurrency(formDataSOI.amortizacao_creditos),
    });
  }, [
    formDataSOI.face_titulos,
    formDataSOI.valor_compra,
    formDataSOI.despesas,
    formDataSOI.recompra,
    formDataSOI.amortizacao_debitos,
    formDataSOI.amortizacao_creditos,
  ]);


  useEffect(() => {
    if (empresaId && isValidUUID(empresaId)) {
      fetchContasBancarias();
      fetchFornecedores();
    }
  }, [empresaId]);

  // Mostrar mensagem de erro se houver problema com empresaId (apenas se não for erro 409)
  useEffect(() => {
    if (empresaIdError && !isLoadingEmpresaId) {
      // Não mostrar erro se for erro 409 (perfil já existe) - isso é tratado automaticamente
      const errorMessage = empresaIdError.message || '';
      if (!errorMessage.includes('duplicate') && !errorMessage.includes('already exists') && !errorMessage.includes('23505')) {
        toast.error('Erro ao carregar dados da empresa. Por favor, recarregue a página.');
      }
    }
  }, [empresaIdError, isLoadingEmpresaId]);

  useEffect(() => {
    setSelectedEstoqueSaldo(getSaldoById(selectedEstoqueId));
  }, [getSaldoById, selectedEstoqueId, estoquesSelect]);

  useEffect(() => {
    if (!estoquesSelect || estoquesSelect.length === 0) {
      return;
    }

    const defaultId = ultimoEstoqueAtual || estoquesSelect[0]?.id?.toString?.() || "";

    if (!defaultId) {
      return;
    }

    if (ultimoEstoqueAtual !== defaultId) {
      setUltimoEstoquePorTipo((prev) => ({ ...prev, [activeTab]: defaultId }));
    }
  }, [activeTab, estoquesSelect, ultimoEstoqueAtual]);

  useEffect(() => {
    const defaultId = ultimoEstoqueAtual || "";

    setSelectedEstoqueId(defaultId);
  }, [activeTab, ultimoEstoqueAtual]);

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    const defaultId = ultimoEstoqueAtual;

    if (!defaultId) {
      return;
    }

    if (!selectedEstoqueId) {
      setSelectedEstoqueId(defaultId);
    }

    if (activeTab === "SPPRO" && !formDataSPPRO.estoque_id) {
      setFormDataSPPRO((prev) => ({ ...prev, estoque_id: defaultId }));
    }

    if (activeTab === "SOI" && !formDataSOI.estoque_id) {
      setFormDataSOI((prev) => ({ ...prev, estoque_id: defaultId }));
    }

    // Recalcular saldo quando o modal abrir e estoquesSelect estiver disponível
    if (estoquesSelect && estoquesSelect.length > 0) {
      const estoqueIdParaCalcular = selectedEstoqueId || ultimoEstoqueAtual || formDataSPPRO.estoque_id || formDataSOI.estoque_id;
      if (estoqueIdParaCalcular) {
        const saldoAtualizado = getSaldoById(estoqueIdParaCalcular);
        if (saldoAtualizado !== selectedEstoqueSaldo) {
          setSelectedEstoqueSaldo(saldoAtualizado);
        }
      }
    }
  }, [activeTab, formDataSOI.estoque_id, formDataSPPRO.estoque_id, isDialogOpen, selectedEstoqueId, ultimoEstoqueAtual, estoquesSelect, getSaldoById, selectedEstoqueSaldo]);


  const fetchContasBancarias = async () => {
    if (!empresaId || !isValidUUID(empresaId)) return;

    try {
      const { data, error } = await supabase
        .from("contas_bancarias")
        .select("id, descricao")
        .eq("status", true)
        .eq("empresa_id", empresaId)
        .order("descricao");
      
      if (error) {
        logger.error("Erro ao buscar contas bancárias:", error);
        toast.error("Erro ao carregar contas bancárias");
        return;
      }
      
      setContasBancarias((data || []) as ContaBancaria[]);
    } catch (error) {
      logger.error("Erro ao buscar contas bancárias:", error);
      toast.error("Erro ao carregar contas bancárias");
    }
  };

  const fetchFornecedores = async () => {
    if (!empresaId || !isValidUUID(empresaId)) return;

    try {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("id, razao_social, nome_fantasia")
        .eq("status", true)
        .eq("empresa_id", empresaId)
        .order("razao_social");
      
      if (error) {
        logger.error("Erro ao buscar fornecedores:", error);
        toast.error("Erro ao carregar fornecedores");
        return;
      }
      
      setFornecedores((data || []).map(f => ({
        id: f.id,
        nome: f.razao_social,
        nome_fantasia: f.nome_fantasia,
      })) as Fornecedor[]);
    } catch (error) {
      logger.error("Erro ao buscar fornecedores:", error);
      toast.error("Erro ao carregar fornecedores");
    }
  };

  const handleSubmitSPPRO = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!empresaId) {
      toast.error("Erro: Empresa não encontrada. Por favor, recarregue a página.");
      return;
    }
    
    if (!formDataSPPRO.estoque_id) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    const face = parseCurrency(formDataSPPRO.face_titulos);
    const valorCompra = parseCurrency(formDataSPPRO.valor_compra);

    if (Number.isNaN(face) || face <= 0) {
      toast.error("Face dos títulos deve ser maior que zero");
      return;
    }

    if (Number.isNaN(valorCompra) || valorCompra <= 0) {
      toast.error("Valor de compra deve ser maior que zero");
      return;
    }


    try {
      const estoqueAtual = formDataSPPRO.estoque_id;
      const adValorem = parseCurrency(formDataSPPRO.ad_valorem);
      const iss = parseCurrency(formDataSPPRO.iss);
      const iof = parseCurrency(formDataSPPRO.iof);
      const iofAdicional = parseCurrency(formDataSPPRO.iof_adicional || "");
      const despesas = parseCurrency(formDataSPPRO.despesas);
      const amortizacaoDebitos = parseCurrency(formDataSPPRO.amortizacao_debitos || "");
      const amortizacaoCreditos = parseCurrency(formDataSPPRO.amortizacao_creditos || "");
      // Recompra agora é registrada separadamente via aba Recompras
      // Ao criar: sempre usar 0. Ao editar: manter valor existente da operação
      const recompra = selectedOperacao 
        ? parseCurrency(formDataSPPRO.recompra) 
        : 0;

      // Calcular líquido
      const liquido_operacao = calcularLiquidoSPPRO({
        face_titulos: face,
        valor_compra: valorCompra,
        ad_valorem: adValorem,
        iss: iss,
        iof: iof,
        iof_adicional: iofAdicional,
        despesas: despesas,
        recompra: recompra,
        amortizacao_debitos: amortizacaoDebitos,
        amortizacao_creditos: amortizacaoCreditos,
      });

      // Validar estoque destino se distribuição entre estoques estiver ativa
      if (mostrarDistribuicaoEstoquesSPPRO && !estoqueDestinoSPPRO) {
        toast.error("Selecione um estoque destino para transferir o valor");
        return;
      }

      if (mostrarDistribuicaoEstoquesSPPRO && estoqueDestinoSPPRO === formDataSPPRO.estoque_id) {
        toast.error("O estoque destino deve ser diferente do estoque origem");
        return;
      }

      if (selectedOperacao) {
        // Modo edição: atualizar operação existente
        const liquidoAnterior = Number(selectedOperacao.liquido_operacao) || 0;
        const diferencaLiquido = liquido_operacao - liquidoAnterior;

        const { error: updateError } = await supabase
          .from("operacoes_estoque")
          .update({
            estoque_id: Number.parseInt(formDataSPPRO.estoque_id, 10),
            data: formDataSPPRO.data,
            fornecedor_id: formDataSPPRO.fornecedor_id && formDataSPPRO.fornecedor_id !== "" ? formDataSPPRO.fornecedor_id : null,
            conta_bancaria_id: null,
            face_titulos: face,
            valor_compra: valorCompra,
            ad_valorem: adValorem,
            iss: iss,
            iof: iof,
            iof_adicional: iofAdicional,
            despesas: despesas,
            recompra: recompra,
            amortizacao_debitos: amortizacaoDebitos,
            amortizacao_creditos: amortizacaoCreditos,
            liquido_operacao: liquido_operacao,
            historico: formDataSPPRO.historico || null,
            documento: formDataSPPRO.documento || null,
          })
          .eq("id", selectedOperacao.id);

        if (updateError) throw updateError;

        // Ajustar saldo do estoque se o líquido mudou
        if (diferencaLiquido !== 0 && selectedOperacao.tipo_operacao === "entrada") {
          const estoqueId = Number.parseInt(formDataSPPRO.estoque_id, 10);
          const { data: estoque } = await supabase
            .from("estoques")
            .select("saldo_atual")
            .eq("id", estoqueId)
            .single();

          if (estoque) {
            const novoSaldo = Number(estoque.saldo_atual) + diferencaLiquido;
            await supabase
              .from("estoques")
              .update({ saldo_atual: novoSaldo })
              .eq("id", estoqueId);
          }
        }

        toast.success("Operação atualizada com sucesso!");
      } else {
        // Modo criação: criar nova operação
        const operacaoCriada = await createOperacao.mutateAsync({
          tipo_estoque: "SPPRO",
          empresa_id: empresaId,
          estoque_id: Number.parseInt(formDataSPPRO.estoque_id, 10),
          tipo_operacao: "entrada",
          data: formDataSPPRO.data,
          fornecedor_id: formDataSPPRO.fornecedor_id && formDataSPPRO.fornecedor_id !== "" ? formDataSPPRO.fornecedor_id : null,
          conta_bancaria_id: null,
          face_titulos: face,
          valor_compra: valorCompra,
          ad_valorem: adValorem,
          iss: iss,
          iof: iof,
          iof_adicional: iofAdicional,
          despesas: despesas,
          recompra: recompra,
          amortizacao_debitos: amortizacaoDebitos,
          amortizacao_creditos: amortizacaoCreditos,
          historico: formDataSPPRO.historico || undefined,
          documento: formDataSPPRO.documento || undefined,
          distribuicoes: mostrarDistribuicaoSPPRO && distribuicoesSPPRO.length > 0 ? distribuicoesSPPRO : undefined,
        });

        // Criar recebível automaticamente após criar operação
        if (operacaoCriada && operacaoCriada.id) {
          // Calcular soma dos valores para o recebível
          const valorRecebivel = valorCompra + adValorem + iss + iof + iofAdicional + despesas + amortizacaoDebitos + amortizacaoCreditos;
          
          // Buscar informações do fornecedor para o histórico
          let fornecedorNome = "Sem fornecedor";
          if (formDataSPPRO.fornecedor_id) {
            const { data: fornecedor } = await supabase
              .from("fornecedores")
              .select("razao_social, nome_fantasia")
              .eq("id", formDataSPPRO.fornecedor_id)
              .single();
            
            if (fornecedor) {
              fornecedorNome = fornecedor.razao_social || fornecedor.nome_fantasia || "Fornecedor";
            }
          }

          // Formatar data da operação para o histórico
          const dataOperacaoFormatada = new Date(formDataSPPRO.data).toLocaleDateString('pt-BR');
          
          // Criar descrição formatada
          const descricao = `Recebível Operação #${operacaoCriada.id} - ${fornecedorNome} - ${dataOperacaoFormatada}`;

          // Criar recebível usando a data da operação
          await createRecebivel.mutateAsync({
            operacao_estoque_id: operacaoCriada.id,
            empresa_id: empresaId,
            valor: valorRecebivel,
            data_vencimento: formDataSPPRO.data,
            descricao: descricao,
            tipo_estoque: "SPPRO",
          });
        }

        // Se houver transferência entre estoques, criar movimentação
        if (mostrarDistribuicaoEstoquesSPPRO && estoqueDestinoSPPRO && operacaoCriada) {
          const estoqueOrigemId = Number.parseInt(formDataSPPRO.estoque_id, 10);
          const estoqueDestinoId = Number.parseInt(estoqueDestinoSPPRO, 10);

          await createTransferencia.mutateAsync({
            tipo: 'estoque_para_estoque',
            origem_id: estoqueOrigemId,
            destino_id: estoqueDestinoId,
            valor: liquido_operacao,
            data: formDataSPPRO.data,
            historico: `Transferência da Operação #${operacaoCriada.id}`,
          });
        }
      }

      // Invalidar queries e refetch
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      
      // Refetch explícito para garantir dados atualizados
      await Promise.all([
        refetchEstoquesSelect(),
        refetchEstoquesSelectFiltrados()
      ]);
      const { data: estoquesAtualizados } = await refetchEstoquesSelect();
      
      // Recalcular saldo imediatamente após refetch
      if (estoquesAtualizados && estoqueAtual) {
        const estoque = estoquesAtualizados.find((item) => item?.id?.toString?.() === estoqueAtual);
        if (estoque) {
          setSelectedEstoqueSaldo(estoque.saldo_atual || 0);
        }
      }

      if (estoqueAtual) {
        setUltimoEstoquePorTipo((prev) => ({ ...prev, SPPRO: estoqueAtual }));
      }

      resetFormSPPRO(estoqueAtual);
      setDistribuicoesSPPRO([]);
      setMostrarDistribuicaoSPPRO(false);
      setMostrarDistribuicaoEstoquesSPPRO(false);
      setEstoqueDestinoSPPRO("");
      setSelectedOperacao(null);
      setIsDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar operação");
    }
  };

  const handleSubmitSOI = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!empresaId) {
      toast.error("Erro: Empresa não encontrada. Por favor, recarregue a página.");
      return;
    }
    
    if (!formDataSOI.estoque_id) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    const face = parseCurrency(formDataSOI.face_titulos);
    const valorCompra = parseCurrency(formDataSOI.valor_compra);

    if (Number.isNaN(face) || face <= 0) {
      toast.error("Face dos títulos deve ser maior que zero");
      return;
    }

    if (Number.isNaN(valorCompra) || valorCompra <= 0) {
      toast.error("Valor de compra deve ser maior que zero");
      return;
    }


    try {
      const estoqueAtual = formDataSOI.estoque_id;
      const despesas = parseCurrency(formDataSOI.despesas);
      // Recompra agora é registrada separadamente via aba Recompras
      // Ao criar: sempre usar 0. Ao editar: manter valor existente da operação
      const recompra = selectedOperacao 
        ? parseCurrency(formDataSOI.recompra) 
        : 0;
      const amortizacaoDebitos = parseCurrency(formDataSOI.amortizacao_debitos);
      const amortizacaoCreditos = parseCurrency(formDataSOI.amortizacao_creditos);

      // Calcular líquido
      const liquido_operacao = calcularLiquidoSOI({
        face_titulos: face,
        valor_compra: valorCompra,
        despesas: despesas,
        recompra: recompra,
        amortizacao_debitos: amortizacaoDebitos,
        amortizacao_creditos: amortizacaoCreditos,
      });

      // Validar estoque destino se distribuição entre estoques estiver ativa
      if (mostrarDistribuicaoEstoquesSOI && !estoqueDestinoSOI) {
        toast.error("Selecione um estoque destino para transferir o valor");
        return;
      }

      if (mostrarDistribuicaoEstoquesSOI && estoqueDestinoSOI === formDataSOI.estoque_id) {
        toast.error("O estoque destino deve ser diferente do estoque origem");
        return;
      }

      if (selectedOperacao) {
        // Modo edição: atualizar operação existente
        const liquidoAnterior = Number(selectedOperacao.liquido_operacao) || 0;
        const diferencaLiquido = liquido_operacao - liquidoAnterior;

        const { error: updateError } = await supabase
          .from("operacoes_estoque")
          .update({
            estoque_id: Number.parseInt(formDataSOI.estoque_id, 10),
            data: formDataSOI.data,
            fornecedor_id: formDataSOI.fornecedor_id && formDataSOI.fornecedor_id !== "" ? formDataSOI.fornecedor_id : null,
            conta_bancaria_id: null,
            face_titulos: face,
            valor_compra: valorCompra,
            despesas: despesas,
            recompra: recompra,
            amortizacao_debitos: amortizacaoDebitos,
            amortizacao_creditos: amortizacaoCreditos,
            liquido_operacao: liquido_operacao,
            historico: formDataSOI.historico || null,
            documento: formDataSOI.documento || null,
          })
          .eq("id", selectedOperacao.id);

        if (updateError) throw updateError;

        // Ajustar saldo do estoque se o líquido mudou
        if (diferencaLiquido !== 0 && selectedOperacao.tipo_operacao === "entrada") {
          const estoqueId = Number.parseInt(formDataSOI.estoque_id, 10);
          const { data: estoque } = await supabase
            .from("estoques")
            .select("saldo_atual")
            .eq("id", estoqueId)
            .single();

          if (estoque) {
            const novoSaldo = Number(estoque.saldo_atual) + diferencaLiquido;
            await supabase
              .from("estoques")
              .update({ saldo_atual: novoSaldo })
              .eq("id", estoqueId);
          }
        }

        toast.success("Operação atualizada com sucesso!");
      } else {
        // Modo criação: criar nova operação
        const operacaoCriada = await createOperacao.mutateAsync({
          tipo_estoque: "SOI",
          empresa_id: empresaId,
          estoque_id: Number.parseInt(formDataSOI.estoque_id, 10),
          tipo_operacao: "entrada",
          data: formDataSOI.data,
          fornecedor_id: formDataSOI.fornecedor_id && formDataSOI.fornecedor_id !== "" ? formDataSOI.fornecedor_id : null,
          conta_bancaria_id: null,
          face_titulos: face,
          valor_compra: valorCompra,
          despesas: despesas,
          recompra: recompra,
          amortizacao_debitos: amortizacaoDebitos,
          amortizacao_creditos: amortizacaoCreditos,
          historico: formDataSOI.historico || undefined,
          documento: formDataSOI.documento || undefined,
          distribuicoes: mostrarDistribuicaoSOI && distribuicoesSOI.length > 0 ? distribuicoesSOI : undefined,
        });

        // Criar recebível automaticamente após criar operação
        if (operacaoCriada && operacaoCriada.id) {
          // Calcular soma dos valores para o recebível (incluindo créditos normalmente)
          const valorRecebivel = valorCompra + amortizacaoDebitos + amortizacaoCreditos + despesas;
          
          // Buscar informações do fornecedor para o histórico
          let fornecedorNome = "Sem fornecedor";
          if (formDataSOI.fornecedor_id) {
            const { data: fornecedor } = await supabase
              .from("fornecedores")
              .select("razao_social, nome_fantasia")
              .eq("id", formDataSOI.fornecedor_id)
              .single();
            
            if (fornecedor) {
              fornecedorNome = fornecedor.razao_social || fornecedor.nome_fantasia || "Fornecedor";
            }
          }

          // Formatar data da operação para o histórico
          const dataOperacaoFormatada = new Date(formDataSOI.data).toLocaleDateString('pt-BR');
          
          // Criar descrição formatada
          const descricao = `Recebível Operação #${operacaoCriada.id} - ${fornecedorNome} - ${dataOperacaoFormatada}`;

          // Criar recebível usando a data da operação
          await createRecebivel.mutateAsync({
            operacao_estoque_id: operacaoCriada.id,
            empresa_id: empresaId,
            valor: valorRecebivel,
            data_vencimento: formDataSOI.data,
            descricao: descricao,
            tipo_estoque: "SOI",
          });
        }

        // Se houver transferência entre estoques, criar movimentação
        if (mostrarDistribuicaoEstoquesSOI && estoqueDestinoSOI && operacaoCriada) {
          const estoqueOrigemId = Number.parseInt(formDataSOI.estoque_id, 10);
          const estoqueDestinoId = Number.parseInt(estoqueDestinoSOI, 10);

          await createTransferencia.mutateAsync({
            tipo: 'estoque_para_estoque',
            origem_id: estoqueOrigemId,
            destino_id: estoqueDestinoId,
            valor: liquido_operacao,
            data: formDataSOI.data,
            historico: `Transferência da Operação #${operacaoCriada.id}`,
          });
        }
      }

      // Invalidar queries e refetch
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      
      // Refetch explícito para garantir dados atualizados
      await Promise.all([
        refetchEstoquesSelect(),
        refetchEstoquesSelectFiltrados()
      ]);
      const { data: estoquesAtualizados } = await refetchEstoquesSelect();
      
      // Recalcular saldo imediatamente após refetch
      if (estoquesAtualizados && estoqueAtual) {
        const estoque = estoquesAtualizados.find((item) => item?.id?.toString?.() === estoqueAtual);
        if (estoque) {
          setSelectedEstoqueSaldo(estoque.saldo_atual || 0);
        }
      }

      if (estoqueAtual) {
        setUltimoEstoquePorTipo((prev) => ({ ...prev, SOI: estoqueAtual }));
      }

      resetFormSOI(estoqueAtual);
      setDistribuicoesSOI([]);
      setMostrarDistribuicaoSOI(false);
      setMostrarDistribuicaoEstoquesSOI(false);
      setEstoqueDestinoSOI("");
      setSelectedOperacao(null);
      setIsDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar operação");
    }
  };

  const resetFormSPPRO = (preferedEstoqueId?: string) => {
    const fallback = preferedEstoqueId || ultimoEstoquePorTipo.SPPRO || "";

    setFormDataSPPRO({
      estoque_id: fallback,
      data: new Date().toISOString().split("T")[0],
      fornecedor_id: "",
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
    setSelectedEstoqueId(fallback);
    setSelectedEstoqueSaldo(getSaldoById(fallback));
    setSelectedOperacao(null);
  };

  const resetFormSOI = (preferedEstoqueId?: string) => {
    const fallback = preferedEstoqueId || ultimoEstoquePorTipo.SOI || "";

    setFormDataSOI({
      estoque_id: fallback,
      data: new Date().toISOString().split("T")[0],
      fornecedor_id: "",
      face_titulos: "",
      valor_compra: "",
      despesas: "",
      recompra: "",
      amortizacao_debitos: "",
      amortizacao_creditos: "",
      historico: "",
      documento: "",
    });
    setSelectedEstoqueId(fallback);
    setSelectedEstoqueSaldo(getSaldoById(fallback));
    setSelectedOperacao(null);
  };

  const handleEditOperacaoSPPRO = async (operacao: OperacaoEstoqueComRelacoes) => {
    // Verificar se a operação tem recebíveis criados
    const { data: recebiveis } = await supabase
      .from('recebiveis_operacoes_estoque')
      .select('id')
      .eq('operacao_estoque_id', operacao.id);

    if (recebiveis && recebiveis.length > 0) {
      toast.error("Não é possível editar operações que já possuem recebíveis criados em Contas a Receber");
      return;
    }

    setSelectedOperacao(operacao);
    setFormDataSPPRO({
      estoque_id: operacao.estoque_id.toString(),
      data: operacao.data,
      fornecedor_id: operacao.fornecedor_id || "",
      face_titulos: operacao.face_titulos.toString(),
      valor_compra: operacao.valor_compra.toString(),
      ad_valorem: (operacao.ad_valorem || 0).toString(),
      iss: (operacao.iss || 0).toString(),
      iof: (operacao.iof || 0).toString(),
      iof_adicional: ((operacao as any).iof_adicional || 0).toString(),
      despesas: operacao.despesas.toString(),
      recompra: operacao.recompra.toString(),
      amortizacao_debitos: (operacao.amortizacao_debitos || 0).toString(),
      amortizacao_creditos: (operacao.amortizacao_creditos || 0).toString(),
      historico: operacao.historico || "",
      documento: operacao.documento || "",
    });
    setSelectedEstoqueId(operacao.estoque_id.toString());
    setSelectedEstoqueSaldo(getSaldoById(operacao.estoque_id.toString()));
    setIsDialogOpen(true);
  };

  const handleOpenFornecedorDialog = (
    fornecedorId: string,
    fornecedorNome: string,
    importFileId?: string | null
  ) => {
    if (!fornecedorId) return;
    setSelectedFornecedor({ id: fornecedorId, nome: fornecedorNome });
    if (importFileId) {
      setPendingImportFileId(importFileId);
    } else {
      setPendingImportFileId(null);
      setPendingImportClientCnpj(null);
      setPendingImportOperationNumber(null);
      setPendingImportTargetProgram(null);
    }
    setFornecedorDialogOpen(true);
  };

  const tipoEstoqueDialog =
    pendingImportTargetProgram ||
    (activeTab === "SPPRO" || activeTab === "SOI" ? activeTab : tipoEstoquePrefill);

  const handleEditOperacaoSOI = async (operacao: OperacaoEstoqueComRelacoes) => {
    // Verificar se a operação tem recebíveis criados
    const { data: recebiveis } = await supabase
      .from('recebiveis_operacoes_estoque')
      .select('id')
      .eq('operacao_estoque_id', operacao.id);

    if (recebiveis && recebiveis.length > 0) {
      toast.error("Não é possível editar operações que já possuem recebíveis criados em Contas a Receber");
      return;
    }

    setSelectedOperacao(operacao);
    setFormDataSOI({
      estoque_id: operacao.estoque_id.toString(),
      data: operacao.data,
      fornecedor_id: operacao.fornecedor_id || "",
      face_titulos: operacao.face_titulos.toString(),
      valor_compra: operacao.valor_compra.toString(),
      despesas: operacao.despesas.toString(),
      recompra: operacao.recompra.toString(),
      amortizacao_debitos: (operacao.amortizacao_debitos || 0).toString(),
      amortizacao_creditos: (operacao.amortizacao_creditos || 0).toString(),
      historico: operacao.historico || "",
      documento: operacao.documento || "",
    });
    setSelectedEstoqueId(operacao.estoque_id.toString());
    setSelectedEstoqueSaldo(getSaldoById(operacao.estoque_id.toString()));
    setIsDialogOpen(true);
  };

  const handleDeleteOperacao = async () => {
    if (!operacaoToDelete) return;

    try {
      // Usar o hook que faz toda a lógica de reversão
      await deleteOperacao.mutateAsync(operacaoToDelete.id);

      // Refetch explícito para garantir dados atualizados
      await Promise.all([
        refetchEstoquesSelect(),
        refetchEstoquesSelectFiltrados()
      ]);
      
      // Recalcular saldo se houver estoque selecionado
      if (selectedEstoqueId) {
        const saldoAtualizado = getSaldoById(selectedEstoqueId);
        setSelectedEstoqueSaldo(saldoAtualizado);
      }

      setOperacaoToDelete(null);
      setIsDeleteDialogOpen(false);
    } catch (error: any) {
      // Erro já é tratado pelo hook (toast)
      logger.error('Erro ao excluir operação:', error);
    }
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "R$ 0,00";
    }
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) {
      return "-";
    }
    try {
      const date = new Date(dateString + "T00:00:00");
      if (Number.isNaN(date.getTime())) {
        return "-";
      }
      return date.toLocaleDateString("pt-BR");
    } catch {
      return "-";
    }
  };


  // Mostrar loading ou erro se empresaId não estiver disponível
  if (isLoadingEmpresaId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Carregando dados...</p>
        </div>
      </div>
    );
  }

  if (empresaIdError) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive font-semibold">Erro ao carregar dados</p>
          <p className="text-muted-foreground">Por favor, recarregue a página ou faça login novamente.</p>
          <Button onClick={() => window.location.reload()}>Recarregar Página</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Operações</h1>
            <p className="text-muted-foreground">
              Gerencie entradas SPPRO/SOI, acompanhe os saldos e registre novas operações que atualizam o resumo automaticamente.
            </p>
          </div>

        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo SPPRO</CardTitle>
              <Warehouse className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-blue-600 whitespace-nowrap">
                {isLoadingResumoCards ? "..." : formatCurrency(resumoCards.sppro)}
              </div>
              <p className="text-xs text-muted-foreground">Saldo atual de títulos SPPRO</p>
            </CardContent>
          </Card>

          <Card className="border border-muted/60" style={{ animationDelay: "0.1s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo SOI</CardTitle>
              <Warehouse className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-purple-600 whitespace-nowrap">
                {isLoadingResumoCards ? "..." : formatCurrency(resumoCards.soi)}
              </div>
              <p className="text-xs text-muted-foreground">Saldo atual das operações SOI</p>
            </CardContent>
          </Card>

          <Card className="border border-muted/60" style={{ animationDelay: "0.2s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Estoque Devoluções</CardTitle>
              <ArrowLeftRight className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-orange-600 whitespace-nowrap">
                {isLoadingResumoCards ? "..." : formatCurrency(resumoCards.devolucoes)}
              </div>
              <p className="text-xs text-muted-foreground">Saldo atual do estoque de devoluções</p>
            </CardContent>
          </Card>

 		  <Card className="border border-muted/60" style={{ animationDelay: "0.3s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Estoque</CardTitle>
              <Wallet className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-green-600 whitespace-nowrap">
                {isLoadingResumoCards ? "..." : formatCurrency(resumoCards.total)}
              </div>
              <p className="text-xs text-muted-foreground">Soma dos estoques SPPRO + SOI + Devoluções</p>
            </CardContent>
          </Card>
        </div>

        {/* Cards de Receitas e Lucro */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border border-muted/60" style={{ animationDelay: "0.3s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Receita Líquida SPPRO</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-success whitespace-nowrap">
                {isLoadingOperacoesTotais ? "..." : formatCurrency(receitasLucro.sppro.receitaLiquida)}
              </div>
              <p className="text-xs text-muted-foreground">Total líquido de entradas SPPRO</p>
            </CardContent>
          </Card>

          <Card className="border border-muted/60" style={{ animationDelay: "0.4s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Receita Líquida SOI</CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-success whitespace-nowrap">
                {isLoadingOperacoesTotais ? "..." : formatCurrency(receitasLucro.soi.receitaLiquida)}
              </div>
              <p className="text-xs text-muted-foreground">Total líquido de entradas SOI</p>
            </CardContent>
          </Card>

          <Card className="border border-muted/60" style={{ animationDelay: "0.5s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Lucro Líquido Total</CardTitle>
              <DollarSign className={`h-4 w-4 ${receitasLucro.total.lucroLiquido >= 0 ? 'text-success' : 'text-destructive'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-lg sm:text-xl font-bold whitespace-nowrap ${receitasLucro.total.lucroLiquido >= 0 ? 'text-success' : 'text-destructive'}`}>
                {isLoadingOperacoesTotais ? "..." : formatCurrency(receitasLucro.total.lucroLiquido)}
              </div>
              <p className="text-xs text-muted-foreground">Diferença entre entradas e saídas</p>
            </CardContent>
          </Card>

          <Card className="border border-muted/60" style={{ animationDelay: "0.6s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Receita Total</CardTitle>
              <DollarSign className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-success whitespace-nowrap">
                {isLoadingOperacoesTotais ? "..." : formatCurrency(receitasLucro.total.receitaLiquida)}
              </div>
              <p className="text-xs text-muted-foreground">Soma de todas as receitas líquidas</p>
            </CardContent>
          </Card>
        </div>

        {/* Cards de Devoluções */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DevolucoesCards />
        </div>

        {/* Tabs SPPRO/SOI/Transferências/Devoluções/Recompras */}
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as OperacoesTab)}>
          <TabsList>
            <TabsTrigger value="SPPRO">SPPRO</TabsTrigger>
            <TabsTrigger value="SOI">SOI</TabsTrigger>
            <TabsTrigger value="Transferencias">Transferências</TabsTrigger>
            <TabsTrigger value="Devolucoes">Estoque Devoluções<DevolucoesCounter /></TabsTrigger>
            <TabsTrigger value="Recompras">
              Recompras<RecomprasPendentesCounter />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="SPPRO" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Fornecedores com Operações SPPRO</h2>
              <Button
                onClick={() => {
                  setPendingImportFileId(null);
                  setPendingImportClientCnpj(null);
                  setPendingImportOperationNumber(null);
                  setPendingImportTargetProgram(null);
                  setSelecionarFornecedorDialogOpen(true);
                }}
                className="bg-success hover:bg-success/90"
              >
                <Plus className="mr-2 h-4 w-4" />
                Nova Operação
              </Button>
            </div>
            <ListaFornecedoresOperacoes
              tipoEstoque="SPPRO"
              onFornecedorClick={handleOpenFornecedorDialog}
            />
          </TabsContent>

          <TabsContent value="SOI" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Fornecedores com Operações SOI</h2>
              <Button
                onClick={() => {
                  setPendingImportFileId(null);
                  setPendingImportClientCnpj(null);
                  setPendingImportOperationNumber(null);
                  setPendingImportTargetProgram(null);
                  setSelecionarFornecedorDialogOpen(true);
                }}
                className="bg-success hover:bg-success/90"
              >
                <Plus className="mr-2 h-4 w-4" />
                Nova Operação
              </Button>
            </div>
            <ListaFornecedoresOperacoes
              tipoEstoque="SOI"
              onFornecedorClick={handleOpenFornecedorDialog}
            />
          </TabsContent>

          <TabsContent value="Transferencias" className="space-y-6">
            {empresaId && (
              <TransferenciasEstoque
                contasBancarias={contasBancarias}
                estoquesSelect={estoquesSelect || []}
                empresaId={empresaId}
                onSubmit={async (data) => {
                  try {
                  await createTransferencia.mutateAsync(data);
                    // Refetch estoques para atualizar saldos na UI
                    await Promise.all([
                      refetchEstoquesSelect(),
                      refetchEstoquesSelectFiltrados()
                    ]);
                  } catch (error: any) {
                    // O erro já é tratado pelo hook (toast.error), mas podemos adicionar log aqui se necessário
                    logger.error('Erro ao registrar transferência:', error);
                    throw error; // Re-throw para o componente tratar se necessário
                  }
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="Devolucoes" className="space-y-6">
            {empresaId && (
              <DevolucoesEstoque
                empresaId={empresaId}
                contasBancarias={contasBancarias}
              />
            )}
          </TabsContent>

          <TabsContent value="Recompras" className="space-y-6">
            {empresaId && (
              <RecomprasEstoque
                empresaId={empresaId}
                contasBancarias={contasBancarias}
                estoquesSelect={estoquesSelect || []}
              />
            )}
          </TabsContent>

        </Tabs>

        {/* Dialog para Nova Entrada SPPRO */}
        <Dialog open={isDialogOpen && activeTab === "SPPRO"} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedOperacao(null);
            resetFormSPPRO(ultimoEstoquePorTipo.SPPRO);
            setDistribuicoesSPPRO([]);
            setMostrarDistribuicaoSPPRO(false);
            setMostrarDistribuicaoEstoquesSPPRO(false);
            setEstoqueDestinoSPPRO("");
          }
        }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedOperacao ? "Editar Entrada SPPRO" : "Nova Entrada SPPRO"}</DialogTitle>
              <DialogDescription>{selectedOperacao ? "Altere os dados da operação de estoque SPPRO" : "Registre uma nova entrada de estoque SPPRO"}</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmitSPPRO} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="estoque_id_sppro">Estoque *</Label>
                  <Select
                    value={formDataSPPRO.estoque_id}
                    onValueChange={(value) => {
                      setFormDataSPPRO((prev) => ({ ...prev, estoque_id: value }));
                      setSelectedEstoqueId(value);
                      setUltimoEstoquePorTipo((prev) => ({ ...prev, SPPRO: value }));
                      setSelectedEstoqueSaldo(getSaldoById(value));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um estoque..." />
                    </SelectTrigger>
                    <SelectContent>
                      {estoquesSelectFiltrados && estoquesSelectFiltrados.length > 0 ? (
                        estoquesSelectFiltrados.map((estoque) => (
                          <SelectItem key={estoque.id} value={estoque.id.toString()}>
                            {estoque.descricao || `Estoque #${estoque.id}`} - Saldo Total SPPRO: {formatCurrency(resumoCards.sppro)}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          Nenhum estoque SPPRO disponível
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  {resumoCards.sppro > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Saldo atual: <strong>{formatCurrency(resumoCards.sppro)}</strong>
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="data_sppro">Data *</Label>
                  <Input
                    id="data_sppro"
                    type="date"
                    value={formDataSPPRO.data}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, data: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="fornecedor_id_sppro">Fornecedor</Label>
                  <Select
                    value={formDataSPPRO.fornecedor_id || ""}
                    onValueChange={(value) => setFormDataSPPRO({ ...formDataSPPRO, fornecedor_id: value || "" })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um fornecedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {fornecedores.map((fornecedor) => (
                        <SelectItem key={fornecedor.id} value={fornecedor.id.toString()}>
                          {fornecedor.nome_fantasia || fornecedor.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="face_titulos_sppro">Face dos Títulos *</Label>
                  <Input
                    id="face_titulos_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.face_titulos}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, face_titulos: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="valor_compra_sppro">Valor de Compra *</Label>
                  <Input
                    id="valor_compra_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.valor_compra}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, valor_compra: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="ad_valorem_sppro">Ad-Valorem</Label>
                  <Input
                    id="ad_valorem_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.ad_valorem}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, ad_valorem: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="iss_sppro">ISS</Label>
                  <Input
                    id="iss_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.iss}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, iss: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="iof_sppro">IOF</Label>
                  <Input
                    id="iof_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.iof}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, iof: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="iof_adicional_sppro">IOF Adicional</Label>
                  <Input
                    id="iof_adicional_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.iof_adicional || ""}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, iof_adicional: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="despesas_sppro">Despesas</Label>
                  <Input
                    id="despesas_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.despesas}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, despesas: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="amortizacao_debitos_sppro">Amortização de Débitos</Label>
                  <Input
                    id="amortizacao_debitos_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.amortizacao_debitos}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, amortizacao_debitos: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="amortizacao_creditos_sppro">Amortização de Créditos</Label>
                  <Input
                    id="amortizacao_creditos_sppro"
                    type="number"
                    step="0.01"
                    value={formDataSPPRO.amortizacao_creditos}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, amortizacao_creditos: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="liquido_sppro">Líquido da Operação (calculado automaticamente)</Label>
                  <Input
                    id="liquido_sppro"
                    type="text"
                    value={liquidoSPPROCalculado.toFixed(2)}
                    readOnly
                    className="bg-muted font-bold"
                  />
                </div>

                {liquidoSPPROCalculado > 0 && (
                  <div className="col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setMostrarDistribuicaoSPPRO((prev) => {
                          const next = !prev;
                          if (!next) {
                            setDistribuicoesSPPRO([]);
                          }
                          return next;
                        });
                      }}
                    >
                      {mostrarDistribuicaoSPPRO ? "Ocultar Distribuição" : "Distribuir entre Contas"}
                    </Button>
                  </div>
                )}

                {mostrarDistribuicaoSPPRO && liquidoSPPROCalculado > 0 && (
                  <div className="col-span-2">
                    <DistribuicaoContas
                      liquidoOperacao={liquidoSPPROCalculado}
                      contasBancarias={contasBancarias}
                      distribuicoes={distribuicoesSPPRO}
                      onChange={setDistribuicoesSPPRO}
                    />
                  </div>
                )}

                {liquidoSPPROCalculado > 0 && (
                  <div className="col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setMostrarDistribuicaoEstoquesSPPRO((prev) => {
                          const next = !prev;
                          if (!next) {
                            setEstoqueDestinoSPPRO("");
                          }
                          return next;
                        });
                      }}
                    >
                      {mostrarDistribuicaoEstoquesSPPRO ? "Ocultar Distribuição de Estoques" : "Distribuir Entre Estoques"}
                    </Button>
                  </div>
                )}

                {mostrarDistribuicaoEstoquesSPPRO && liquidoSPPROCalculado > 0 && (
                  <div className="col-span-2 space-y-3 rounded-md border p-4">
                    <div>
                      <Label htmlFor="estoque-destino-sppro">Estoque Destino</Label>
                      <Select
                        value={estoqueDestinoSPPRO}
                        onValueChange={setEstoqueDestinoSPPRO}
                      >
                        <SelectTrigger id="estoque-destino-sppro">
                          <SelectValue placeholder="Selecione o estoque destino..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(() => {
                            logger.debug('🔍 Debug Estoque Destino SPPRO:');
                            logger.debug('- estoquesSelect:', estoquesSelect);
                            logger.debug('- Total de estoques:', estoquesSelect?.length || 0);
                            logger.debug('- formDataSPPRO.estoque_id:', formDataSPPRO.estoque_id);
                            
                            const estoquesFiltrados = (estoquesSelect || []).filter((estoque) => {
                              const tipoNormalizado = estoque.tipo?.toUpperCase();
                              const isSOI = tipoNormalizado === 'SOI';
                              const isDifferent = estoque.id.toString() !== formDataSPPRO.estoque_id;
                              
                              logger.debug(`  Estoque ${estoque.id} (${estoque.tipo}): SOI=${isSOI}, Diferente=${isDifferent}`);
                              
                              return isSOI && isDifferent;
                            });
                            
                            logger.debug('- Estoques SOI filtrados:', estoquesFiltrados.length);
                            logger.debug('- Estoques filtrados:', estoquesFiltrados);
                            
                            if (estoquesFiltrados.length === 0) {
                              return (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                  Nenhum estoque SOI disponível
                                </div>
                              );
                            }
                            
                            return estoquesFiltrados.map((estoque) => (
                              <SelectItem key={estoque.id} value={estoque.id.toString()}>
                                {estoque.descricao || `Estoque #${estoque.id}`}
                              </SelectItem>
                            ));
                          })()}
                        </SelectContent>
                      </Select>
                    </div>

                    {estoqueDestinoSPPRO && (
                      <div>
                        <Label htmlFor="valor-transferencia-sppro">Valor a Transferir</Label>
                        <Input
                          id="valor-transferencia-sppro"
                          type="text"
                          value={liquidoSPPROCalculado.toFixed(2)}
                          readOnly
                          className="bg-muted font-bold"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Label htmlFor="documento_sppro">Documento</Label>
                  <Input
                    id="documento_sppro"
                    value={formDataSPPRO.documento}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, documento: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="historico_sppro">Histórico</Label>
                  <Textarea
                    id="historico_sppro"
                    value={formDataSPPRO.historico}
                    onChange={(e) => setFormDataSPPRO({ ...formDataSPPRO, historico: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setSelectedOperacao(null);
                    resetFormSPPRO(ultimoEstoquePorTipo.SPPRO);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createOperacao.isPending}>
                  {createOperacao.isPending ? "Salvando..." : selectedOperacao ? "Atualizar" : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Dialog para Nova Entrada SOI */}
        <Dialog open={isDialogOpen && activeTab === "SOI"} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedOperacao(null);
            resetFormSOI(ultimoEstoquePorTipo.SOI);
            setDistribuicoesSOI([]);
            setMostrarDistribuicaoSOI(false);
            setMostrarDistribuicaoEstoquesSOI(false);
            setEstoqueDestinoSOI("");
          }
        }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedOperacao ? "Editar Entrada SOI" : "Nova Entrada SOI"}</DialogTitle>
              <DialogDescription>{selectedOperacao ? "Altere os dados da operação de estoque SOI" : "Registre uma nova entrada de estoque SOI"}</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmitSOI} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="estoque_id_soi">Estoque *</Label>
                  <Select
                    value={formDataSOI.estoque_id}
                    onValueChange={(value) => {
                      setFormDataSOI((prev) => ({ ...prev, estoque_id: value }));
                      setSelectedEstoqueId(value);
                      setUltimoEstoquePorTipo((prev) => ({ ...prev, SOI: value }));
                      setSelectedEstoqueSaldo(getSaldoById(value));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um estoque..." />
                    </SelectTrigger>
                    <SelectContent>
                      {estoquesSelectFiltrados && estoquesSelectFiltrados.length > 0 ? (
                        estoquesSelectFiltrados.map((estoque) => (
                          <SelectItem key={estoque.id} value={estoque.id.toString()}>
                            {estoque.descricao || `Estoque #${estoque.id}`} - Saldo Total SOI: {formatCurrency(resumoCards.soi)}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          Nenhum estoque SOI disponível
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  {resumoCards.soi > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Saldo atual: <strong>{formatCurrency(resumoCards.soi)}</strong>
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="data_soi">Data *</Label>
                  <Input
                    id="data_soi"
                    type="date"
                    value={formDataSOI.data}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, data: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="fornecedor_id_soi">Fornecedor</Label>
                  <Select
                    value={formDataSOI.fornecedor_id || ""}
                    onValueChange={(value) => setFormDataSOI({ ...formDataSOI, fornecedor_id: value || "" })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um fornecedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {fornecedores.map((fornecedor) => (
                        <SelectItem key={fornecedor.id} value={fornecedor.id.toString()}>
                          {fornecedor.nome_fantasia || fornecedor.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="face_titulos_soi">Face dos Títulos *</Label>
                  <Input
                    id="face_titulos_soi"
                    type="number"
                    step="0.01"
                    value={formDataSOI.face_titulos}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, face_titulos: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="valor_compra_soi">Valor de Compra *</Label>
                  <Input
                    id="valor_compra_soi"
                    type="number"
                    step="0.01"
                    value={formDataSOI.valor_compra}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, valor_compra: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="despesas_soi">Despesas</Label>
                  <Input
                    id="despesas_soi"
                    type="number"
                    step="0.01"
                    value={formDataSOI.despesas}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, despesas: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="amortizacao_debitos_soi">Amortização de Débitos</Label>
                  <Input
                    id="amortizacao_debitos_soi"
                    type="number"
                    step="0.01"
                    value={formDataSOI.amortizacao_debitos}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, amortizacao_debitos: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="amortizacao_creditos_soi">Amortização de Créditos</Label>
                  <Input
                    id="amortizacao_creditos_soi"
                    type="number"
                    step="0.01"
                    value={formDataSOI.amortizacao_creditos}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, amortizacao_creditos: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="liquido_soi">Líquido da Operação (calculado automaticamente)</Label>
                  <Input
                    id="liquido_soi"
                    type="text"
                    value={liquidoSOICalculado.toFixed(2)}
                    readOnly
                    className="bg-muted font-bold"
                  />
                </div>

                {liquidoSOICalculado > 0 && (
                  <div className="col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setMostrarDistribuicaoSOI((prev) => {
                          const next = !prev;
                          if (!next) {
                            setDistribuicoesSOI([]);
                          }
                          return next;
                        });
                      }}
                    >
                      {mostrarDistribuicaoSOI ? "Ocultar Distribuição" : "Distribuir entre Contas"}
                    </Button>
                  </div>
                )}

                {mostrarDistribuicaoSOI && liquidoSOICalculado > 0 && (
                  <div className="col-span-2">
                    <DistribuicaoContas
                      liquidoOperacao={liquidoSOICalculado}
                      contasBancarias={contasBancarias}
                      distribuicoes={distribuicoesSOI}
                      onChange={setDistribuicoesSOI}
                    />
                  </div>
                )}

                {liquidoSOICalculado > 0 && (
                  <div className="col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setMostrarDistribuicaoEstoquesSOI((prev) => {
                          const next = !prev;
                          if (!next) {
                            setEstoqueDestinoSOI("");
                          }
                          return next;
                        });
                      }}
                    >
                      {mostrarDistribuicaoEstoquesSOI ? "Ocultar Distribuição de Estoques" : "Distribuir Entre Estoques"}
                    </Button>
                  </div>
                )}

                {mostrarDistribuicaoEstoquesSOI && liquidoSOICalculado > 0 && (
                  <div className="col-span-2 space-y-3 rounded-md border p-4">
                    <div>
                      <Label htmlFor="estoque-destino-soi">Estoque Destino</Label>
                      <Select
                        value={estoqueDestinoSOI}
                        onValueChange={setEstoqueDestinoSOI}
                      >
                        <SelectTrigger id="estoque-destino-soi">
                          <SelectValue placeholder="Selecione o estoque destino..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(() => {
                            logger.debug('🔍 Debug Estoque Destino SOI:');
                            logger.debug('- estoquesSelect:', estoquesSelect);
                            logger.debug('- Total de estoques:', estoquesSelect?.length || 0);
                            logger.debug('- formDataSOI.estoque_id:', formDataSOI.estoque_id);
                            
                            const estoquesFiltrados = (estoquesSelect || []).filter((estoque) => {
                              const tipoNormalizado = estoque.tipo?.toUpperCase();
                              const isSPPRO = tipoNormalizado === 'SPPRO';
                              const isDifferent = estoque.id.toString() !== formDataSOI.estoque_id;
                              
                              logger.debug(`  Estoque ${estoque.id} (${estoque.tipo}): SPPRO=${isSPPRO}, Diferente=${isDifferent}`);
                              
                              return isSPPRO && isDifferent;
                            });
                            
                            logger.debug('- Estoques SPPRO filtrados:', estoquesFiltrados.length);
                            logger.debug('- Estoques filtrados:', estoquesFiltrados);
                            
                            if (estoquesFiltrados.length === 0) {
                              return (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                  Nenhum estoque SPPRO disponível
                                </div>
                              );
                            }
                            
                            return estoquesFiltrados.map((estoque) => (
                              <SelectItem key={estoque.id} value={estoque.id.toString()}>
                                {estoque.descricao || `Estoque #${estoque.id}`}
                              </SelectItem>
                            ));
                          })()}
                        </SelectContent>
                      </Select>
                    </div>

                    {estoqueDestinoSOI && (
                      <div>
                        <Label htmlFor="valor-transferencia-soi">Valor a Transferir</Label>
                        <Input
                          id="valor-transferencia-soi"
                          type="text"
                          value={liquidoSOICalculado.toFixed(2)}
                          readOnly
                          className="bg-muted font-bold"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Label htmlFor="documento_soi">Documento</Label>
                  <Input
                    id="documento_soi"
                    value={formDataSOI.documento}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, documento: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="historico_soi">Histórico</Label>
                  <Textarea
                    id="historico_soi"
                    value={formDataSOI.historico}
                    onChange={(e) => setFormDataSOI({ ...formDataSOI, historico: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setSelectedOperacao(null);
                    resetFormSOI(ultimoEstoquePorTipo.SOI);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createOperacao.isPending}>
                  {createOperacao.isPending ? "Salvando..." : selectedOperacao ? "Atualizar" : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir operação de estoque</AlertDialogTitle>
              <AlertDialogDescription>
                Deseja excluir esta operação de estoque? Esta ação não pode ser desfeita e o saldo do estoque será ajustado automaticamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setOperacaoToDelete(null);
                }}
              >
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteOperacao}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Dialog para Operações do Fornecedor */}
        {selectedFornecedor && empresaId && (
          <OperacoesFornecedorDialog
            open={fornecedorDialogOpen}
            onOpenChange={(open) => {
              setFornecedorDialogOpen(open);
              if (!open) {
                setPendingImportFileId(null);
                setPendingImportClientCnpj(null);
                setPendingImportOperationNumber(null);
                setPendingImportTargetProgram(null);
              }
            }}
            fornecedorId={selectedFornecedor.id}
            fornecedorNome={selectedFornecedor.nome}
            tipoEstoque={tipoEstoqueDialog}
            empresaId={empresaId}
            estoquesSelect={estoquesSelect || []}
            contasBancarias={contasBancarias}
            initialImportFileId={pendingImportFileId}
            onEditOperacao={(operacao) => {
              if (tipoEstoqueDialog === "SPPRO") {
                handleEditOperacaoSPPRO(operacao);
              } else {
                handleEditOperacaoSOI(operacao);
              }
            }}
            onDeleteOperacao={(operacao) => {
              setOperacaoToDelete(operacao);
              setIsDeleteDialogOpen(true);
            }}
          />
        )}

        {/* Dialog para Selecionar Fornecedor */}
        <Dialog open={selecionarFornecedorDialogOpen} onOpenChange={setSelecionarFornecedorDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Selecionar Fornecedor</DialogTitle>
              <DialogDescription>
                {pendingImportFileId
                  ? `Selecione o fornecedor para usar o PDF importado${
                      pendingImportOperationNumber ? ` da operação ${pendingImportOperationNumber}` : ''
                    }.`
                  : `Selecione o fornecedor para criar uma nova operação ${tipoEstoqueDialog}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {pendingImportFileId && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
                  {pendingImportClientCnpj
                    ? `CNPJ extraído do PDF: ${pendingImportClientCnpj}. Selecione o fornecedor correspondente.`
                    : 'CNPJ do cliente não identificado no PDF. Selecione manualmente o fornecedor.'}
                </div>
              )}
              {isLoadingFornecedores ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Carregando fornecedores...</span>
                </div>
              ) : !todosFornecedores || todosFornecedores.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhum fornecedor cadastrado.
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto space-y-2">
                  {todosFornecedores.map((fornecedor) => (
                    <Button
                      key={fornecedor.id}
                      variant="outline"
                      className="w-full justify-start h-auto p-4"
                      onClick={() => {
                        handleOpenFornecedorDialog(
                          fornecedor.id.toString(),
                          fornecedor.nome_fantasia || fornecedor.razao_social,
                          pendingImportFileId
                        );
                        setSelecionarFornecedorDialogOpen(false);
                      }}
                    >
                      <div className="flex flex-col items-start text-left">
                        <span className="font-semibold">{fornecedor.nome_fantasia || fornecedor.razao_social}</span>
                        {fornecedor.nome_fantasia && fornecedor.razao_social !== fornecedor.nome_fantasia && (
                          <span className="text-sm text-muted-foreground">{fornecedor.razao_social}</span>
                        )}
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setSelecionarFornecedorDialogOpen(false);
                  setPendingImportFileId(null);
                  setPendingImportClientCnpj(null);
                  setPendingImportOperationNumber(null);
                  setPendingImportTargetProgram(null);
                }}
              >
                Cancelar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
