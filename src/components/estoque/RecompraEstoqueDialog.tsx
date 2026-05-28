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
import { Loader2 } from "lucide-react";
import { 
  useCreateRecompraEstoque,
  usePagarRecompraEstoque,
  useOperacoesFornecedor,
} from "@/hooks/useEstoque";
import { useFornecedores } from "@/hooks/useFornecedores";
import type { CreateRecompraEstoque, PagarRecompraEstoque, RecompraEstoqueComRelacoes, OrigemRecompra } from "@/types/estoque";

interface ContaBancaria {
  id: string;
  descricao: string;
}

interface EstoqueSelect {
  id: number;
  descricao: string;
  tipo: string;
}

interface RecompraEstoqueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'criar' | 'pagar';
  recompraParaPagar?: RecompraEstoqueComRelacoes | null;
  empresaId: string;
  contasBancarias: ContaBancaria[];
  estoquesSelect: EstoqueSelect[];
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

export function RecompraEstoqueDialog({
  open,
  onOpenChange,
  mode,
  recompraParaPagar,
  empresaId,
  contasBancarias,
  estoquesSelect,
}: RecompraEstoqueDialogProps) {
  // Estados para modo criar
  const [selectedFornecedorId, setSelectedFornecedorId] = useState<string | undefined>(undefined);
  const [formDataCriar, setFormDataCriar] = useState<CreateRecompraEstoque & { origem_tipo: OrigemRecompra | '' }>({
    operacao_estoque_id: 0,
    data_recompra: new Date().toISOString().split("T")[0],
    valor_recompra: 0,
    origem_tipo: '',
    origem_id: '',
    historico: "",
    observacoes: "",
  });

  // Estados para modo pagar
  const [formDataPagar, setFormDataPagar] = useState<Omit<PagarRecompraEstoque, 'recompra_id'> & { destino_tipo: OrigemRecompra | '' }>({
    data_pagamento: new Date().toISOString().split("T")[0],
    destino_tipo: '',
    destino_id: '',
    historico: "",
    observacoes: "",
  });

  // Buscar todos os fornecedores
  const { data: fornecedores, isLoading: isLoadingFornecedores } = useFornecedores();

  // Buscar operações do fornecedor selecionado (apenas entradas)
  const { data: operacoes, isLoading: isLoadingOperacoes } = useOperacoesFornecedor(
    mode === 'criar' ? selectedFornecedorId || undefined : undefined,
    undefined,
    { tipo_operacao: 'entrada' }
  );

  const createRecompra = useCreateRecompraEstoque();
  const pagarRecompra = usePagarRecompraEstoque();

  // Resetar formulário ao fechar ou mudar modo
  useEffect(() => {
    if (!open) {
      setSelectedFornecedorId(undefined);
      setFormDataCriar({
        operacao_estoque_id: 0,
        data_recompra: new Date().toISOString().split("T")[0],
        valor_recompra: 0,
        origem_tipo: '',
        origem_id: '',
        historico: "",
        observacoes: "",
      });
      setFormDataPagar({
        data_pagamento: new Date().toISOString().split("T")[0],
        destino_tipo: '',
        destino_id: '',
        historico: "",
        observacoes: "",
      });
    }
  }, [open]);

  // Quando mudar para modo pagar, preencher dados da recompra
  useEffect(() => {
    if (mode === 'pagar' && recompraParaPagar && open) {
      setFormDataPagar({
        data_pagamento: new Date().toISOString().split("T")[0],
        destino_tipo: '',
        destino_id: '',
        historico: "",
        observacoes: "",
      });
    }
  }, [mode, recompraParaPagar, open]);

  // Resetar operação quando trocar fornecedor
  useEffect(() => {
    if (selectedFornecedorId && mode === 'criar') {
      setFormDataCriar((prev) => ({ ...prev, operacao_estoque_id: 0 }));
    }
  }, [selectedFornecedorId, mode]);

  // Buscar operação selecionada para mostrar informações
  const operacaoSelecionada = useMemo(() => {
    if (!operacoes || formDataCriar.operacao_estoque_id === 0) return null;
    return operacoes.find((op) => op.id === formDataCriar.operacao_estoque_id);
  }, [operacoes, formDataCriar.operacao_estoque_id]);

  // Nota: Validação de saldo é feita no hook useCreateRecompraEstoque

  const handleSubmitCriar = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFornecedorId || selectedFornecedorId === "") {
      alert('Selecione um fornecedor');
      return;
    }

    if (!formDataCriar.operacao_estoque_id || formDataCriar.operacao_estoque_id === 0) {
      alert('Selecione uma operação');
      return;
    }

    if (formDataCriar.valor_recompra <= 0) {
      alert('Valor da recompra deve ser maior que zero');
      return;
    }

    if (!formDataCriar.origem_tipo || formDataCriar.origem_tipo === '') {
      alert('Selecione o tipo de origem (estoque ou conta)');
      return;
    }

    if (!formDataCriar.origem_id || formDataCriar.origem_id === '') {
      alert('Selecione a origem');
      return;
    }

    try {
      await createRecompra.mutateAsync({
        operacao_estoque_id: formDataCriar.operacao_estoque_id,
        data_recompra: formDataCriar.data_recompra,
        valor_recompra: formDataCriar.valor_recompra,
        origem_tipo: formDataCriar.origem_tipo,
        origem_id: formDataCriar.origem_tipo === 'estoque' 
          ? Number(formDataCriar.origem_id) 
          : formDataCriar.origem_id,
        historico: formDataCriar.historico || undefined,
        observacoes: formDataCriar.observacoes || undefined,
      });

      onOpenChange(false);
    } catch (error) {
      // Erro já é tratado pelo hook (toast)
      console.error('Erro ao criar recompra:', error);
    }
  };

  const handleSubmitPagar = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recompraParaPagar) {
      alert('Recompra não encontrada');
      return;
    }

    if (!formDataPagar.destino_tipo || formDataPagar.destino_tipo === '') {
      alert('Selecione o tipo de destino (estoque ou conta)');
      return;
    }

    if (!formDataPagar.destino_id || formDataPagar.destino_id === '') {
      alert('Selecione o destino');
      return;
    }

    if (new Date(formDataPagar.data_pagamento) < new Date(recompraParaPagar.data_recompra)) {
      alert('Data de pagamento não pode ser anterior à data da recompra');
      return;
    }

    try {
      await pagarRecompra.mutateAsync({
        recompra_id: recompraParaPagar.id,
        data_pagamento: formDataPagar.data_pagamento,
        destino_tipo: formDataPagar.destino_tipo,
        destino_id: formDataPagar.destino_tipo === 'estoque'
          ? Number(formDataPagar.destino_id)
          : formDataPagar.destino_id,
        historico: formDataPagar.historico || undefined,
        observacoes: formDataPagar.observacoes || undefined,
      });

      onOpenChange(false);
    } catch (error) {
      // Erro já é tratado pelo hook (toast)
      console.error('Erro ao pagar recompra:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl lg:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'criar' ? 'Criar Nova Recompra' : 'Pagar Recompra'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'criar' 
              ? 'Selecione a operação e informe os dados da recompra'
              : 'Informe os dados do pagamento da recompra'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'criar' ? (
          <form onSubmit={handleSubmitCriar} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
                    value={formDataCriar.operacao_estoque_id && formDataCriar.operacao_estoque_id > 0 ? formDataCriar.operacao_estoque_id.toString() : undefined}
                    onValueChange={(value) =>
                      setFormDataCriar({ ...formDataCriar, operacao_estoque_id: value ? parseInt(value, 10) : 0 })
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
                      <span className="text-muted-foreground">Recompra Acumulada:</span>
                      <p className="font-semibold">{formatCurrency(operacaoSelecionada.recompra || 0)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="data_recompra">Data da Recompra *</Label>
                <Input
                  id="data_recompra"
                  type="date"
                  value={formDataCriar.data_recompra}
                  onChange={(e) => setFormDataCriar({ ...formDataCriar, data_recompra: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="valor_recompra">Valor da Recompra *</Label>
                <Input
                  id="valor_recompra"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formDataCriar.valor_recompra || ""}
                  onChange={(e) =>
                    setFormDataCriar({ ...formDataCriar, valor_recompra: parseFloat(e.target.value) || 0 })
                  }
                  required
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="origem_tipo">Origem (De onde sai o valor) *</Label>
                <Select
                  value={formDataCriar.origem_tipo}
                  onValueChange={(value) => {
                    setFormDataCriar({ 
                      ...formDataCriar, 
                      origem_tipo: value as OrigemRecompra,
                      origem_id: '' // Resetar origem_id ao trocar tipo
                    });
                  }}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo de origem..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estoque">Estoque</SelectItem>
                    <SelectItem value="conta">Conta Bancária</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formDataCriar.origem_tipo === 'estoque' && (
                <div className="col-span-2">
                  <Label htmlFor="origem_id_estoque">Estoque de Origem *</Label>
                  <Select
                    value={formDataCriar.origem_id}
                    onValueChange={(value) => setFormDataCriar({ ...formDataCriar, origem_id: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o estoque..." />
                    </SelectTrigger>
                    <SelectContent>
                      {estoquesSelect.map((estoque) => (
                        <SelectItem key={estoque.id} value={estoque.id.toString()}>
                          {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formDataCriar.origem_tipo === 'conta' && (
                <div className="col-span-2">
                  <Label htmlFor="origem_id_conta">Conta Bancária de Origem *</Label>
                  <Select
                    value={formDataCriar.origem_id}
                    onValueChange={(value) => setFormDataCriar({ ...formDataCriar, origem_id: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a conta..." />
                    </SelectTrigger>
                    <SelectContent>
                      {contasBancarias.map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.descricao}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="col-span-2">
                <Label htmlFor="historico">Histórico</Label>
                <Input
                  id="historico"
                  value={formDataCriar.historico}
                  onChange={(e) => setFormDataCriar({ ...formDataCriar, historico: e.target.value })}
                  placeholder="Histórico da recompra (opcional)"
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="observacoes">Observações</Label>
                <Textarea
                  id="observacoes"
                  value={formDataCriar.observacoes}
                  onChange={(e) => setFormDataCriar({ ...formDataCriar, observacoes: e.target.value })}
                  placeholder="Observações adicionais (opcional)"
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  createRecompra.isPending ||
                  !selectedFornecedorId ||
                  !formDataCriar.operacao_estoque_id ||
                  formDataCriar.operacao_estoque_id === 0 ||
                  !formDataCriar.origem_tipo ||
                  !formDataCriar.origem_id ||
                  formDataCriar.valor_recompra <= 0
                }
              >
                {createRecompra.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar Recompra"
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleSubmitPagar} className="space-y-4">
            {recompraParaPagar && (
              <div className="space-y-4">
                <div className="p-4 border rounded-md bg-muted/30 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Recompra #:</span>
                      <p className="font-semibold">{recompraParaPagar.id}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Valor:</span>
                      <p className="font-semibold text-yellow-600">{formatCurrency(recompraParaPagar.valor_recompra)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Data da Recompra:</span>
                      <p className="font-semibold">{recompraParaPagar.data_recompra}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Origem:</span>
                      <p className="font-semibold">
                        {recompraParaPagar.origem_tipo === 'estoque' && recompraParaPagar.estoques_origem
                          ? `Estoque: ${recompraParaPagar.estoques_origem.descricao || `#${recompraParaPagar.estoques_origem.id}`}`
                          : recompraParaPagar.origem_tipo === 'conta' && recompraParaPagar.contas_origem
                          ? `Conta: ${recompraParaPagar.contas_origem.descricao}`
                          : '-'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="data_pagamento">Data do Pagamento *</Label>
                    <Input
                      id="data_pagamento"
                      type="date"
                      value={formDataPagar.data_pagamento}
                      onChange={(e) => setFormDataPagar({ ...formDataPagar, data_pagamento: e.target.value })}
                      required
                      min={recompraParaPagar.data_recompra}
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="destino_tipo">Destino (Para onde vai o valor) *</Label>
                    <Select
                      value={formDataPagar.destino_tipo}
                      onValueChange={(value) => {
                        setFormDataPagar({ 
                          ...formDataPagar, 
                          destino_tipo: value as OrigemRecompra,
                          destino_id: '' // Resetar destino_id ao trocar tipo
                        });
                      }}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo de destino..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="estoque">Estoque</SelectItem>
                        <SelectItem value="conta">Conta Bancária</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formDataPagar.destino_tipo === 'estoque' && (
                    <div className="col-span-2">
                      <Label htmlFor="destino_id_estoque">Estoque de Destino *</Label>
                      <Select
                        value={formDataPagar.destino_id}
                        onValueChange={(value) => setFormDataPagar({ ...formDataPagar, destino_id: value })}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o estoque..." />
                        </SelectTrigger>
                        <SelectContent>
                          {estoquesSelect.map((estoque) => (
                            <SelectItem key={estoque.id} value={estoque.id.toString()}>
                              {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {formDataPagar.destino_tipo === 'conta' && (
                    <div className="col-span-2">
                      <Label htmlFor="destino_id_conta">Conta Bancária de Destino *</Label>
                      <Select
                        value={formDataPagar.destino_id}
                        onValueChange={(value) => setFormDataPagar({ ...formDataPagar, destino_id: value })}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a conta..." />
                        </SelectTrigger>
                        <SelectContent>
                          {contasBancarias.map((conta) => (
                            <SelectItem key={conta.id} value={conta.id}>
                              {conta.descricao}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="col-span-2">
                    <Label htmlFor="historico_pagar">Histórico</Label>
                    <Input
                      id="historico_pagar"
                      value={formDataPagar.historico}
                      onChange={(e) => setFormDataPagar({ ...formDataPagar, historico: e.target.value })}
                      placeholder="Histórico do pagamento (opcional)"
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="observacoes_pagar">Observações</Label>
                    <Textarea
                      id="observacoes_pagar"
                      value={formDataPagar.observacoes}
                      onChange={(e) => setFormDataPagar({ ...formDataPagar, observacoes: e.target.value })}
                      placeholder="Observações adicionais (opcional)"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  pagarRecompra.isPending ||
                  !recompraParaPagar ||
                  !formDataPagar.destino_tipo ||
                  !formDataPagar.destino_id ||
                  new Date(formDataPagar.data_pagamento) < new Date(recompraParaPagar?.data_recompra || '')
                }
              >
                {pagarRecompra.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Pagando...
                  </>
                ) : (
                  "Pagar Recompra"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

