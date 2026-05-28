import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { TipoTransferencia, TipoEstoque } from "@/types/estoque";
import { useMovimentacoesEstoqueHistorico } from "@/hooks/useEstoque";

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

interface TransferenciasEstoqueProps {
  contasBancarias: ContaBancaria[];
  estoquesSelect: EstoqueSelect[];
  empresaId: string;
  onSubmit: (data: {
    tipo: TipoTransferencia;
    origem_id: string | number;
    destino_id: string | number;
    valor: number;
    data: string;
    historico?: string;
  }) => Promise<void>;
}

export function TransferenciasEstoque({
  contasBancarias,
  estoquesSelect,
  empresaId,
  onSubmit,
}: TransferenciasEstoqueProps) {
  const [tipoTransferencia, setTipoTransferencia] = useState<TipoTransferencia>("conta_para_estoque");
  const [contaOrigemId, setContaOrigemId] = useState<string>("");
  const [estoqueOrigemId, setEstoqueOrigemId] = useState<string>("");
  const [contaDestinoId, setContaDestinoId] = useState<string>("");
  const [estoqueDestinoId, setEstoqueDestinoId] = useState<string>("");
  const [valor, setValor] = useState<string>("");
  const [data, setData] = useState<string>(new Date().toISOString().split("T")[0]);
  const [historico, setHistorico] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [erro, setErro] = useState<string>("");
  const { data: movimentacoesHistorico, isLoading: isLoadingHistorico } = useMovimentacoesEstoqueHistorico(15);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const validarTransferencia = (): string | null => {
    const valorNum = parseFloat(valor);
    
    if (!valor || valorNum <= 0) {
      return "Valor deve ser maior que zero";
    }

    if (!data) {
      return "Data é obrigatória";
    }

    if (tipoTransferencia === "conta_para_estoque") {
      if (!contaOrigemId) return "Selecione a conta de origem";
      if (!estoqueDestinoId) return "Selecione o estoque de destino";
    } else if (tipoTransferencia === "estoque_para_conta") {
      if (!estoqueOrigemId) return "Selecione o estoque de origem";
      if (!contaDestinoId) return "Selecione a conta de destino";
      
      // Validar saldo suficiente no estoque de origem
      const estoqueOrigem = estoquesSelect.find((e) => e.id.toString() === estoqueOrigemId);
      if (estoqueOrigem && estoqueOrigem.saldo_atual < valorNum) {
        return `Saldo insuficiente no estoque de origem (Saldo: ${formatCurrency(estoqueOrigem.saldo_atual)})`;
      }
    } else if (tipoTransferencia === "estoque_para_estoque") {
      if (!estoqueOrigemId) return "Selecione o estoque de origem";
      if (!estoqueDestinoId) return "Selecione o estoque de destino";
      
      if (estoqueOrigemId === estoqueDestinoId) {
        return "Estoque de origem e destino devem ser diferentes";
      }

      // Permitir transferências entre tipos diferentes (SPPRO ↔ SOI)
      const estoqueOrigem = estoquesSelect.find((e) => e.id.toString() === estoqueOrigemId);
      
      // Validar saldo suficiente
      if (estoqueOrigem && estoqueOrigem.saldo_atual < valorNum) {
        return `Saldo insuficiente no estoque de origem (Saldo: ${formatCurrency(estoqueOrigem.saldo_atual)})`;
      }
    } else if (tipoTransferencia === "conta_para_conta") {
      if (!contaOrigemId) return "Selecione a conta de origem";
      if (!contaDestinoId) return "Selecione a conta de destino";
      
      if (contaOrigemId === contaDestinoId) {
        return "Conta de origem e destino devem ser diferentes";
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");

    const erroValidacao = validarTransferencia();
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }

    setIsSubmitting(true);

    try {
      let origemId: string | number;
      let destinoId: string | number;

      if (tipoTransferencia === "conta_para_estoque") {
        origemId = contaOrigemId;
        destinoId = Number.parseInt(estoqueDestinoId, 10);
      } else if (tipoTransferencia === "estoque_para_conta") {
        origemId = Number.parseInt(estoqueOrigemId, 10);
        destinoId = contaDestinoId;
      } else if (tipoTransferencia === "conta_para_conta") {
        origemId = contaOrigemId;
        destinoId = contaDestinoId;
      } else {
        origemId = Number.parseInt(estoqueOrigemId, 10);
        destinoId = Number.parseInt(estoqueDestinoId, 10);
      }

      await onSubmit({
        tipo: tipoTransferencia,
        origem_id: origemId,
        destino_id: destinoId,
        valor: parseFloat(valor),
        data,
        historico: historico || undefined,
      });

      // Reset form
      setContaOrigemId("");
      setEstoqueOrigemId("");
      setContaDestinoId("");
      setEstoqueDestinoId("");
      setValor("");
      setHistorico("");
      setData(new Date().toISOString().split("T")[0]);
    } catch (error: any) {
      setErro(error.message || "Erro ao registrar transferência");
    } finally {
      setIsSubmitting(false);
    }
  };

  const estoquesFiltrados = (tipo?: TipoEstoque) => {
    if (!tipo) return estoquesSelect;
    return estoquesSelect.filter((e) => e.tipo === tipo);
  };

  const movimentacoesFormatadas = useMemo(() => {
    if (!movimentacoesHistorico) return [];

    const formatDate = (value: string | null | undefined) => {
      if (!value) return "-";
      try {
        const date = new Date(value + "T00:00:00");
        if (Number.isNaN(date.getTime())) return "-";
        return date.toLocaleDateString("pt-BR");
      } catch {
        return "-";
      }
    };

    const getOrigemDestino = (mov: typeof movimentacoesHistorico[number]) => {
      switch (mov.tipo) {
        case "conta_para_estoque":
          return {
            origem: mov.conta_bancaria?.descricao || "Conta",
            destino: mov.estoque_destino?.descricao || "Estoque",
          };
        case "estoque_para_conta":
          return {
            origem: mov.estoque_origem?.descricao || "Estoque",
            destino: mov.conta_bancaria?.descricao || "Conta",
          };
        case "estoque_para_estoque":
          return {
            origem: mov.estoque_origem?.descricao || "Estoque origem",
            destino: mov.estoque_destino?.descricao || "Estoque destino",
          };
        case "conta_para_conta":
          return {
            origem: mov.conta_bancaria_origem?.descricao || mov.conta_bancaria?.descricao || "Conta origem",
            destino: mov.conta_bancaria_destino?.descricao || "Conta destino",
          };
        default:
          return { origem: "-", destino: "-" };
      }
    };

    const tipoLabel: Record<TipoTransferencia, string> = {
      conta_para_estoque: "Conta → Estoque",
      estoque_para_conta: "Estoque → Conta",
      estoque_para_estoque: "Estoque → Estoque",
      conta_para_conta: "Conta → Conta",
    };

    return movimentacoesHistorico.map((mov) => {
      const { origem, destino } = getOrigemDestino(mov);
      return {
        id: mov.id,
        tipo: tipoLabel[mov.tipo] ?? mov.tipo,
        orig: origem,
        dest: destino,
        valor: mov.valor,
        data: formatDate(mov.data),
        historico: mov.historico,
      };
    });
  }, [movimentacoesHistorico]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transferências</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tipoTransferencia} onValueChange={(v) => setTipoTransferencia(v as TipoTransferencia)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="conta_para_estoque">Conta → Estoque</TabsTrigger>
            <TabsTrigger value="estoque_para_conta">Estoque → Conta</TabsTrigger>
            <TabsTrigger value="estoque_para_estoque">Estoque → Estoque</TabsTrigger>
            <TabsTrigger value="conta_para_conta">Conta → Conta</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <TabsContent value="conta_para_estoque" className="space-y-4">
              <div>
                <Label htmlFor="conta-origem-transfer">Conta de Origem *</Label>
                <Select value={contaOrigemId} onValueChange={setContaOrigemId} required>
                  <SelectTrigger id="conta-origem-transfer">
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

              <div>
                <Label htmlFor="estoque-destino-transfer">Estoque de Destino *</Label>
                <Select value={estoqueDestinoId} onValueChange={setEstoqueDestinoId} required>
                  <SelectTrigger id="estoque-destino-transfer">
                    <SelectValue placeholder="Selecione o estoque..." />
                  </SelectTrigger>
                  <SelectContent>
                    {estoquesSelect.map((estoque) => (
                      <SelectItem key={estoque.id} value={estoque.id.toString()}>
                        {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="estoque_para_conta" className="space-y-4">
              <div>
                <Label htmlFor="estoque-origem-transfer">Estoque de Origem *</Label>
                <Select value={estoqueOrigemId} onValueChange={setEstoqueOrigemId} required>
                  <SelectTrigger id="estoque-origem-transfer">
                    <SelectValue placeholder="Selecione o estoque..." />
                  </SelectTrigger>
                  <SelectContent>
                    {estoquesSelect.map((estoque) => (
                      <SelectItem key={estoque.id} value={estoque.id.toString()}>
                        {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="conta-destino-transfer">Conta de Destino *</Label>
                <Select value={contaDestinoId} onValueChange={setContaDestinoId} required>
                  <SelectTrigger id="conta-destino-transfer">
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
            </TabsContent>

            <TabsContent value="estoque_para_estoque" className="space-y-4">
              <div>
                <Label htmlFor="estoque-origem-ee">Estoque de Origem *</Label>
                <Select value={estoqueOrigemId} onValueChange={setEstoqueOrigemId} required>
                  <SelectTrigger id="estoque-origem-ee">
                    <SelectValue placeholder="Selecione o estoque..." />
                  </SelectTrigger>
                  <SelectContent>
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
                <Select value={estoqueDestinoId} onValueChange={setEstoqueDestinoId} required>
                  <SelectTrigger id="estoque-destino-ee">
                    <SelectValue placeholder="Selecione o estoque..." />
                  </SelectTrigger>
                  <SelectContent>
                    {estoquesSelect
                      .filter((e) => e.id.toString() !== estoqueOrigemId)
                      .map((estoque) => (
                          <SelectItem
                            key={estoque.id}
                            value={estoque.id.toString()}
                          >
                            {estoque.descricao || `Estoque #${estoque.id}`} ({estoque.tipo}) - {formatCurrency(estoque.saldo_atual)}
                          </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="conta_para_conta" className="space-y-4">
              <div>
                <Label htmlFor="conta-origem-cc">Conta de Origem *</Label>
                <Select value={contaOrigemId} onValueChange={setContaOrigemId} required>
                  <SelectTrigger id="conta-origem-cc">
                    <SelectValue placeholder="Selecione a conta de origem..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contasBancarias
                      .filter((c) => c.id !== contaDestinoId)
                      .map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.descricao}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="conta-destino-cc">Conta de Destino *</Label>
                <Select value={contaDestinoId} onValueChange={setContaDestinoId} required>
                  <SelectTrigger id="conta-destino-cc">
                    <SelectValue placeholder="Selecione a conta de destino..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contasBancarias
                      .filter((c) => c.id !== contaOrigemId)
                      .map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.descricao}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="valor-transfer">Valor *</Label>
                <Input
                  id="valor-transfer"
                  type="number"
                  step="0.01"
                  min="0"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="data-transfer">Data *</Label>
                <Input
                  id="data-transfer"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="historico-transfer">Histórico</Label>
              <Textarea
                id="historico-transfer"
                value={historico}
                onChange={(e) => setHistorico(e.target.value)}
                rows={3}
                placeholder="Descreva a transferência..."
              />
            </div>

            {erro && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{erro}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Registrando..." : "Registrar Transferência"}
            </Button>
          </form>
        </Tabs>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Histórico de transferências</h3>
            {isLoadingHistorico && <span className="text-sm text-muted-foreground">Carregando...</span>}
          </div>

          {!isLoadingHistorico && movimentacoesFormatadas.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma transferência registrada recentemente.</p>
          )}

          {movimentacoesFormatadas.length > 0 && (
            <div className="space-y-2">
              {movimentacoesFormatadas.map((mov) => (
                <div
                  key={mov.id}
                  className="rounded-md border border-border/60 bg-muted/50 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{mov.tipo}</span>
                    <span className="text-muted-foreground">{mov.data}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                    <span>
                      <span className="font-medium text-foreground">Origem: </span>
                      {mov.orig}
                    </span>
                    <span>
                      <span className="font-medium text-foreground">Destino: </span>
                      {mov.dest}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Valor movimentado</span>
                    <span className="text-base font-semibold text-foreground">
                      {formatCurrency(mov.valor)}
                    </span>
                  </div>
                  {mov.historico && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Histórico:</span> {mov.historico}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

