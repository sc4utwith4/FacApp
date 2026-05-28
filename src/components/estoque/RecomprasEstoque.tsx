import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, RotateCcw, CheckCircle2, Trash2 } from "lucide-react";
import { useRecomprasEstoque, useDeleteRecompraEstoque } from "@/hooks/useEstoque";
import { RecompraEstoqueDialog } from "./RecompraEstoqueDialog";
import type { RecompraEstoqueComRelacoes } from "@/types/estoque";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface ContaBancaria {
  id: string;
  descricao: string;
}

interface EstoqueSelect {
  id: number;
  descricao: string;
  tipo: string;
}

interface RecomprasEstoqueProps {
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

export function RecomprasEstoque({
  empresaId,
  contasBancarias,
  estoquesSelect,
}: RecomprasEstoqueProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'criar' | 'pagar'>('criar');
  const [recompraParaPagar, setRecompraParaPagar] = useState<RecompraEstoqueComRelacoes | null>(null);
  const [recompraParaDeletar, setRecompraParaDeletar] = useState<RecompraEstoqueComRelacoes | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  // Buscar todas as recompras
  const { data: recompras, isLoading: isLoadingRecompras } = useRecomprasEstoque();
  const deleteRecompra = useDeleteRecompraEstoque();

  // Separar recompras por status
  const recomprasPendentes = useMemo(() => {
    return (recompras || []).filter(r => r.status === 'pendente');
  }, [recompras]);

  const recomprasPagas = useMemo(() => {
    return (recompras || []).filter(r => r.status === 'paga');
  }, [recompras]);

  const handleOpenCriarDialog = () => {
    setDialogMode('criar');
    setRecompraParaPagar(null);
    setIsDialogOpen(true);
  };

  const handleOpenPagarDialog = (recompra: RecompraEstoqueComRelacoes) => {
    setDialogMode('pagar');
    setRecompraParaPagar(recompra);
    setIsDialogOpen(true);
  };

  const handleDeleteRecompra = async () => {
    if (!recompraParaDeletar) return;

    try {
      await deleteRecompra.mutateAsync(recompraParaDeletar.id);
      setIsDeleteDialogOpen(false);
      setRecompraParaDeletar(null);
    } catch (error: any) {
      // Erro já é tratado pelo hook
      console.error('Erro ao deletar recompra:', error);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-blue-500" />
              Recompras de Estoque
            </CardTitle>
            <Button
              onClick={handleOpenCriarDialog}
              className="bg-success hover:bg-success/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova Recompra
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Lista de Recompras Pendentes */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Recompras Pendentes ({recomprasPendentes.length})</h3>
            </div>

            {isLoadingRecompras && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Carregando recompras...</span>
              </div>
            )}

            {!isLoadingRecompras && recomprasPendentes.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <RotateCcw className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-lg font-medium">Nenhuma recompra pendente</p>
                <p className="text-sm mt-2">Clique em "Nova Recompra" para registrar uma recompra</p>
              </div>
            )}

            {!isLoadingRecompras && recomprasPendentes.length > 0 && (
              <div className="space-y-3">
                {recomprasPendentes.map((recompra) => {
                  const operacao = recompra.operacoes_estoque;
                  const origemEstoque = recompra.estoques_origem;
                  const origemConta = recompra.contas_origem;
                  const lancamentoSaida = recompra.lancamentos_saida;

                  return (
                    <div
                      key={recompra.id}
                      className="rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 p-4 text-sm space-y-2"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base">
                              Recompra #{recompra.id}
                            </span>
                            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                              Pendente
                            </Badge>
                            {operacao && (
                              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                Operação #{operacao.id}
                              </span>
                            )}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">Data: </span>
                              {formatDate(recompra.data_recompra)}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Valor: </span>
                              <span className="text-yellow-600 dark:text-yellow-400 font-semibold">
                                {formatCurrency(recompra.valor_recompra)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Origem: </span>
                              {recompra.origem_tipo === 'estoque' && origemEstoque && (
                                <span className="font-semibold text-blue-600">
                                  Estoque: {origemEstoque.descricao || `#${origemEstoque.id}`}
                                </span>
                              )}
                              {recompra.origem_tipo === 'conta' && origemConta && (
                                <span className="font-semibold text-green-600">
                                  Conta: {origemConta.descricao}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenPagarDialog(recompra)}
                            className="text-success border-success hover:bg-success hover:text-white"
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Pagar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRecompraParaDeletar(recompra);
                              setIsDeleteDialogOpen(true);
                            }}
                            className="text-destructive border-destructive hover:bg-destructive hover:text-white"
                            disabled={deleteRecompra.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {operacao && (
                        <div className="pt-2 border-t border-border/60 space-y-1">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-muted-foreground">
                            {operacao.fornecedores && (
                              <div>
                                <span className="font-medium text-foreground">Fornecedor: </span>
                                {operacao.fornecedores.nome_fantasia || operacao.fornecedores.razao_social}
                              </div>
                            )}
                            {operacao.estoques && (
                              <div>
                                <span className="font-medium text-foreground">Tipo de Estoque: </span>
                                <span className={`font-semibold ${operacao.estoques.tipo === 'SPPRO' ? 'text-blue-600' : 'text-purple-600'}`}>
                                  {operacao.estoques.tipo}
                                </span>
                              </div>
                            )}
                            <div>
                              <span className="font-medium text-foreground">Face dos Títulos: </span>
                              {formatCurrency(operacao.face_titulos)}
                            </div>
                          </div>
                        </div>
                      )}

                      {recompra.historico && (
                        <div className="pt-2 border-t border-border/60">
                          <span className="font-medium text-foreground">Histórico: </span>
                          <span className="text-muted-foreground">{recompra.historico}</span>
                        </div>
                      )}

                      {lancamentoSaida && (
                        <div className="pt-2 border-t border-border/60">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-medium text-foreground">Lançamento de Saída: </span>
                            <span>#{lancamentoSaida.id}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lista de Recompras Pagas */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Recompras Pagas ({recomprasPagas.length})</h3>
            </div>

            {!isLoadingRecompras && recomprasPagas.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-lg font-medium">Nenhuma recompra paga</p>
              </div>
            )}

            {!isLoadingRecompras && recomprasPagas.length > 0 && (
              <div className="space-y-3">
                {recomprasPagas.map((recompra) => {
                  const operacao = recompra.operacoes_estoque;
                  const origemEstoque = recompra.estoques_origem;
                  const origemConta = recompra.contas_origem;
                  const destinoEstoque = recompra.estoques_destino;
                  const destinoConta = recompra.contas_destino;
                  const lancamentoSaida = recompra.lancamentos_saida;
                  const lancamentoEntrada = recompra.lancamentos_entrada;

                  return (
                    <div
                      key={recompra.id}
                      className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4 text-sm space-y-2"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base">
                              Recompra #{recompra.id}
                            </span>
                            <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                              Paga
                            </Badge>
                            {operacao && (
                              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                Operação #{operacao.id}
                              </span>
                            )}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">Data Recompra: </span>
                              {formatDate(recompra.data_recompra)}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Data Pagamento: </span>
                              {formatDate(recompra.data_pagamento)}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Valor: </span>
                              <span className="text-green-600 dark:text-green-400 font-semibold">
                                {formatCurrency(recompra.valor_recompra)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Origem: </span>
                              {recompra.origem_tipo === 'estoque' && origemEstoque && (
                                <span className="font-semibold text-blue-600">
                                  Estoque: {origemEstoque.descricao || `#${origemEstoque.id}`}
                                </span>
                              )}
                              {recompra.origem_tipo === 'conta' && origemConta && (
                                <span className="font-semibold text-green-600">
                                  Conta: {origemConta.descricao}
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Destino: </span>
                              {recompra.destino_tipo === 'estoque' && destinoEstoque && (
                                <span className="font-semibold text-blue-600">
                                  Estoque: {destinoEstoque.descricao || `#${destinoEstoque.id}`}
                                </span>
                              )}
                              {recompra.destino_tipo === 'conta' && destinoConta && (
                                <span className="font-semibold text-green-600">
                                  Conta: {destinoConta.descricao}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {operacao && (
                        <div className="pt-2 border-t border-border/60 space-y-1">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-muted-foreground">
                            {operacao.fornecedores && (
                              <div>
                                <span className="font-medium text-foreground">Fornecedor: </span>
                                {operacao.fornecedores.nome_fantasia || operacao.fornecedores.razao_social}
                              </div>
                            )}
                            {operacao.estoques && (
                              <div>
                                <span className="font-medium text-foreground">Tipo de Estoque: </span>
                                <span className={`font-semibold ${operacao.estoques.tipo === 'SPPRO' ? 'text-blue-600' : 'text-purple-600'}`}>
                                  {operacao.estoques.tipo}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {recompra.historico && (
                        <div className="pt-2 border-t border-border/60">
                          <span className="font-medium text-foreground">Histórico: </span>
                          <span className="text-muted-foreground">{recompra.historico}</span>
                        </div>
                      )}

                      <div className="pt-2 border-t border-border/60 grid grid-cols-2 gap-4">
                        {lancamentoSaida && (
                          <div className="text-muted-foreground">
                            <span className="font-medium text-foreground">Lançamento Saída: </span>
                            <span>#{lancamentoSaida.id}</span>
                          </div>
                        )}
                        {lancamentoEntrada && (
                          <div className="text-muted-foreground">
                            <span className="font-medium text-foreground">Lançamento Entrada: </span>
                            <span>#{lancamentoEntrada.id}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog para criar/pagar recompra */}
      <RecompraEstoqueDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        mode={dialogMode}
        recompraParaPagar={recompraParaPagar}
        empresaId={empresaId}
        contasBancarias={contasBancarias}
        estoquesSelect={estoquesSelect}
      />

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir recompra</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta recompra? Esta ação não pode ser desfeita e o saldo será revertido automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteDialogOpen(false);
              setRecompraParaDeletar(null);
            }}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRecompra}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteRecompra.isPending}
            >
              {deleteRecompra.isPending ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

