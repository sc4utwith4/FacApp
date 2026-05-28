import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DistribuicaoConta } from "@/types/estoque";

interface ContaBancaria {
  id: string;
  descricao: string;
}

interface DistribuicaoContasProps {
  liquidoOperacao: number;
  contasBancarias: ContaBancaria[];
  distribuicoes: DistribuicaoConta[];
  onChange: (distribuicoes: DistribuicaoConta[]) => void;
}

export function DistribuicaoContas({
  liquidoOperacao,
  contasBancarias,
  distribuicoes,
  onChange,
}: DistribuicaoContasProps) {
  const [distribuicoesLocais, setDistribuicoesLocais] = useState<DistribuicaoConta[]>(distribuicoes);

  useEffect(() => {
    setDistribuicoesLocais(distribuicoes);
  }, [distribuicoes]);

  const totalDistribuido = useMemo(() => {
    return distribuicoesLocais.reduce((sum, d) => sum + (d.valor || 0), 0);
  }, [distribuicoesLocais]);

  const diferenca = useMemo(() => {
    return liquidoOperacao - totalDistribuido;
  }, [liquidoOperacao, totalDistribuido]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const handleAddLinha = () => {
    const novaDistribuicao: DistribuicaoConta = {
      conta_bancaria_id: "",
      valor: 0,
    };
    const novas = [...distribuicoesLocais, novaDistribuicao];
    setDistribuicoesLocais(novas);
    onChange(novas);
  };

  const handleRemoveLinha = (index: number) => {
    const novas = distribuicoesLocais.filter((_, i) => i !== index);
    setDistribuicoesLocais(novas);
    onChange(novas);
  };

  const handleContaChange = (index: number, contaId: string) => {
    const novas = [...distribuicoesLocais];
    novas[index] = { ...novas[index], conta_bancaria_id: contaId };
    setDistribuicoesLocais(novas);
    onChange(novas);
  };

  const handleValorChange = (index: number, valor: string) => {
    const valorNum = parseFloat(valor) || 0;
    const novas = [...distribuicoesLocais];
    novas[index] = { ...novas[index], valor: valorNum };
    setDistribuicoesLocais(novas);
    onChange(novas);
  };

  const contasDisponiveis = (index: number) => {
    const contaSelecionada = distribuicoesLocais[index]?.conta_bancaria_id;
    return contasBancarias.filter(
      (conta) => !contaSelecionada || conta.id === contaSelecionada || 
      !distribuicoesLocais.some((d, i) => i !== index && d.conta_bancaria_id === conta.id)
    );
  };

  const isValido = true; // Sempre válido, diferença permanece no estoque

  return (
    <Card className="mt-4 border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Distribuir Líquido entre Contas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2">
          {distribuicoesLocais.map((distribuicao, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                <Label htmlFor={`conta-${index}`}>Conta Bancária</Label>
                <Select
                  value={distribuicao.conta_bancaria_id || undefined}
                  onValueChange={(value) => handleContaChange(index, value)}
                >
                  <SelectTrigger id={`conta-${index}`}>
                    <SelectValue placeholder="Selecione uma conta..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contasDisponiveis(index).map((conta) => (
                      <SelectItem key={conta.id} value={conta.id}>
                        {conta.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-5">
                <Label htmlFor={`valor-${index}`}>Valor</Label>
                <Input
                  id={`valor-${index}`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={distribuicao.valor || ""}
                  onChange={(e) => handleValorChange(index, e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleRemoveLinha(index)}
                  disabled={distribuicoesLocais.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleAddLinha}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          Adicionar Conta
        </Button>

        <div className="space-y-2 pt-2 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Líquido da Operação:</span>
            <span className="font-medium">{formatCurrency(liquidoOperacao)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Distribuído:</span>
            <span className="font-medium">{formatCurrency(totalDistribuido)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold">
            <span className={diferenca >= 0 ? "text-muted-foreground" : "text-destructive"}>
              {diferenca >= 0 ? "Saldo a Distribuir:" : "Excesso Distribuído:"}
            </span>
            <span className={diferenca >= 0 ? "text-success" : "text-destructive"}>
              {formatCurrency(Math.abs(diferenca))}
            </span>
          </div>
        </div>

        {diferenca > 0.01 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {formatCurrency(diferenca)} permanecerá no estoque.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

