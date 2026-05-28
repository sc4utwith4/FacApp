import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID, isConflictError } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { CRITICAL_FINANCIAL_QUERY_POLICY } from "@/lib/queryPolicies";
import { Plus, Edit, Trash2, CreditCard, Building2, Wallet, Warehouse, ChevronDown, ChevronRight, Loader2, ArrowLeftRight } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { 
  useDevolucoesTotais,
  useEstoquesResumo, 
  useOperacoesEstoque
} from "@/hooks/useEstoque";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { DevolucaoEstoqueDialog } from "@/components/estoque/DevolucaoEstoqueDialog";

interface ContaBancaria {
  id: string;
  banco_id: number;
  descricao: string;
  saldo_inicial: number;
  saldo_atual?: number | null;
  status: boolean;
  created_at: string;
  bancos?: {
    nome: string;
    codigo: string;
  };
}

interface Banco {
  id: number;
  nome: string;
  codigo: string;
  ispb: string;
}

interface LancamentoConta {
  id: string;
  data: string;
  tipo: "entrada" | "saida";
  valor: number;
  historico: string | null;
  observacoes: string | null;
}

export default function ContasEstoques() {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDevolucaoDialogOpen, setIsDevolucaoDialogOpen] = useState(false);
  const [expandedEstoques, setExpandedEstoques] = useState<Set<string>>(new Set());
  const [editingConta, setEditingConta] = useState<ContaBancaria | null>(null);
  const [contaToDelete, setContaToDelete] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    banco_id: "",
    descricao: "",
    saldo_inicial: "",
    status: true,
  });

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const toggleEstoqueExpansion = (tipo: string) => {
    setExpandedEstoques(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tipo)) {
        newSet.delete(tipo);
      } else {
        newSet.add(tipo);
      }
      return newSet;
    });
  };

  const {
    data: contasData,
    isLoading: isLoadingContas,
    error: contasError,
  } = useQuery<ContaBancaria[]>({
    queryKey: ["contas-bancarias", empresaId],
    enabled: !!empresaId && isValidUUID(empresaId),
    ...CRITICAL_FINANCIAL_QUERY_POLICY,
    queryFn: async () => {
      if (!empresaId || !isValidUUID(empresaId)) {
        throw new Error("Empresa não encontrada");
      }

      const { data, error } = await supabase
        .from("contas_bancarias")
        .select(
          `
            *,
            bancos (
              nome,
              codigo
            )
          `
        )
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return (data || []) as ContaBancaria[];
    },
  });

  const contas = contasData ?? [];
  const contasErrorMessage = contasError instanceof Error ? contasError.message : null;
  const [expandedContas, setExpandedContas] = useState<string[]>([]);

  const toggleConta = (id: string) => {
    setExpandedContas((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const contasVisiveis = contas;
  const contasAtivas = contasVisiveis.filter((conta) => conta.status);
  const contasInativas = contasVisiveis.filter((conta) => !conta.status);
  const totalSaldoAtual = contasVisiveis.reduce(
    (acc, conta) => {
      const saldo = conta.saldo_atual !== null && conta.saldo_atual !== undefined
        ? conta.saldo_atual
        : (conta.saldo_inicial ?? 0);
      return acc + saldo;
    },
    0
  );
  const { data: resumo, isLoading: isLoadingResumo, error: resumoError } = useEstoquesResumo();
  const {
    data: devolucoesTotais,
    isError: devolucoesTotaisError,
  } = useDevolucoesTotais();
  const [activeTab, setActiveTab] = useState<"contas" | "estoque">("contas");
  // Devoluções por tipo vêm da fonte determinística (valor restante); fallback no resumo legado em caso de erro.
  const resumoEstoque = useMemo(() => {
    const sppro = resumo?.sppro ?? 0;
    const soi = resumo?.soi ?? 0;
    const devolucoesSppro = devolucoesTotaisError
      ? (resumo?.devolucoesSppro ?? 0)
      : (devolucoesTotais?.sppro ?? resumo?.devolucoesSppro ?? 0);
    const devolucoesSoi = devolucoesTotaisError
      ? (resumo?.devolucoesSoi ?? 0)
      : (devolucoesTotais?.soi ?? resumo?.devolucoesSoi ?? 0);
    const devolucoesNaoClassificado = devolucoesTotaisError
      ? 0
      : (devolucoesTotais?.naoClassificado ?? 0);
    const devolucoes = devolucoesTotaisError
      ? (resumo?.devolucoes ?? 0)
      : (devolucoesTotais?.total ?? resumo?.devolucoes ?? 0);
    return {
      sppro,
      soi,
      devolucoesSppro,
      devolucoesSoi,
      devolucoesNaoClassificado,
      devolucoes,
      total: sppro + soi + devolucoes,
    };
  }, [
    devolucoesTotais?.naoClassificado,
    devolucoesTotais?.soi,
    devolucoesTotais?.sppro,
    devolucoesTotais?.total,
    devolucoesTotaisError,
    resumo?.devolucoes,
    resumo?.devolucoesSoi,
    resumo?.devolucoesSppro,
    resumo?.soi,
    resumo?.sppro,
  ]);
  const estoqueResumoRows = useMemo(
    () => [
      {
        tipo: "SPPRO" as const,
        saldo: resumoEstoque.sppro,
      },
      {
        tipo: "SOI" as const,
        saldo: resumoEstoque.soi,
      },
    ],
    [resumoEstoque.soi, resumoEstoque.sppro]
  );

  useEffect(() => {
    fetchEmpresaId();
    fetchBancos();
  }, []);

  useEffect(() => {
    if (resumoError) {
      logger.error("Erro ao carregar resumo dos estoques:", resumoError);
    }
  }, [resumoError]);

  useEffect(() => {
    if (contasError) {
      logger.error("Erro ao carregar contas:", contasError);
    }
  }, [contasError]);

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
        logger.error("Erro ao buscar empresa_id:", error);
        return;
      }
      
      // Se perfil não existe, criar automaticamente
      if (!profile) {
        const empresaIdPadrao = '00000000-0000-0000-0000-000000000001';
        const nomeUsuario = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
        
        const { error: insertError } = await supabase
          .from("profiles")
          .insert({
            id: session.user.id,
            empresa_id: empresaIdPadrao,
            nome: nomeUsuario,
            email: session.user.email || '',
            perfil: 'Admin',
          });
        
        if (insertError) {
          // Se o erro for 409 (Conflict), o perfil já existe, então buscar novamente
          if (isConflictError(insertError)) {
            // Perfil já existe, buscar novamente
            const { data: existingProfile } = await supabase
              .from("profiles")
              .select("empresa_id")
              .eq("id", session.user.id)
              .maybeSingle();
            
            if (existingProfile && existingProfile.empresa_id) {
              const empresaIdValue = ensureUUID(existingProfile.empresa_id);
              if (empresaIdValue) {
                setEmpresaId(empresaIdValue);
                return;
              }
            }
          } else {
            logger.error("Erro ao criar perfil:", insertError);
            toast.error("Erro ao criar perfil. Entre em contato com o administrador.");
            return;
          }
        }
        
        // Após criar, buscar novamente
        const { data: newProfile } = await supabase
          .from("profiles")
          .select("empresa_id")
          .eq("id", session.user.id)
          .maybeSingle();
        
        if (newProfile?.empresa_id) {
          const empresaIdValue = ensureUUID(newProfile.empresa_id);
          if (empresaIdValue) {
            setEmpresaId(empresaIdValue);
            return;
          }
        }
        return;
      }
      
      // Se perfil existe, validar empresa_id
      if (profile.empresa_id) {
        const empresaIdValue = ensureUUID(profile.empresa_id);
        if (!empresaIdValue) {
          logger.error('empresa_id não é UUID válido:', profile.empresa_id, typeof profile.empresa_id);
          toast.error("Erro: empresa_id inválido no perfil. Contate o administrador.");
          return;
        }
        setEmpresaId(empresaIdValue);
      }
    } catch (error) {
      logger.error("Erro ao buscar empresa_id:", error);
    }
  };

  const fetchBancos = async () => {
    const { data, error } = await supabase
      .from("bancos")
      .select("*")
      .order("nome");
    
    if (error) {
      toast.error("Erro ao carregar bancos");
      return;
    }
    
    setBancos(data || []);
  };

  // ============================================
  // FUNÇÕES AUXILIARES DE FORMATAÇÃO MONETÁRIA
  // ============================================
  
  /**
   * Remove formatação de moeda e retorna apenas números
   * Ex: "R$ 1.500,50" -> "1500.50"
   * Ex: "1500,50" -> "1500.50"
   * Ex: "1500.50" -> "1500.50"
   * Ex: "2.500,75" -> "2500.75"
   */
  const parseMonetaryValue = (value: string): string => {
    if (!value || typeof value !== 'string') return '';
    
    // Remove tudo exceto dígitos, ponto e vírgula
    let cleaned = value.replace(/[^\d,.-]/g, '').trim();
    
    if (cleaned === '' || cleaned === '-') return '';
    
    // Detectar formato brasileiro (vírgula como separador decimal)
    // Se tiver vírgula, assumir formato brasileiro: "1.500,75"
    if (cleaned.includes(',')) {
      // Remover todos os pontos (separadores de milhar) e substituir vírgula por ponto
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Se não tiver vírgula mas tiver ponto, pode ser formato americano ou brasileiro sem decimais
    // Nesse caso, manter como está
    
    return cleaned;
  };

  /**
   * Converte string monetária para número
   * Ex: "1.500,50" ou "1500.50" -> 1500.50
   * Ex: "2.500,75" -> 2500.75
   */
  const parseNumericValue = (value: string | number | undefined | null): number => {
    if (value === null || value === undefined || value === '') {
      return 0;
    }
    if (typeof value === 'number') {
      return isNaN(value) ? 0 : value;
    }
    
    const strValue = String(value).trim();
    if (strValue === '' || strValue === '-') {
      return 0;
    }
    
    // Primeiro, parsear valor monetário
    const cleaned = parseMonetaryValue(strValue);
    if (cleaned === '' || cleaned === '-') {
      return 0;
    }
    
    const parsed = Number.parseFloat(cleaned);
    if (isNaN(parsed)) {
      logger.warn('⚠️ parseNumericValue: valor não pôde ser parseado:', value, '-> cleaned:', cleaned);
      return 0;
    }
    
    return parsed;
  };

  /**
   * Formata número para exibição monetária brasileira
   * Ex: 1500.50 -> "1.500,50"
   * Se o valor for 0, retorna string vazia para permitir que o usuário digite
   */
  const formatMonetaryValue = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    
    const numValue = typeof value === 'string' ? parseNumericValue(value) : value;
    if (isNaN(numValue)) {
      return '';
    }
    
    // Se for 0, retornar string vazia para permitir que o usuário digite
    if (numValue === 0) {
      return '';
    }
    
    // Formatar com 2 casas decimais e separadores brasileiros
    return numValue.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  /**
   * Normaliza valor monetário antes de salvar
   * Garante que o valor seja um número válido
   * Aceita valores formatados brasileiros (ex: "2.500,75") e converte para número
   */
  const normalizeMonetaryValue = (value: string | number | null | undefined): number => {
    if (value === null || value === undefined) {
      return 0;
    }
    
    if (typeof value === 'number') {
      return isNaN(value) ? 0 : value;
    }
    
    const strValue = String(value).trim();
    if (strValue === '' || strValue === '-') {
      return 0;
    }
    
    const parsed = parseNumericValue(strValue);
    
    // Log para debug (apenas em desenvolvimento)
    if (strValue !== String(parsed)) {
      logger.debug('🔍 normalizeMonetaryValue:', strValue, '->', parsed);
    }
    
    return parsed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaId) {
      toast.error("Empresa não encontrada. Aguarde o carregamento ou faça login novamente.");
      return;
    }

    if (!isValidUUID(empresaId)) {
      logger.error('empresaId inválido para insert conta:', empresaId, typeof empresaId);
      toast.error("Erro: empresa_id inválido. Recarregue a página.");
      return;
    }

    // Validar banco_id
    if (!formData.banco_id) {
      toast.error("Selecione um banco.");
      return;
    }

    try {
      // Capturar valor do estado - pode estar formatado ou não
      let saldoInicialRaw = formData.saldo_inicial || '';
      
      // Se o valor estiver vazio mas estamos editando, usar o valor original da conta
      // Isso evita que valores existentes sejam zerados acidentalmente
      if (editingConta && (!saldoInicialRaw || saldoInicialRaw.trim() === '')) {
        const valorOriginal = editingConta.saldo_inicial ?? 0;
        if (typeof valorOriginal === 'string') {
          saldoInicialRaw = valorOriginal;
        } else {
          saldoInicialRaw = valorOriginal > 0 ? String(valorOriginal) : '';
        }
        logger.debug('⚠️ Valor vazio no UPDATE, usando valor original:', valorOriginal);
      }
      
      // Normalizar e converter saldo_inicial usando a função auxiliar
      // Esta função lida corretamente com valores formatados brasileiros (ex: "2.500,75")
      const saldoInicialValue = normalizeMonetaryValue(saldoInicialRaw);
      
      // Logs detalhados para debug
      logger.debug('=== DEBUG: Salvando Conta Bancária ===');
      logger.debug('Modo:', editingConta ? 'UPDATE' : 'INSERT');
      logger.debug('FormData.saldo_inicial (raw):', formData.saldo_inicial);
      logger.debug('saldoInicialRaw (processado):', saldoInicialRaw);
      logger.debug('saldoInicialValue (normalizado):', saldoInicialValue);
      logger.debug('Tipo:', typeof saldoInicialValue);
      
      // Validação: garantir que o valor seja um número válido
      if (isNaN(saldoInicialValue)) {
        logger.error('❌ ERRO: saldo_inicial não pôde ser convertido para número:', saldoInicialRaw);
        toast.error("Erro: Saldo inicial inválido. Verifique o valor informado.");
        return;
      }

      // Preparar payload - garantir que saldo_inicial seja sempre um número válido
      const dataToSave: {
        banco_id: number;
        descricao: string | null;
        saldo_inicial: number;
        status: boolean;
        empresa_id: string;
      } = {
        banco_id: Number.parseInt(formData.banco_id, 10),
        descricao: formData.descricao || null,
        saldo_inicial: saldoInicialValue, // Já normalizado e validado acima
        status: formData.status,
        empresa_id: empresaId,
      };

      logger.debug('Payload completo a ser enviado:', JSON.stringify(dataToSave, null, 2));

      if (editingConta) {
        logger.debug('=== UPDATE: Enviando para Supabase ===');
        logger.debug('ID da conta:', editingConta.id);
        logger.debug('Payload completo:', JSON.stringify(dataToSave, null, 2));
        logger.debug('saldo_inicial no payload:', dataToSave.saldo_inicial, 'tipo:', typeof dataToSave.saldo_inicial);
        
        const { error, data } = await supabase
          .from("contas_bancarias")
          .update(dataToSave)
          .eq("id", editingConta.id)
          .select();

        if (error) {
          logger.error("❌ ERRO ao atualizar conta:", error);
          logger.error("Detalhes do erro:", JSON.stringify(error, null, 2));
          logger.error("Payload que causou erro:", JSON.stringify(dataToSave, null, 2));
          throw error;
        }
        
        logger.debug("✅ Conta atualizada com sucesso!");
        logger.debug("Dados retornados do Supabase:", data);
        if (data && data[0]) {
          const saldoInicialRetornado = Number(data[0].saldo_inicial);
          logger.debug("saldo_inicial salvo:", saldoInicialRetornado, 'tipo:', typeof saldoInicialRetornado);
          logger.debug("saldo_atual salvo:", data[0].saldo_atual);
          
          // Verificar se o valor foi realmente atualizado
          const diferenca = Math.abs(saldoInicialRetornado - saldoInicialValue);
          if (diferenca > 0.01) { // Tolerância para diferenças de arredondamento
            logger.warn('⚠️ ATENÇÃO: saldo_inicial pode não ter sido atualizado corretamente!');
            logger.warn('Valor esperado:', saldoInicialValue);
            logger.warn('Valor retornado:', saldoInicialRetornado);
            logger.warn('Diferença:', diferenca);
          } else {
            logger.debug('✅ saldo_inicial atualizado corretamente!');
          }
        }
        
        toast.success("Conta atualizada com sucesso!");
        
        // Invalidar cache e forçar refetch para garantir atualização da UI
        // Usar refetchQueries com await para garantir que a query seja atualizada antes de fechar o dialog
        await queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
        const refetchResult = await queryClient.refetchQueries({ 
          queryKey: ["contas-bancarias", empresaId],
          exact: true 
        });
        
        logger.debug('✅ Cache invalidado e queries refetchadas');
        logger.debug('Resultado do refetch:', refetchResult);
        
        // Aguardar um pouco para garantir que o estado foi atualizado
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        const { error, data } = await supabase
          .from("contas_bancarias")
          .insert({
            ...dataToSave,
            saldo_atual: saldoInicialValue,
          })
          .select();

        if (error) {
          logger.error("Erro ao criar conta:", error);
          throw error;
        }
        
        if (data) {
          logger.debug("Conta criada:", data[0]);
        }
        
        toast.success("Conta criada com sucesso!");
      }

      setIsDialogOpen(false);
      resetForm();
      
      // Invalidar cache após INSERT também
      if (!editingConta) {
        await queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
      }
    } catch (error: unknown) {
      logger.error("Erro ao salvar conta:", error);
      
      // Mensagem de erro mais específica
      const errorMessage = (error instanceof Error ? error.message : String(error)) || "Erro ao salvar conta bancária";
      toast.error(errorMessage.includes("saldo_inicial") 
        ? "Erro ao salvar saldo inicial. Verifique o valor informado." 
        : errorMessage);
    }
  };
  const handleDelete = async () => {
    if (!contaToDelete) return;

    try {
      const { error } = await supabase
        .from("contas_bancarias")
        .delete()
        .eq("id", contaToDelete);

      if (error) throw error;

      toast.success("Conta excluída com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
    } catch (error) {
      logger.error("Erro ao excluir conta:", error);
      toast.error("Erro ao excluir conta. Verifique se não há lançamentos associados.");
    } finally {
      setIsDeleteDialogOpen(false);
      setContaToDelete(null);
    }
  };
  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleEdit = (conta: ContaBancaria) => {
    setEditingConta(conta);
    
    // Garantir que saldo_inicial seja tratado corretamente (pode ser null, undefined ou 0)
    // Converter para número se for string (pode vir do banco como string)
    let saldoInicial: number = 0;
    if (conta.saldo_inicial !== null && conta.saldo_inicial !== undefined) {
      if (typeof conta.saldo_inicial === 'string') {
        saldoInicial = parseNumericValue(conta.saldo_inicial);
      } else {
        saldoInicial = Number(conta.saldo_inicial) || 0;
      }
    }
    
    // Formatar o valor para exibição monetária brasileira
    const saldoInicialFormatado = formatMonetaryValue(saldoInicial);
    
    // Log para debug
    logger.debug('=== DEBUG: Carregando conta para edição ===');
    logger.debug('saldo_inicial original:', conta.saldo_inicial, 'tipo:', typeof conta.saldo_inicial);
    logger.debug('saldo_inicial convertido:', saldoInicial);
    logger.debug('saldo_inicial formatado:', saldoInicialFormatado);
    
    setFormData({
      banco_id: conta.banco_id.toString(),
      descricao: conta.descricao || '',
      saldo_inicial: saldoInicialFormatado,
      status: conta.status,
    });
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (id: string) => {
    setContaToDelete(id);
    setIsDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setEditingConta(null);
    setFormData({
      banco_id: "",
      descricao: "",
      saldo_inicial: "",
      status: true,
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };


  return (
    <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Contas e Estoque</h1>
            <p className="text-muted-foreground max-w-2xl">
              Centralize a visualização dos saldos bancários e dos estoques SPPRO/SOI. Use as abas para alternar entre o panorama das contas e o resumo dos estoques.
            </p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} className="self-start">
                <Plus className="mr-2 h-4 w-4" />
                Nova Conta
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editingConta ? "Editar Conta Bancária" : "Nova Conta Bancária"}
                </DialogTitle>
                <DialogDescription>
                  {editingConta 
                    ? "Atualize as informações da conta bancária" 
                    : "Preencha os dados para criar uma nova conta bancária"}
                </DialogDescription>
              </DialogHeader>
              <form 
                onSubmit={(e) => {
                  // Normalizar o valor antes do submit para garantir que seja capturado corretamente
                  const saldoInicialInput = e.currentTarget.querySelector('#saldo_inicial') as HTMLInputElement;
                  if (saldoInicialInput && saldoInicialInput.value) {
                    const value = saldoInicialInput.value.trim();
                    if (value && value !== '' && value !== '-') {
                      const numValue = normalizeMonetaryValue(value);
                      if (numValue > 0) {
                        const formatted = formatMonetaryValue(numValue);
                        setFormData((prev) => ({ ...prev, saldo_inicial: formatted }));
                      }
                    }
                  }
                  handleSubmit(e);
                }} 
                className="space-y-4"
              >
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="banco">Banco *</Label>
                    <Select
                      value={formData.banco_id}
                      onValueChange={(value) => setFormData({ ...formData, banco_id: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o banco..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {bancos.map((banco) => (
                          <SelectItem key={banco.id} value={banco.id.toString()}>
                            {banco.codigo ? `${banco.codigo} - ` : ""}{banco.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="descricao">Descrição</Label>
                    <Input
                      id="descricao"
                      value={formData.descricao}
                      onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                      placeholder="Ex: Conta Principal, Conta Poupança..."
                    />
                  </div>

                  <div>
                    <Label htmlFor="saldo_inicial">Saldo Inicial (R$)</Label>
                    <Input
                      id="saldo_inicial"
                      type="text"
                      inputMode="decimal"
                      value={formData.saldo_inicial}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Permitir apenas números, vírgula e ponto durante a digitação
                        // Remover caracteres inválidos mas manter formatação básica
                        const cleaned = value.replace(/[^\d,.-]/g, '');
                        setFormData((prev) => ({ ...prev, saldo_inicial: cleaned }));
                      }}
                      onBlur={(e) => {
                        // Formatar o valor ao sair do campo
                        const value = e.target.value.trim();
                        if (value === '' || value === '-') {
                          // Se estiver vazio, manter vazio (não limpar se estiver editando)
                          if (!editingConta) {
                            setFormData((prev) => ({ ...prev, saldo_inicial: '' }));
                          }
                        } else {
                          // Parsear e formatar o valor
                          const numValue = normalizeMonetaryValue(value);
                          if (numValue === 0) {
                            // Se o valor parseado for 0, limpar apenas se não estiver editando
                            if (!editingConta) {
                              setFormData((prev) => ({ ...prev, saldo_inicial: '' }));
                            }
                          } else {
                            // Formatar para exibição monetária brasileira
                            const formatted = formatMonetaryValue(numValue);
                            setFormData((prev) => ({ ...prev, saldo_inicial: formatted }));
                          }
                        }
                      }}
                      placeholder="0,00"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <Switch
                      id="status"
                      checked={formData.status}
                      onCheckedChange={(checked) => setFormData({ ...formData, status: checked })}
                    />
                    <Label htmlFor="status" className="cursor-pointer">
                      Conta Ativa
                    </Label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">
                    {editingConta ? "Atualizar" : "Criar"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "contas" | "estoque")} className="space-y-6">
          <TabsList className="w-fit">
            <TabsTrigger value="contas">Contas Bancárias</TabsTrigger>
            <TabsTrigger value="estoque">Estoques SPPRO/SOI</TabsTrigger>
          </TabsList>

          <TabsContent value="contas">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="animate-slide-up">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Contas</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                    <div className="text-2xl font-bold">{contasVisiveis.length}</div>
              <p className="text-xs text-muted-foreground">
                {contasAtivas.length} ativas
              </p>
            </CardContent>
          </Card>

          <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo Total Atual</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-success whitespace-nowrap">{formatCurrency(totalSaldoAtual)}</div>
              <p className="text-xs text-muted-foreground">
                Soma dos saldos atuais das contas listadas
              </p>
            </CardContent>
          </Card>

          <Card className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Contas Inativas</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{contasInativas.length}</div>
              <p className="text-xs text-muted-foreground">
                {contasVisiveis.length > 0 ? `${Math.round((contasInativas.length / contasVisiveis.length) * 100)}%` : "0%"} do total
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Contas Cadastradas</CardTitle>
            <CardDescription>
              Visualize e gerencie todas as suas contas bancárias
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingContas ? (
              <div className="py-12 text-center text-muted-foreground">Carregando contas bancárias...</div>
            ) : contasError ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center text-destructive">
                <div>
                  Erro ao carregar contas bancárias:{" "}
                  {contasErrorMessage ?? "tente novamente mais tarde."}
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ["contas-bancarias", empresaId] });
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : contasVisiveis.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-muted p-6 mb-4">
                  <CreditCard className="h-12 w-12 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  Nenhuma conta bancária cadastrada
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Comece adicionando sua primeira conta bancária
                </p>
                <Button onClick={openCreateDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  Criar Primeira Conta
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right min-w-[120px]">Saldo Atual</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                      {contasVisiveis.map((conta) => (
                    <ContaRow
                      key={conta.id}
                      conta={conta}
                      expanded={expandedContas.includes(conta.id)}
                      onToggle={toggleConta}
                      onEdit={handleEdit}
                      onDelete={openDeleteDialog}
                      formatCurrency={formatCurrency}
                      empresaId={empresaId}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
            </div>
          </TabsContent>

          <TabsContent value="estoque">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card className="animate-slide-up">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Saldo SPPRO</CardTitle>
                    <Warehouse className="h-4 w-4 text-blue-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg sm:text-xl font-bold text-blue-600 whitespace-nowrap">
                      {formatCurrency(resumoEstoque.sppro)}
                    </div>
                    <p className="text-xs text-muted-foreground">Saldo atual dos títulos SPPRO</p>
                  </CardContent>
                </Card>

                <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Saldo SOI</CardTitle>
                    <Warehouse className="h-4 w-4 text-purple-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg sm:text-xl font-bold text-purple-600 whitespace-nowrap">
                      {formatCurrency(resumoEstoque.soi)}
                    </div>
                    <p className="text-xs text-muted-foreground">Saldo atual das operações SOI</p>
                  </CardContent>
                </Card>

                <Card className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Estoque Devoluções SPPRO</CardTitle>
                    <ArrowLeftRight className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatCurrency(resumoEstoque.devolucoesSppro || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">Devoluções disponíveis SPPRO</p>
                  </CardContent>
                </Card>

                <Card className="animate-slide-up" style={{ animationDelay: "0.25s" }}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Estoque Devoluções SOI</CardTitle>
                    <ArrowLeftRight className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatCurrency(resumoEstoque.devolucoesSoi || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">Devoluções disponíveis SOI</p>
                  </CardContent>
                </Card>

                {resumoEstoque.devolucoesNaoClassificado > 0 && (
                  <Card className="animate-slide-up" style={{ animationDelay: "0.3s" }}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Devoluções Não Classificado</CardTitle>
                      <ArrowLeftRight className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-amber-600">
                        {formatCurrency(resumoEstoque.devolucoesNaoClassificado)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Devoluções disponíveis sem origem determinística
                      </p>
                    </CardContent>
                  </Card>
                )}

                <Card className="animate-slide-up" style={{ animationDelay: "0.4s" }}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Estoque</CardTitle>
                    <Wallet className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(resumoEstoque.total)}
                    </div>
                    <p className="text-xs text-muted-foreground">Soma dos estoques SPPRO + SOI + devoluções disponíveis</p>
                  </CardContent>
                </Card>
              </div>

              {devolucoesTotaisError && (
                <p className="text-xs text-amber-600">
                  Fallback ativo em devoluções: exibindo snapshot legado enquanto a fonte determinística está indisponível.
                </p>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Gestão de Estoques</CardTitle>
                  <CardDescription>
                    Atualize os saldos por meio de novas operações. As alterações refletirão imediatamente no módulo dedicado.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Tipo de Estoque</TableHead>
                        <TableHead className="text-right min-w-[120px]">Saldo Atual</TableHead>
                        <TableHead className="text-right">Operação</TableHead>
                        <TableHead className="text-right">Devolução</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {estoqueResumoRows.map(({ tipo, saldo }) => (
                        <EstoqueRow
                          key={tipo}
                          tipo={tipo}
                          saldo={saldo}
                          isLoadingResumo={isLoadingResumo}
                          expanded={expandedEstoques.has(tipo)}
                          onToggle={() => toggleEstoqueExpansion(tipo)}
                          onNavigate={() => navigate(`/operacoes?tab=${tipo}`)}
                          onOpenDevolucao={() => setIsDevolucaoDialogOpen(true)}
                          formatCurrency={formatCurrency}
                          empresaId={empresaId}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Dialog para registrar devolução */}
        <DevolucaoEstoqueDialog
          open={isDevolucaoDialogOpen}
          onOpenChange={setIsDevolucaoDialogOpen}
          lancamentoData={{
            data_devolucao: new Date().toISOString().split('T')[0],
            valor_devolucao: 0,
            observacoes: '',
            operacao_estoque_id: null,
            tipo_estoque_devolucao: undefined,
          }}
          empresaId={empresaId || ''}
        />

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
              <AlertDialogDescription>
                Contas com lançamentos associados não podem ser excluídas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}

type ContaRowProps = {
  conta: ContaBancaria;
  expanded: boolean;
  onToggle: (id: string) => void;
  onEdit: (conta: ContaBancaria) => void;
  onDelete: (id: string) => void;
  formatCurrency: (value: number) => string;
  empresaId: string | null;
};

function ContaRow({
  conta,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  formatCurrency,
  empresaId,
}: ContaRowProps) {
  const handleToggle = () => onToggle(conta.id);

  const {
    data: lancamentos,
    isLoading,
    error,
  } = useQuery<LancamentoConta[]>({
    queryKey: ["lancamentos-conta", empresaId, conta.id],
    enabled: expanded && !!empresaId && isValidUUID(empresaId),
    queryFn: async () => {
      if (!empresaId || !isValidUUID(empresaId)) {
        throw new Error("Empresa não encontrada");
      }

      const { data, error } = await supabase
        .from("lancamentos_caixa")
        .select("id, data, tipo, valor, historico, observacoes")
        .eq("empresa_id", empresaId)
        .eq("conta_bancaria_id", conta.id)
        .order("data", { ascending: false })
        .order("id", { ascending: false })
        .limit(50);

      if (error) {
        throw error;
      }

      return (data ?? []).map((item) => ({
        id: item.id?.toString?.() ?? String(item.id),
        data: item.data,
        tipo: (item.tipo ?? "entrada") as "entrada" | "saida",
        valor: Number(item.valor) || 0,
        historico: item.historico ?? null,
        observacoes: item.observacoes ?? null,
      })) as LancamentoConta[];
    },
  });

  const lancamentosList = lancamentos ?? [];
  const entradas = lancamentosList.filter((item) => item.tipo === "entrada");
  const saidas = lancamentosList.filter((item) => item.tipo === "saida");
  const totalEntradas = entradas.reduce((acc, item) => acc + item.valor, 0);
  const totalSaidas = saidas.reduce((acc, item) => acc + item.valor, 0);
  const movimentacoesErrorMessage = error instanceof Error ? error.message : null;

  const formatDate = (value: string) => {
    if (!value) return "-";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return value;
    }
  };

  return (
    <>
      <TableRow className="hover:bg-muted/50 transition-colors">
        <TableCell className="font-medium">
          <div className="flex items-start gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleToggle}
              aria-expanded={expanded}
              aria-label={expanded ? "Ocultar movimentações da conta" : "Mostrar movimentações da conta"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
            <div className="space-y-1">
              <div className="font-semibold leading-tight">{conta.descricao || "-"}</div>
              {conta.bancos?.nome && (
                <p className="text-xs text-muted-foreground">
                  {conta.bancos.nome}
                  {conta.bancos.codigo ? ` • ${conta.bancos.codigo}` : ""}
                </p>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right font-medium min-w-[120px] whitespace-nowrap">
          {formatCurrency(
            conta.saldo_atual !== null && conta.saldo_atual !== undefined
              ? conta.saldo_atual
              : (conta.saldo_inicial ?? 0)
          )}
        </TableCell>
        <TableCell>
          <Badge variant={conta.status ? "default" : "secondary"}>
            {conta.status ? "Ativa" : "Inativa"}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="icon" onClick={() => onEdit(conta)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(conta.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/40">
          <TableCell colSpan={4}>
            {isLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando movimentações da conta...
              </div>
            ) : error ? (
              <div className="py-6 text-sm text-destructive">
                Erro ao carregar movimentações: {movimentacoesErrorMessage ?? "tente novamente mais tarde."}
              </div>
            ) : lancamentosList.length === 0 ? (
              <div className="py-6 text-sm text-muted-foreground">
                Nenhuma movimentação encontrada para esta conta.
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-success/20 bg-success/5 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-success">Entradas</h4>
                      <span className="text-sm font-semibold text-success">
                        {formatCurrency(totalEntradas)}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {entradas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma entrada registrada.</p>
                      ) : (
                        entradas.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-md border border-success/30 bg-background p-3 text-sm shadow-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{formatDate(item.data)}</span>
                              <span className="font-semibold text-success">
                                {formatCurrency(item.valor)}
                              </span>
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {item.historico || "Sem histórico"}
                            </p>
                            {item.observacoes && (
                              <p className="mt-1 text-xs text-muted-foreground/80 italic">
                                {item.observacoes}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-destructive">Saídas</h4>
                      <span className="text-sm font-semibold text-destructive">
                        {formatCurrency(totalSaidas)}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {saidas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma saída registrada.</p>
                      ) : (
                        saidas.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-md border border-destructive/30 bg-background p-3 text-sm shadow-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{formatDate(item.data)}</span>
                              <span className="font-semibold text-destructive">
                                {formatCurrency(item.valor)}
                              </span>
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {item.historico || "Sem histórico"}
                            </p>
                            {item.observacoes && (
                              <p className="mt-1 text-xs text-muted-foreground/80 italic">
                                {item.observacoes}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

type EstoqueRowProps = {
  tipo: string;
  saldo: number;
  isLoadingResumo: boolean;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onOpenDevolucao: () => void;
  formatCurrency: (value: number) => string;
  empresaId: string | null;
};

function EstoqueRow({
  tipo,
  saldo,
  isLoadingResumo,
  expanded,
  onToggle,
  onNavigate,
  onOpenDevolucao,
  formatCurrency,
  empresaId,
}: EstoqueRowProps) {
  const { data: operacoes, isLoading: isLoadingOperacoes } = useOperacoesEstoque(
    empresaId || '',
    tipo as any,
    expanded
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  return (
    <>
      <TableRow>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label="Mostrar movimentações do estoque"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="font-semibold tracking-wide">{tipo}</TableCell>
        <TableCell className="text-right font-medium">
          {isLoadingResumo ? "..." : formatCurrency(saldo)}
        </TableCell>
        <TableCell className="text-right">
          <Button variant="outline" onClick={onNavigate}>
            Registrar operação
          </Button>
        </TableCell>
        <TableCell className="text-right">
          {(tipo === "SPPRO" || tipo === "SOI") && (
            <Button
              variant="outline"
              className="bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
              onClick={onOpenDevolucao}
            >
              Registrar devolução
            </Button>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={5} className="p-0">
            <div className="bg-muted/30 p-4">
              <h4 className="font-medium mb-3 text-sm text-muted-foreground">
                Operações {tipo}
              </h4>
              
              {isLoadingOperacoes && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">Carregando operações...</span>
                </div>
              )}

              {!isLoadingOperacoes && (!operacoes || operacoes.length === 0) && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Nenhuma operação encontrada para este estoque
                </div>
              )}

              {!isLoadingOperacoes && operacoes && operacoes.length > 0 && (
                <div className="space-y-2">
                  {operacoes.slice(0, 10).map((operacao) => (
                    <div
                      key={operacao.id}
                      className="flex items-center justify-between p-3 bg-background rounded-md border text-sm"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">#{operacao.id}</span>
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            operacao.tipo_operacao === 'entrada' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {operacao.tipo_operacao === 'entrada' ? 'Entrada' : 'Saída'}
                          </span>
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatDate(operacao.data)} • {operacao.fornecedores?.nome_fantasia || operacao.fornecedores?.razao_social || 'Sem fornecedor'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-medium ${
                          operacao.tipo_operacao === 'entrada' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(operacao.liquido_operacao)}
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {operacoes.length > 10 && (
                    <div className="text-center py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onNavigate}
                        className="text-xs"
                      >
                        Ver todas as {operacoes.length} operações
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
