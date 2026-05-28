import { useState, useEffect, useMemo } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import { 
  useCreateDevolucaoEstoque, 
  useDevolucoesEstoque,
  useOperacoesFornecedor,
  useEstoquesResumo,
  buscarContaSB_S0I2
} from "@/hooks/useEstoque";
import { useFornecedores } from "@/hooks/useFornecedores";
import type { CreateDevolucaoEstoque, TipoEstoque } from "@/types/estoque";

interface DevolucaoEstoqueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lancamentoData: {
    data: string;
    valor: string;
    historico: string;
    documento?: string;
  };
  empresaId: string;
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

export function DevolucaoEstoqueDialog({
  open,
  onOpenChange,
  lancamentoData,
  empresaId,
}: DevolucaoEstoqueDialogProps) {
  const [modoDevolucao, setModoDevolucao] = useState<"operacao" | "estoque">("operacao");
  const [selectedFornecedorId, setSelectedFornecedorId] = useState<string | undefined>(undefined);
  const [selectedTipoEstoque, setSelectedTipoEstoque] = useState<TipoEstoque | "">("");
  const [formData, setFormData] = useState<CreateDevolucaoEstoque & { conta_bancaria_id: string }>({
    operacao_estoque_id: 0,
    data_devolucao: lancamentoData.data || new Date().toISOString().split("T")[0],
    valor_devolucao: parseFloat(lancamentoData.valor) || 0,
    conta_bancaria_id: "",
    historico: lancamentoData.historico || "",
    observacoes: "",
  });

  const [contaSB_S0I2, setContaSB_S0I2] = useState<string | null>(null);
  const [loadingConta, setLoadingConta] = useState(true);

  // Buscar todos os fornecedores
  const { data: fornecedores, isLoading: isLoadingFornecedores } = useFornecedores();

  // Buscar operações do fornecedor selecionado (apenas entradas)
  const { data: operacoes, isLoading: isLoadingOperacoes } = useOperacoesFornecedor(
    modoDevolucao === "operacao" ? selectedFornecedorId || undefined : undefined,
    undefined, // tipoEstoque - buscar todos
    { tipo_operacao: 'entrada' } // apenas entradas
  );

  // Buscar devoluções da operação selecionada (apenas no modo operação)
  const { data: devolucoesOperacao } = useDevolucoesEstoque(
    modoDevolucao === "operacao" && formData.operacao_estoque_id > 0 ? formData.operacao_estoque_id : undefined
  );

  // Buscar resumo de estoques para mostrar saldos (apenas no modo estoque)
  const { data: resumoEstoques, isLoading: isLoadingResumoEstoques } = useEstoquesResumo();

  const createDevolucao = useCreateDevolucaoEstoque();

  // Buscar conta SB-S0I2 ao abrir o dialog
  useEffect(() => {
    if (open && empresaId) {
      setLoadingConta(true);
      buscarContaSB_S0I2(empresaId)
        .then((contaId) => {
          setContaSB_S0I2(contaId);
          if (contaId) {
            setFormData((prev) => ({ ...prev, conta_bancaria_id: contaId }));
          }
        })
        .catch((error) => {
          console.error('Erro ao buscar conta SB-S0I2:', error);
        })
        .finally(() => {
          setLoadingConta(false);
        });
    }
  }, [open, empresaId]);

  // Resetar formulário ao fechar
  useEffect(() => {
    if (!open) {
      setModoDevolucao("operacao");
      setSelectedFornecedorId(undefined);
      setSelectedTipoEstoque("");
      setFormData({
        operacao_estoque_id: 0,
        data_devolucao: lancamentoData.data || new Date().toISOString().split("T")[0],
        valor_devolucao: parseFloat(lancamentoData.valor) || 0,
        conta_bancaria_id: contaSB_S0I2 || "",
        historico: lancamentoData.historico || "",
        observacoes: "",
      });
    }
  }, [open, lancamentoData, contaSB_S0I2]);

  // Resetar operação quando trocar fornecedor
  useEffect(() => {
    if (selectedFornecedorId && modoDevolucao === "operacao") {
      setFormData((prev) => ({ ...prev, operacao_estoque_id: 0 }));
    }
  }, [selectedFornecedorId, modoDevolucao]);

  // Resetar tipo estoque quando trocar modo
  useEffect(() => {
    if (modoDevolucao === "operacao") {
      setSelectedTipoEstoque("");
      setFormData((prev) => ({ ...prev, tipo_estoque: undefined }));
    } else {
      setSelectedFornecedorId(undefined);
      setFormData((prev) => ({ ...prev, operacao_estoque_id: undefined }));
    }
  }, [modoDevolucao]);

  // Buscar operação selecionada para mostrar informações
  const operacaoSelecionada = useMemo(() => {
    if (!operacoes || formData.operacao_estoque_id === 0) return null;
    return operacoes.find((op) => op.id === formData.operacao_estoque_id);
  }, [operacoes, formData.operacao_estoque_id]);

  // Calcular total já devolvido (incluindo o valor atual sendo digitado)
  const totalDevolvido = useMemo(() => {
    if (!devolucoesOperacao) return formData.valor_devolucao || 0;
    const devolvidoExistente = devolucoesOperacao.reduce((sum, dev) => sum + (Number(dev.valor_devolucao) || 0), 0);
    return devolvidoExistente + (formData.valor_devolucao || 0);
  }, [devolucoesOperacao, formData.valor_devolucao]);

  // Calcular valor disponível para devolução (sem incluir o valor atual sendo digitado)
  const totalDevolvidoExistente = useMemo(() => {
    if (!devolucoesOperacao) return 0;
    return devolucoesOperacao.reduce((sum, dev) => sum + (Number(dev.valor_devolucao) || 0), 0);
  }, [devolucoesOperacao]);

  // Calcular valor disponível para devolução (modo operação)
  const valorDisponivelOperacao = useMemo(() => {
    if (!operacaoSelecionada || modoDevolucao !== "operacao") return 0;
    const faceTitulos = Number(operacaoSelecionada.face_titulos) || 0;
    return Math.max(0, faceTitulos - totalDevolvidoExistente);
  }, [operacaoSelecionada, totalDevolvidoExistente, modoDevolucao]);

  // Calcular saldo disponível do estoque (modo estoque)
  const saldoDisponivelEstoque = useMemo(() => {
    if (modoDevolucao !== "estoque" || !resumoEstoques || !selectedTipoEstoque) return 0;
    if (selectedTipoEstoque === "SPPRO") {
      return resumoEstoques.sppro || 0;
    } else if (selectedTipoEstoque === "SOI") {
      return resumoEstoques.soi || 0;
    }
    return 0;
  }, [modoDevolucao, resumoEstoques, selectedTipoEstoque]);

  // Valor disponível baseado no modo
  const valorDisponivel = modoDevolucao === "operacao" ? valorDisponivelOperacao : saldoDisponivelEstoque;

  // Validar se valor excede disponível
  const valorExcede = formData.valor_devolucao > valorDisponivel && valorDisponivel > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (modoDevolucao === "operacao") {
      if (!selectedFornecedorId || selectedFornecedorId === "") {
        alert('Selecione um fornecedor');
        return;
      }

      if (!formData.operacao_estoque_id || formData.operacao_estoque_id === 0) {
        alert('Selecione uma operação');
        return;
      }
    } else {
      if (!selectedTipoEstoque || selectedTipoEstoque === "") {
        alert('Selecione o tipo de estoque (SPPRO ou SOI)');
        return;
      }
    }

    if (formData.valor_devolucao <= 0) {
      alert('Valor da devolução deve ser maior que zero');
      return;
    }

    if (valorExcede) {
      alert(`Valor da devolução (R$ ${formData.valor_devolucao.toFixed(2)}) excede o disponível (R$ ${valorDisponivel.toFixed(2)})`);
      return;
    }

    if (!contaSB_S0I2) {
      alert('Conta SB-S0I2 não encontrada. Por favor, crie a conta manualmente.');
      return;
    }

    try {
      await createDevolucao.mutateAsync({
        operacao_estoque_id: modoDevolucao === "operacao" ? formData.operacao_estoque_id : undefined,
        tipo_estoque: modoDevolucao === "estoque" ? selectedTipoEstoque as TipoEstoque : undefined,
        data_devolucao: formData.data_devolucao,
        valor_devolucao: formData.valor_devolucao,
        conta_bancaria_id: contaSB_S0I2,
        historico: formData.historico || undefined,
        observacoes: formData.observacoes || undefined,
      });

      onOpenChange(false);
    } catch (error) {
      // Erro já é tratado pelo hook (toast)
      console.error('Erro ao criar devolução:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl lg:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar Devolução</DialogTitle>
          <DialogDescription>
            Escolha o modo de devolução e informe os dados necessários
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Seleção de Modo */}
            <div className="col-span-2">
              <Label htmlFor="modo_devolucao">Modo de Devolução *</Label>
              <Select
                value={modoDevolucao}
                onValueChange={(value) => setModoDevolucao(value as "operacao" | "estoque")}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o modo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operacao">Devolução de Operação Específica</SelectItem>
                  <SelectItem value="estoque">Devolução Direta de Estoque</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Modo Operação */}
            {modoDevolucao === "operacao" && (
              <>
                <div className="col-span-2">
                  <Label htmlFor="fornecedor_id">Fornecedor *</Label>
                  <Select
                    value={selectedFornecedorId}
                    onValueChange={(value) => setSelectedFornecedorId(value)}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um fornecedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {isLoadingFornecedores ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">Carregando...</div>
                      ) : !fornecedores || fornecedores.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          Nenhum fornecedor encontrado
                        </div>
                      ) : (
                        fornecedores.map((fornecedor) => (
                          <SelectItem key={fornecedor.id} value={fornecedor.id}>
                            {fornecedor.nome_fantasia || fornecedor.razao_social || 'Fornecedor sem nome'}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {selectedFornecedorId && (
                  <div className="col-span-2">
                    <Label htmlFor="operacao_estoque_id">Operação *</Label>
                    <Select
                      value={formData.operacao_estoque_id && formData.operacao_estoque_id > 0 ? formData.operacao_estoque_id.toString() : undefined}
                      onValueChange={(value) =>
                        setFormData({ ...formData, operacao_estoque_id: value ? parseInt(value, 10) : 0 })
                      }
                      required
                      disabled={!selectedFornecedorId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma operação..." />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingOperacoes ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">Carregando operações...</div>
                        ) : !operacoes || operacoes.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            Nenhuma operação de entrada encontrada para este fornecedor
                          </div>
                        ) : (
                          operacoes.map((op) => {
                            const estoqueTipo = op.estoques?.tipo || 'N/A';
                            return (
                              <SelectItem key={op.id} value={op.id.toString()}>
                                {`Operação #${op.id} - ${estoqueTipo} - ${formatCurrency(op.face_titulos)} - ${op.data}`}
                              </SelectItem>
                            );
                          })
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {operacaoSelecionada && (
                  <div className="col-span-2 space-y-2 p-4 border rounded-md bg-muted/30">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Face dos Títulos:</span>
                        <p className="font-semibold">{formatCurrency(operacaoSelecionada.face_titulos)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Devolvido:</span>
                        <p className="font-semibold">{formatCurrency(totalDevolvido)}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Valor Disponível para Devolução:</span>
                        <p className={`font-bold text-lg ${valorDisponivel > 0 ? 'text-success' : 'text-destructive'}`}>
                          {formatCurrency(valorDisponivel)}
                        </p>
                      </div>
                    </div>
                    {totalDevolvido > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Progresso: {formatCurrency(totalDevolvido)} de {formatCurrency(operacaoSelecionada.face_titulos)} devolvidos
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Modo Estoque */}
            {modoDevolucao === "estoque" && (
              <>
                <div className="col-span-2">
                  <Label htmlFor="tipo_estoque">Tipo de Estoque *</Label>
                  <Select
                    value={selectedTipoEstoque}
                    onValueChange={(value) => {
                      setSelectedTipoEstoque(value as TipoEstoque);
                      setFormData((prev) => ({ ...prev, tipo_estoque: value as TipoEstoque }));
                    }}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione SPPRO ou SOI..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SPPRO">SPPRO</SelectItem>
                      <SelectItem value="SOI">SOI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedTipoEstoque && (
                  <div className="col-span-2 space-y-2 p-4 border rounded-md bg-muted/30">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Tipo de Estoque:</span>
                        <p className={`font-semibold ${selectedTipoEstoque === 'SPPRO' ? 'text-blue-600' : 'text-purple-600'}`}>
                          {selectedTipoEstoque}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Saldo Disponível para Devolução:</span>
                        {isLoadingResumoEstoques ? (
                          <p className="font-semibold">Carregando...</p>
                        ) : (
                          <p className={`font-bold text-lg ${valorDisponivel > 0 ? 'text-success' : 'text-destructive'}`}>
                            {formatCurrency(valorDisponivel)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div>
              <Label htmlFor="data_devolucao">Data da Devolução *</Label>
              <Input
                id="data_devolucao"
                type="date"
                value={formData.data_devolucao}
                onChange={(e) => setFormData({ ...formData, data_devolucao: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="valor_devolucao">Valor da Devolução *</Label>
              <Input
                id="valor_devolucao"
                type="number"
                step="0.01"
                min="0"
                value={formData.valor_devolucao || ""}
                onChange={(e) =>
                  setFormData({ ...formData, valor_devolucao: parseFloat(e.target.value) || 0 })
                }
                required
                className={valorExcede ? "border-destructive" : ""}
              />
              {valorExcede && (
                <p className="text-xs text-destructive mt-1">
                  Valor excede o disponível ({formatCurrency(valorDisponivel)})
                </p>
              )}
            </div>

            <div className="col-span-2">
              <Label htmlFor="historico">Histórico</Label>
              <Input
                id="historico"
                value={formData.historico}
                onChange={(e) => setFormData({ ...formData, historico: e.target.value })}
                placeholder="Histórico da devolução (opcional)"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                value={formData.observacoes}
                onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                placeholder="Observações adicionais (opcional)"
                rows={3}
              />
            </div>

            {loadingConta ? (
              <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Buscando conta SB-S0I2...</span>
              </div>
            ) : !contaSB_S0I2 ? (
              <div className="col-span-2">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Conta SB-S0I2 não encontrada. Por favor, crie a conta manualmente antes de registrar devoluções.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="col-span-2">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Devolução será registrada na conta <strong>SB-S0I2</strong>
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                createDevolucao.isPending || 
                !contaSB_S0I2 || 
                valorExcede || 
                (modoDevolucao === "operacao" && (!selectedFornecedorId || !formData.operacao_estoque_id || formData.operacao_estoque_id === 0)) ||
                (modoDevolucao === "estoque" && !selectedTipoEstoque)
              }
            >
              {createDevolucao.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                "Registrar Devolução"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

