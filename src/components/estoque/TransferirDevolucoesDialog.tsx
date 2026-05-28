import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { 
  useTransferirDevolucoesEstoque,
  useDevolucoesTransferiveis,
  useEstoquesSelect,
  useRepararInconsistenciasDevolucoesEstoque,
  useConsultarReconciliacaoDevolucoesEstoque,
} from "@/hooks/useEstoque";
import type { 
  DevolucaoTransferivel,
  TipoEstoque,
  TransferirDevolucoesInput,
  RepararInconsistenciasDevolucoesResultado,
  ConsultarReconciliacaoDevolucoesResultado,
} from "@/types/estoque";

interface ContaBancaria {
  id: string;
  descricao: string;
}

interface EstoqueSelect {
  id: number;
  tipo: TipoEstoque;
  descricao: string | null;
  saldo_atual: number;
}

interface TransferirDevolucoesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  contasBancarias: ContaBancaria[];
}

// Função utilitária para formatar moeda
const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || isNaN(value)) {
    return "R$ 0,00";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

// Função utilitária para formatar data
const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "-";
  try {
    const date = new Date(dateString + "T00:00:00");
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
};

const RECONCILIACAO_TIMEOUT_MS = 12_000;
const RECONCILIACAO_POLL_INTERVAL_MS = 3_500;

export function TransferirDevolucoesDialog({
  open,
  onOpenChange,
  empresaId: _empresaId,
  contasBancarias,
}: TransferirDevolucoesDialogProps) {
  void _empresaId;

  const [filtroTipo, setFiltroTipo] = useState<'TODAS' | 'SPPRO' | 'SOI' | 'NAO_CLASSIFICADO'>('TODAS');
  const [devolucoesSelecionadas, setDevolucoesSelecionadas] = useState<Map<number, number>>(new Map());
  const [formData, setFormData] = useState({
    data_transferencia: new Date().toISOString().split("T")[0],
    tipo_estoque: '' as '' | 'SPPRO' | 'SOI',
    destino_tipo: 'conta' as 'conta' | 'estoque',
    destino_id: '',
    historico: '',
    observacoes: '',
  });

  // Buscar devoluções transferíveis (valor_restante > 0) por RPC determinístico
  const {
    data: devolucoesTransferiveis,
    isLoading: isLoadingDevolucoes,
    error: erroDevolucoesTransferiveis,
  } = useDevolucoesTransferiveis();
  
  // Buscar estoques para select
  const { data: estoquesSelect, isLoading: isLoadingEstoques } = useEstoquesSelect();

  const transferirDevolucoes = useTransferirDevolucoesEstoque();
  const repararInconsistencias = useRepararInconsistenciasDevolucoesEstoque();
  const consultarReconciliacao = useConsultarReconciliacaoDevolucoesEstoque();
  const reconciliacaoExecutadaRef = useRef(false);
  const reconciliacaoRequestIdRef = useRef<string | null>(null);
  const reconciliacaoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconciliacaoPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconciliacaoPollingInFlightRef = useRef(false);
  const [statusReconciliacao, setStatusReconciliacao] = useState<
    'idle' | 'running' | 'running_background' | 'done' | 'error'
  >('idle');
  const [resumoReconciliacao, setResumoReconciliacao] = useState<RepararInconsistenciasDevolucoesResultado | null>(null);
  const [erroReconciliacao, setErroReconciliacao] = useState<string | null>(null);

  const limparAgendamentosReconciliacao = () => {
    if (reconciliacaoTimeoutRef.current) {
      clearTimeout(reconciliacaoTimeoutRef.current);
      reconciliacaoTimeoutRef.current = null;
    }
    if (reconciliacaoPollingRef.current) {
      clearInterval(reconciliacaoPollingRef.current);
      reconciliacaoPollingRef.current = null;
    }
    reconciliacaoPollingInFlightRef.current = false;
  };

  // Filtrar devoluções transferíveis com fonte de verdade determinística (valor_restante > 0)
  const devolucoesPendentes = useMemo(() => {
    if (!devolucoesTransferiveis) return [];

    return devolucoesTransferiveis.filter(dev => {
      if ((Number(dev.valor_restante) || 0) <= 0.01) return false;
      if (filtroTipo === 'TODAS') return true;
      return dev.tipo_origem_devolucao === filtroTipo;
    });
  }, [devolucoesTransferiveis, filtroTipo]);

  // Ordenar por LIFO (mais recentes primeiro)
  const devolucoesOrdenadas = useMemo(() => {
    return [...devolucoesPendentes].sort((a: DevolucaoTransferivel, b: DevolucaoTransferivel) => {
      const dataA = new Date(a.data_devolucao).getTime();
      const dataB = new Date(b.data_devolucao).getTime();
      if (dataA !== dataB) {
        return dataB - dataA; // Mais recente primeiro
      }
      return b.devolucao_id - a.devolucao_id; // Se mesma data, maior ID primeiro
    });
  }, [devolucoesPendentes]);

  const usandoFallbackLegado = useMemo(
    () => (devolucoesTransferiveis || []).some((dev) => dev.origem_dados === 'fallback_legacy'),
    [devolucoesTransferiveis],
  );

  const totalRestanteDeterministico = useMemo(
    () =>
      (devolucoesTransferiveis || []).reduce(
        (sum, dev) => sum + (Number(dev.valor_restante) || 0),
        0,
      ),
    [devolucoesTransferiveis],
  );

  const totalTransferivelAgora = useMemo(
    () =>
      (devolucoesTransferiveis || []).reduce(
        (sum, dev) => sum + (Number(dev.valor_transferivel_agora) || 0),
        0,
      ),
    [devolucoesTransferiveis],
  );

  const saldoDevolucoesAtual = useMemo(() => {
    const row = (devolucoesTransferiveis || []).find((dev) => dev.saldo_devolucoes_atual != null);
    return row?.saldo_devolucoes_atual ?? null;
  }, [devolucoesTransferiveis]);

  const haInconsistenciaSaldo = useMemo(() => {
    if (saldoDevolucoesAtual == null) return false;
    return totalRestanteDeterministico > Number(saldoDevolucoesAtual) + 0.01;
  }, [saldoDevolucoesAtual, totalRestanteDeterministico]);

  // Calcular valor total selecionado
  const valorTotalSelecionado = useMemo(() => {
    let total = 0;
    devolucoesSelecionadas.forEach((valor, devId) => {
      total += valor;
    });
    return total;
  }, [devolucoesSelecionadas]);

  const orcamentoDisponivelAgora = useMemo(
    () => Math.max(0, totalTransferivelAgora - valorTotalSelecionado),
    [totalTransferivelAgora, valorTotalSelecionado],
  );

  // Resetar formulário ao abrir/fechar
  useEffect(() => {
    if (open) {
      setDevolucoesSelecionadas(new Map());
      setFormData({
        data_transferencia: new Date().toISOString().split("T")[0],
        tipo_estoque: '',
        destino_tipo: 'conta',
        destino_id: '',
        historico: '',
        observacoes: '',
      });
      setFiltroTipo('TODAS');
      setStatusReconciliacao('idle');
      setResumoReconciliacao(null);
      setErroReconciliacao(null);
      reconciliacaoExecutadaRef.current = false;
      reconciliacaoRequestIdRef.current = null;
      limparAgendamentosReconciliacao();
    } else {
      reconciliacaoExecutadaRef.current = false;
      reconciliacaoRequestIdRef.current = null;
      limparAgendamentosReconciliacao();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!haInconsistenciaSaldo) return;
    if (usandoFallbackLegado) return;
    if (reconciliacaoExecutadaRef.current) return;

    let canceled = false;
    reconciliacaoExecutadaRef.current = true;
    const requestId = crypto.randomUUID();
    reconciliacaoRequestIdRef.current = requestId;

    const finalizarErro = (mensagem: string) => {
      setErroReconciliacao(mensagem);
      setStatusReconciliacao('error');
      limparAgendamentosReconciliacao();
    };

    const aplicarResultadoConsulta = (resultado: ConsultarReconciliacaoDevolucoesResultado) => {
      if ('mode' in resultado) {
        setResumoReconciliacao(resultado);
        setStatusReconciliacao('done');
        limparAgendamentosReconciliacao();
        return;
      }

      const status = String(resultado.status_execucao || '').toUpperCase();
      if (status === 'ERROR') {
        finalizarErro(resultado.error || 'Falha ao reconciliar histórico de devoluções.');
      }
    };

    const consultarStatus = async () => {
      const activeRequestId = reconciliacaoRequestIdRef.current;
      if (!activeRequestId) return;
      const resultado = await consultarReconciliacao.mutateAsync({ request_id: activeRequestId });
      if (canceled) return;
      aplicarResultadoConsulta(resultado);
    };

    const iniciarPolling = () => {
      if (reconciliacaoPollingRef.current) return;

      reconciliacaoPollingRef.current = setInterval(() => {
        if (reconciliacaoPollingInFlightRef.current) return;
        reconciliacaoPollingInFlightRef.current = true;
        consultarStatus()
          .catch((error) => {
            if (canceled) return;
            finalizarErro(
              error instanceof Error
                ? error.message
                : 'Erro ao consultar o status da reconciliação automática.'
            );
          })
          .finally(() => {
            reconciliacaoPollingInFlightRef.current = false;
          });
      }, RECONCILIACAO_POLL_INTERVAL_MS);
    };

    const executarReconciliacaoAutomatica = async () => {
      setStatusReconciliacao('running');
      setErroReconciliacao(null);
      setResumoReconciliacao(null);

      reconciliacaoTimeoutRef.current = setTimeout(() => {
        if (canceled) return;
        setStatusReconciliacao((current) => (current === 'running' ? 'running_background' : current));
        iniciarPolling();
        consultarStatus().catch((error) => {
          if (canceled) return;
          finalizarErro(
            error instanceof Error
              ? error.message
              : 'Erro ao consultar o status da reconciliação automática.'
          );
        });
      }, RECONCILIACAO_TIMEOUT_MS);

      try {
        const resultadoApply = await repararInconsistencias.mutateAsync({
          mode: 'apply',
          request_id: requestId,
          reconciliar_vinculos: true,
          recompor_saldo_residual: true,
          estrategia: 'LIFO_TIPO_DATA_STRITO',
          silent: true,
        });

        if (canceled) return;
        limparAgendamentosReconciliacao();
        setResumoReconciliacao(resultadoApply);
        setStatusReconciliacao('done');
      } catch (error) {
        if (canceled) return;
        finalizarErro(
          error instanceof Error ? error.message : 'Erro ao reconciliar histórico de devoluções.'
        );
      }
    };

    executarReconciliacaoAutomatica();

    return () => {
      canceled = true;
      limparAgendamentosReconciliacao();
    };
  }, [
    open,
    haInconsistenciaSaldo,
    usandoFallbackLegado,
    repararInconsistencias,
    consultarReconciliacao,
  ]);

  const motivosBloqueioResumo = useMemo(() => {
    if (!resumoReconciliacao?.bloqueios?.length) return '';
    const motivos = Array.from(new Set(resumoReconciliacao.bloqueios.map((item) => item.motivo)));
    return motivos.join(', ');
  }, [resumoReconciliacao]);

  // Atualizar tipo_estoque quando destino_tipo muda para estoque
  useEffect(() => {
    if (formData.destino_tipo === 'estoque' && formData.destino_id) {
      const estoque = estoquesSelect?.find(e => e.id === Number(formData.destino_id));
      if (estoque) {
        setFormData(prev => ({ ...prev, tipo_estoque: estoque.tipo === 'SPPRO' ? 'SPPRO' : 'SOI' }));
      }
    } else if (formData.destino_tipo === 'conta') {
      setFormData(prev => ({ ...prev, tipo_estoque: '' }));
    }
  }, [formData.destino_tipo, formData.destino_id, estoquesSelect]);

  const getMaxTransferivelParaDevolucao = (
    devolucao: DevolucaoTransferivel,
    mapaSelecionadas: Map<number, number>,
  ) => {
    const valorRestante = Math.max(0, Number(devolucao.valor_restante) || 0);
    const valorTransferivelAgora = Math.max(
      0,
      Number(devolucao.valor_transferivel_agora) || valorRestante,
    );
    const totalSemAtual = Array.from(mapaSelecionadas.entries()).reduce((sum, [id, valor]) => {
      if (id === devolucao.devolucao_id) return sum;
      return sum + (Number(valor) || 0);
    }, 0);
    const orcamentoLinha = Math.max(0, totalTransferivelAgora - totalSemAtual);

    return Math.max(0, Math.min(valorRestante, valorTransferivelAgora, orcamentoLinha));
  };

  const handleToggleDevolucao = (devolucao: DevolucaoTransferivel) => {
    const novoMap = new Map(devolucoesSelecionadas);
    if (novoMap.has(devolucao.devolucao_id)) {
      novoMap.delete(devolucao.devolucao_id);
      setDevolucoesSelecionadas(novoMap);
      return;
    }

    const valorMaximo = getMaxTransferivelParaDevolucao(devolucao, novoMap);
    if (valorMaximo <= 0.01) {
      toast.error('Sem saldo operacional disponível para transferir esta devolução agora.');
      return;
    }

    novoMap.set(devolucao.devolucao_id, valorMaximo);
    setDevolucoesSelecionadas(novoMap);
  };

  const handleValorParcial = (devolucao: DevolucaoTransferivel, valor: string) => {
    const novoMap = new Map(devolucoesSelecionadas);
    const valorNum = parseFloat(valor) || 0;

    if (valorNum <= 0) {
      novoMap.delete(devolucao.devolucao_id);
      setDevolucoesSelecionadas(novoMap);
      return;
    }

    const valorMaximo = getMaxTransferivelParaDevolucao(devolucao, novoMap);
    if (valorMaximo <= 0.01) {
      novoMap.delete(devolucao.devolucao_id);
      setDevolucoesSelecionadas(novoMap);
      toast.error('Sem saldo operacional disponível para esta devolução agora.');
      return;
    }

    const valorAjustado = Math.min(valorNum, valorMaximo);
    if (valorNum > valorMaximo + 0.001) {
      toast.error(`Valor ajustado para o máximo disponível agora: ${formatCurrency(valorMaximo)}`);
    }

    novoMap.set(devolucao.devolucao_id, valorAjustado);
    setDevolucoesSelecionadas(novoMap);
  };

  const handleSubmit = async () => {
    // Validações
    if (devolucoesSelecionadas.size === 0) {
      toast.error('Selecione pelo menos uma devolução para transferir');
      return;
    }

    if (!formData.data_transferencia) {
      toast.error('Data da transferência é obrigatória');
      return;
    }

    if (!formData.destino_id) {
      toast.error('Selecione o destino da transferência');
      return;
    }

    if (valorTotalSelecionado > totalTransferivelAgora + 0.01) {
      toast.error(
        `Total selecionado (${formatCurrency(valorTotalSelecionado)}) excede o disponível agora (${formatCurrency(totalTransferivelAgora)}).`,
      );
      return;
    }

    // Validar valores parciais
    for (const [devId, valorTransferir] of devolucoesSelecionadas.entries()) {
      const devolucao = devolucoesOrdenadas.find(d => d.devolucao_id === devId);
      if (!devolucao) {
        toast.error(`Devolução #${devId} não encontrada`);
        return;
      }

      const valorRestante = Number(devolucao.valor_restante) || 0;
      const valorTransferivelAgora = Number(devolucao.valor_transferivel_agora) || valorRestante;
      if (valorTransferir > valorRestante) {
        toast.error(`Valor a transferir (${formatCurrency(valorTransferir)}) excede o valor restante da devolução #${devId} (${formatCurrency(valorRestante)})`);
        return;
      }

      if (valorTransferir > valorTransferivelAgora) {
        toast.error(
          `Valor a transferir (${formatCurrency(valorTransferir)}) excede o disponível agora da devolução #${devId} (${formatCurrency(valorTransferivelAgora)}).`,
        );
        return;
      }

      if (valorTransferir <= 0) {
        toast.error(`Valor a transferir deve ser maior que zero para devolução #${devId}`);
        return;
      }

      // Validar data
      if (new Date(formData.data_transferencia) < new Date(devolucao.data_devolucao)) {
        toast.error(`Data da transferência não pode ser anterior à data da devolução #${devId}`);
        return;
      }
    }

    // Preparar dados para transferência
    const input: TransferirDevolucoesInput = {
      devolucoes_selecionadas: Array.from(devolucoesSelecionadas.entries()).map(([devId, valor]) => ({
        devolucao_id: devId,
        valor_transferir: valor,
      })),
      data_transferencia: formData.data_transferencia,
      tipo_estoque: formData.tipo_estoque || undefined,
      destino_tipo: formData.destino_tipo,
      destino_id: formData.destino_id,
      historico: formData.historico || undefined,
      observacoes: formData.observacoes || undefined,
    };

    try {
      await transferirDevolucoes.mutateAsync(input);
      onOpenChange(false);
    } catch (error: unknown) {
      // Erro já é tratado pelo hook
      console.error('Erro ao transferir devoluções:', error);
    }
  };

  // Filtrar estoques por tipo se necessário
  const estoquesFiltrados = useMemo(() => {
    if (!estoquesSelect) return [];
    if (formData.destino_tipo !== 'estoque') return [];
    if (!formData.tipo_estoque) return estoquesSelect.filter(e => e.tipo === 'SPPRO' || e.tipo === 'SOI');
    return estoquesSelect.filter(e => e.tipo === formData.tipo_estoque);
  }, [estoquesSelect, formData.destino_tipo, formData.tipo_estoque]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-orange-500" />
            Transferir Devoluções
          </DialogTitle>
          <DialogDescription>
            Selecione as devoluções que deseja transferir e escolha o destino (conta bancária ou estoque)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Filtro por tipo */}
          <div className="space-y-2">
            <Label>Filtrar por Tipo</Label>
            <Select
              value={filtroTipo}
              onValueChange={(value) => setFiltroTipo(value as 'TODAS' | 'SPPRO' | 'SOI' | 'NAO_CLASSIFICADO')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas</SelectItem>
                <SelectItem value="SPPRO">SPPRO</SelectItem>
                <SelectItem value="SOI">SOI</SelectItem>
                <SelectItem value="NAO_CLASSIFICADO">Não classificado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Lista de devoluções */}
          <div className="space-y-2">
            <Label>Devoluções Disponíveis ({devolucoesOrdenadas.length})</Label>
            {erroDevolucoesTransferiveis && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                Erro ao carregar lista de devoluções: {
                  erroDevolucoesTransferiveis instanceof Error
                    ? erroDevolucoesTransferiveis.message
                    : 'erro desconhecido'
                }
              </div>
            )}
            {usandoFallbackLegado && !erroDevolucoesTransferiveis && (
              <div className="rounded-md border border-orange-300 bg-orange-50 p-2 text-xs text-orange-800">
                Exibindo devoluções em modo legado por inconsistência no cálculo determinístico.
                Recomendado executar o saneamento de vínculos para normalizar os saldos.
              </div>
            )}
            {haInconsistenciaSaldo && saldoDevolucoesAtual != null && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Inconsistência detectada entre restante determinístico e saldo operacional do estoque DEVOLUCOES.
                Restante total: <strong>{formatCurrency(totalRestanteDeterministico)}</strong> | Saldo atual:
                <strong> {formatCurrency(Number(saldoDevolucoesAtual))}</strong>. A seleção será limitada ao
                disponível agora: <strong>{formatCurrency(totalTransferivelAgora)}</strong>.
              </div>
            )}
            {statusReconciliacao === 'running' && (
              <div className="rounded-md border border-blue-300 bg-blue-50 p-2 text-xs text-blue-900 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reconciliando histórico de devoluções automaticamente...
              </div>
            )}
            {statusReconciliacao === 'running_background' && (
              <div className="rounded-md border border-blue-300 bg-blue-50 p-2 text-xs text-blue-900 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reconciliando em segundo plano. Você pode continuar selecionando devoluções dentro do limite disponível agora.
              </div>
            )}
            {statusReconciliacao === 'done' && resumoReconciliacao && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
                Reconciliação concluída. Vínculos criados: <strong>{resumoReconciliacao.vinculos_criados}</strong> |{' '}
                movimentações bloqueadas: <strong>{resumoReconciliacao.movimentacoes_bloqueadas}</strong> | gap remanescente:{' '}
                <strong>{formatCurrency(resumoReconciliacao.gap_remanescente_bloqueado)}</strong>.
                {resumoReconciliacao.valor_recomposicao_aplicada > 0.01 && (
                  <span> Recomposição aplicada: <strong>{formatCurrency(resumoReconciliacao.valor_recomposicao_aplicada)}</strong>.</span>
                )}
                {resumoReconciliacao.gap_remanescente_bloqueado > 0.01 && (
                  <span> Motivos: <strong>{motivosBloqueioResumo || 'SEM_CANDIDATO_SUFICIENTE'}</strong>.</span>
                )}
              </div>
            )}
            {statusReconciliacao === 'error' && erroReconciliacao && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                Falha ao reconciliar histórico automaticamente: {erroReconciliacao}
              </div>
            )}
            <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-3">
              {isLoadingDevolucoes ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Carregando devoluções...</span>
                </div>
              ) : devolucoesOrdenadas.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Nenhuma devolução pendente disponível</p>
                </div>
              ) : (
                devolucoesOrdenadas.map((devolucao) => {
                  const isSelected = devolucoesSelecionadas.has(devolucao.devolucao_id);
                  const valorSelecionado = devolucoesSelecionadas.get(devolucao.devolucao_id) || 0;
                  const valorDevolucao = Number(devolucao.valor_devolucao) || 0;
                  const valorJaTransferido = Number(devolucao.valor_transferido_calculado) || 0;
                  const valorRestante = Number(devolucao.valor_restante) || 0;
                  const valorTransferivelAgora = Number(devolucao.valor_transferivel_agora) || valorRestante;
                  const tipoOrigem = devolucao.tipo_origem_devolucao || 'NAO_CLASSIFICADO';
                  const valorMaximoLinha = getMaxTransferivelParaDevolucao(devolucao, devolucoesSelecionadas);
                  const bloqueadaAgora = !isSelected && valorMaximoLinha <= 0.01;

                  return (
                    <div
                      key={devolucao.devolucao_id}
                      className={`border rounded-lg p-3 space-y-2 ${
                        isSelected ? 'bg-primary/5 border-primary' : 'bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          disabled={bloqueadaAgora || statusReconciliacao === 'running'}
                          onCheckedChange={() => handleToggleDevolucao(devolucao)}
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">Devolução #{devolucao.devolucao_id}</span>
                            {devolucao.operacao_estoque_id && (
                              <span className="text-xs px-2 py-1 rounded-full bg-muted">
                                Operação #{devolucao.operacao_estoque_id}
                              </span>
                            )}
                            {tipoOrigem && (
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                tipoOrigem === 'SPPRO'
                                  ? 'bg-blue-100 text-blue-700'
                                  : tipoOrigem === 'SOI'
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-amber-100 text-amber-700'
                              }`}>
                                {tipoOrigem === 'NAO_CLASSIFICADO' ? 'NÃO CLASSIFICADO' : tipoOrigem}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                            <div>
                              <span className="font-medium">Data: </span>
                              {formatDate(devolucao.data_devolucao)}
                            </div>
                            <div>
                              <span className="font-medium">Valor restante: </span>
                              <span className="text-orange-600 font-semibold">
                                {formatCurrency(valorRestante)}
                              </span>
                              {valorJaTransferido > 0 && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  (transferido: {formatCurrency(valorJaTransferido)} de {formatCurrency(valorDevolucao)})
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium">Disponível agora: </span>
                              <span className={`${valorTransferivelAgora > 0.01 ? 'text-emerald-700' : 'text-destructive'} font-semibold`}>
                                {formatCurrency(valorTransferivelAgora)}
                              </span>
                            </div>
                            {(devolucao.fornecedor_nome_fantasia || devolucao.fornecedor_nome) && (
                              <div>
                                <span className="font-medium">Fornecedor: </span>
                                {devolucao.fornecedor_nome_fantasia || devolucao.fornecedor_nome}
                              </div>
                            )}
                          </div>
                          {bloqueadaAgora && (
                            <p className="text-xs text-destructive">
                              Sem orçamento operacional disponível para esta devolução no momento.
                            </p>
                          )}
                          {isSelected && (
                            <div className="pt-2 border-t">
                              <Label className="text-xs">Valor a Transferir (pode ser parcial)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max={valorMaximoLinha}
                                value={valorSelecionado || valorMaximoLinha}
                                onChange={(e) => handleValorParcial(devolucao, e.target.value)}
                                disabled={statusReconciliacao === 'running'}
                                className="mt-1"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Valor máximo agora: {formatCurrency(valorMaximoLinha)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {devolucoesSelecionadas.size > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-primary">
                  Total Selecionado: {formatCurrency(valorTotalSelecionado)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Disponível agora: {formatCurrency(totalTransferivelAgora)} | Restante no orçamento atual:{' '}
                  {formatCurrency(orcamentoDisponivelAgora)}
                </div>
              </div>
            )}
          </div>

          {/* Formulário de transferência */}
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="data_transferencia">Data da Transferência *</Label>
                <Input
                  id="data_transferencia"
                  type="date"
                  value={formData.data_transferencia}
                  onChange={(e) => setFormData(prev => ({ ...prev, data_transferencia: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="destino_tipo">Tipo de Destino *</Label>
                <Select
                  value={formData.destino_tipo}
                  onValueChange={(value) => setFormData(prev => ({ 
                    ...prev, 
                    destino_tipo: value as 'conta' | 'estoque',
                    destino_id: '', // Resetar destino ao mudar tipo
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conta">Conta Bancária</SelectItem>
                    <SelectItem value="estoque">Estoque (SPPRO/SOI)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="destino_id">
                {formData.destino_tipo === 'conta' ? 'Conta Bancária *' : 'Estoque Destino *'}
              </Label>
              {formData.destino_tipo === 'conta' ? (
                <Select
                  value={formData.destino_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, destino_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a conta bancária" />
                  </SelectTrigger>
                  <SelectContent>
                    {contasBancarias.map((conta) => (
                      <SelectItem key={conta.id} value={conta.id}>
                        {conta.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={formData.destino_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, destino_id: value }))}
                  disabled={isLoadingEstoques}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o estoque destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {estoquesFiltrados.map((estoque) => (
                      <SelectItem key={estoque.id} value={String(estoque.id)}>
                        {estoque.descricao || `Estoque ${estoque.tipo}`} - {formatCurrency(estoque.saldo_atual)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="historico">Histórico</Label>
              <Input
                id="historico"
                value={formData.historico}
                onChange={(e) => setFormData(prev => ({ ...prev, historico: e.target.value }))}
                placeholder="Descrição da transferência"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                value={formData.observacoes}
                onChange={(e) => setFormData(prev => ({ ...prev, observacoes: e.target.value }))}
                placeholder="Observações adicionais (opcional)"
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              transferirDevolucoes.isPending ||
              statusReconciliacao === 'running' ||
              devolucoesSelecionadas.size === 0
            }
          >
            {transferirDevolucoes.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferindo...
              </>
            ) : (
              'Transferir Devoluções'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
