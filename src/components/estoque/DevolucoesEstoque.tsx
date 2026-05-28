import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Loader2, ArrowLeftRight, Warehouse, Trash2, AlertTriangle } from "lucide-react";
import {
  getMotivoDevolucaoOrfaMessage,
  useDevolucoesEstoque,
  useOperacoesEstoqueDevolucoes,
  useLimparDevolucoesOrfas,
  useDevolucoesOrfas,
} from "@/hooks/useEstoque";
import { DevolucaoEstoqueDialog } from "./DevolucaoEstoqueDialog";
import { TransferirDevolucoesDialog } from "./TransferirDevolucoesDialog";
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
import { Badge } from "@/components/ui/badge";

interface ContaBancaria {
  id: string;
  descricao: string;
}

interface DevolucoesEstoqueProps {
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

export function DevolucoesEstoque({
  empresaId,
  contasBancarias,
}: DevolucoesEstoqueProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTransferirDialogOpen, setIsTransferirDialogOpen] = useState(false);
  const [isLimparDialogOpen, setIsLimparDialogOpen] = useState(false);
  
  // Buscar todas as devoluções (sem filtro de operação)
  const { data: devolucoes, isLoading: isLoadingDevolucoes } = useDevolucoesEstoque();
  const { data: operacoesDevolucoes, isLoading: isLoadingOperacoes } = useOperacoesEstoqueDevolucoes();
  const { data: devolucoesOrfas = [] } = useDevolucoesOrfas();
  const limparDevolucoesOrfas = useLimparDevolucoesOrfas();
  const orfasLimpaveis = devolucoesOrfas.filter((item) => item.pode_limpar);
  const orfasBloqueadas = devolucoesOrfas.filter((item) => !item.pode_limpar);
  const resumoBloqueadas = useMemo(() => {
    const counters = new Map<string, number>();
    for (const item of orfasBloqueadas) {
      counters.set(item.motivo, (counters.get(item.motivo) || 0) + 1);
    }
    return Array.from(counters.entries());
  }, [orfasBloqueadas]);

  // Preparar dados do lançamento vazio para nova devolução
  const lancamentoDataVazio = {
    data: new Date().toISOString().split("T")[0],
    valor: "0",
    historico: "",
    documento: undefined,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-orange-500" />
            Estoque Devoluções
          </CardTitle>
          <div className="flex gap-2">
            <Button
              onClick={() => setIsDialogOpen(true)}
              className="bg-success hover:bg-success/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova Devolução
            </Button>
            <Button
              onClick={() => setIsTransferirDialogOpen(true)}
              variant="outline"
              className="border-primary text-primary hover:bg-primary/10"
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Transferir Devoluções
            </Button>
            {devolucoesOrfas.length > 0 && (
              <Button
                onClick={() => setIsLimparDialogOpen(true)}
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Limpar Devoluções Órfãs
                <Badge variant="destructive" className="ml-2">
                  {devolucoesOrfas.length}
                </Badge>
                {orfasBloqueadas.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orfasBloqueadas.length} bloqueadas
                  </Badge>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Lista de Devoluções */}
        <div className="space-y-4">
          {isLoadingDevolucoes && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Carregando devoluções...</span>
            </div>
          )}

          {!isLoadingDevolucoes && (!devolucoes || devolucoes.length === 0) && (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">Nenhuma devolução registrada</p>
              <p className="text-sm mt-2">Clique em "Nova Devolução" para registrar uma devolução de fornecedor</p>
            </div>
          )}

          {!isLoadingDevolucoes && devolucoes && devolucoes.length > 0 && (
            <div className="space-y-3">
              {devolucoes.map((devolucao) => {
                const operacao = devolucao.operacoes_estoque;
                const conta = devolucao.contas_bancarias;
                const lancamento = devolucao.lancamentos_caixa;
                
                // Detectar se é devolução direta de estoque (sem operacao_estoque_id)
                const isDevolucaoDiretaEstoque = !devolucao.operacao_estoque_id;
                
                // Extrair tipo de estoque do histórico do lançamento (ex: "Devolução Estoque SPPRO")
                let tipoEstoqueDireta: 'SPPRO' | 'SOI' | null = null;
                if (isDevolucaoDiretaEstoque && lancamento) {
                  const historicoUpper = (devolucao.historico || '').toUpperCase();
                  if (historicoUpper.includes('ESTOQUE SPPRO') || historicoUpper.includes('SPPRO')) {
                    tipoEstoqueDireta = 'SPPRO';
                  } else if (historicoUpper.includes('ESTOQUE SOI') || historicoUpper.includes('SOI')) {
                    tipoEstoqueDireta = 'SOI';
                  } else if (lancamento.historico) {
                    const lancHistoricoUpper = lancamento.historico.toUpperCase();
                    if (lancHistoricoUpper.includes('ESTOQUE SPPRO') || lancHistoricoUpper.includes('SPPRO')) {
                      tipoEstoqueDireta = 'SPPRO';
                    } else if (lancHistoricoUpper.includes('ESTOQUE SOI') || lancHistoricoUpper.includes('SOI')) {
                      tipoEstoqueDireta = 'SOI';
                    }
                  }
                }

                return (
                  <div
                    key={devolucao.id}
                    className="rounded-md border border-border/60 bg-muted/50 p-4 text-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-base">
                            Devolução #{devolucao.id}
                          </span>
                          {operacao && (
                            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                              Operação #{operacao.id}
                            </span>
                          )}
                          {isDevolucaoDiretaEstoque && (
                            <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                              Devolução Direta de Estoque
                            </span>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Data: </span>
                            {formatDate(devolucao.data_devolucao)}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Valor: </span>
                            <span className="text-orange-600 font-semibold">
                              {formatCurrency(devolucao.valor_devolucao)}
                            </span>
                          </div>
                          {conta && (
                            <div>
                              <span className="font-medium text-foreground">Conta: </span>
                              {conta.descricao}
                            </div>
                          )}
                          {isDevolucaoDiretaEstoque && tipoEstoqueDireta && (
                            <div>
                              <span className="font-medium text-foreground">Tipo de Estoque: </span>
                              <span className={`font-semibold ${tipoEstoqueDireta === 'SPPRO' ? 'text-blue-600' : 'text-purple-600'}`}>
                                {tipoEstoqueDireta}
                              </span>
                            </div>
                          )}
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
                          <div>
                            <span className="font-medium text-foreground">Face dos Títulos: </span>
                            {formatCurrency(operacao.face_titulos)}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Data da Operação: </span>
                            {formatDate(operacao.data)}
                          </div>
                          {operacao.tipo_operacao && (
                            <div>
                              <span className="font-medium text-foreground">Tipo de Operação: </span>
                              <span className="capitalize">{operacao.tipo_operacao}</span>
                            </div>
                          )}
                        </div>
                        {operacao.historico && (
                          <div className="text-muted-foreground">
                            <span className="font-medium text-foreground">Histórico da Operação: </span>
                            {operacao.historico}
                          </div>
                        )}
                      </div>
                    )}

                    {devolucao.historico && (
                      <div className="pt-2 border-t border-border/60">
                        <span className="font-medium text-foreground">Histórico da Devolução: </span>
                        <span className="text-muted-foreground">{devolucao.historico}</span>
                      </div>
                    )}

                    {devolucao.observacoes && (
                      <div className="pt-2 border-t border-border/60">
                        <span className="font-medium text-foreground">Observações: </span>
                        <span className="text-muted-foreground">{devolucao.observacoes}</span>
                      </div>
                    )}

                    {lancamento && (
                      <div className="pt-2 border-t border-border/60">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span className="font-medium text-foreground">Lançamento de Caixa: </span>
                          <span>#{lancamento.id}</span>
                          <span className="text-xs">({lancamento.tipo === 'entrada' ? 'Entrada' : 'Saída'})</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>

      {/* Histórico do Estoque Devoluções */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-orange-500" />
            Histórico do Estoque Devoluções
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoadingOperacoes && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Carregando histórico...</span>
              </div>
            )}

            {!isLoadingOperacoes && (!operacoesDevolucoes || operacoesDevolucoes.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                <Warehouse className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-lg font-medium">Nenhuma movimentação registrada</p>
                <p className="text-sm mt-2">As devoluções aparecerão aqui conforme forem sendo registradas</p>
              </div>
            )}

            {!isLoadingOperacoes && operacoesDevolucoes && operacoesDevolucoes.length > 0 && (
              <div className="space-y-3">
                {operacoesDevolucoes.map((operacao) => {
                  const fornecedor = operacao.fornecedores;
                  const conta = operacao.contas_bancarias;

                  return (
                    <div
                      key={operacao.id}
                      className="rounded-md border border-border/60 bg-muted/50 p-4 text-sm space-y-2"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base">
                              Operação #{operacao.id}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              operacao.tipo_operacao === 'entrada' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {operacao.tipo_operacao === 'entrada' ? 'Entrada' : 'Saída'}
                            </span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">Data: </span>
                              {formatDate(operacao.data)}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Valor: </span>
                              <span className={`font-semibold ${
                                operacao.tipo_operacao === 'entrada' 
                                  ? 'text-green-600' 
                                  : 'text-red-600'
                              }`}>
                                {operacao.tipo_operacao === 'entrada' ? '+' : '-'}
                                {formatCurrency(operacao.liquido_operacao)}
                              </span>
                            </div>
                            {fornecedor && (
                              <div>
                                <span className="font-medium text-foreground">Fornecedor: </span>
                                {fornecedor.nome_fantasia || fornecedor.razao_social}
                              </div>
                            )}
                            {conta && (
                              <div>
                                <span className="font-medium text-foreground">Conta: </span>
                                {conta.descricao}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {operacao.historico && (
                        <div className="pt-2 border-t border-border/60">
                          <span className="font-medium text-foreground">Histórico: </span>
                          <span className="text-muted-foreground">{operacao.historico}</span>
                        </div>
                      )}

                      {operacao.observacoes && (
                        <div className="pt-2 border-t border-border/60">
                          <span className="font-medium text-foreground">Observações: </span>
                          <span className="text-muted-foreground">{operacao.observacoes}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog para criar nova devolução */}
      <DevolucaoEstoqueDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        lancamentoData={lancamentoDataVazio}
        empresaId={empresaId}
      />

      {/* Dialog para transferir devoluções */}
      <TransferirDevolucoesDialog
        open={isTransferirDialogOpen}
        onOpenChange={setIsTransferirDialogOpen}
        empresaId={empresaId}
        contasBancarias={contasBancarias}
      />

      {/* Dialog de confirmação para limpar devoluções órfãs */}
      <AlertDialog open={isLimparDialogOpen} onOpenChange={setIsLimparDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Limpar Devoluções Órfãs
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Diagnóstico atual: <strong>{devolucoesOrfas.length}</strong> órfã(s), sendo{" "}
                <strong>{orfasLimpaveis.length}</strong> limpável(is) automaticamente e{" "}
                <strong>{orfasBloqueadas.length}</strong> bloqueada(s) por ambiguidade.
              </p>
              <p className="text-sm text-muted-foreground">
                A limpeza automática executa exclusão determinística apenas para itens limpáveis.
                Casos bloqueados permanecem sem mutação e exigem saneamento.
              </p>
              <p className="text-sm font-medium text-foreground">
                Esta ação irá:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 ml-2">
                <li>Limpar somente devoluções órfãs com rastreabilidade determinística</li>
                <li>Reportar devoluções bloqueadas por motivo, sem efeito parcial</li>
                <li>Invalidar listagens e saldos para manter consistência em tela</li>
              </ul>
              {resumoBloqueadas.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">
                    Bloqueadas por motivo:
                  </p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside mt-1">
                    {resumoBloqueadas.map(([motivo, qtd]) => (
                      <li key={motivo}>
                        {qtd}x {getMotivoDevolucaoOrfaMessage(motivo)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm font-medium text-destructive mt-4">
                Esta ação não pode ser desfeita.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={limparDevolucoesOrfas.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await limparDevolucoesOrfas.mutateAsync();
                  setIsLimparDialogOpen(false);
                } catch (error: unknown) {
                  console.error('Erro ao limpar devoluções órfãs:', error);
                }
              }}
              disabled={limparDevolucoesOrfas.isPending || orfasLimpaveis.length === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {limparDevolucoesOrfas.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Limpando...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {orfasLimpaveis.length > 0
                    ? `Limpar ${orfasLimpaveis.length} Devolução(ões)`
                    : 'Sem devoluções limpáveis'}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
