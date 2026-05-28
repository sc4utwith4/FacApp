import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { TituloCobranca, EventoCobranca } from "@/types/cobranca-bancaria";
import { formatCurrency } from "@/lib/utils";
import {
  calcularLiquidacao,
  validarParametrosLiquidacao,
  type ParametrosLiquidacao,
  type ResultadoLiquidacao,
} from "@/utils/calculoLiquidacao";

interface CalculoLiquidacaoModalProps {
  titulo: TituloCobranca;
  evento?: EventoCobranca | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CalculoLiquidacaoModal({
  titulo,
  evento,
  isOpen,
  onClose,
  onSuccess,
}: CalculoLiquidacaoModalProps) {
  const [parametros, setParametros] = useState<ParametrosLiquidacao>({
    valor_nominal: titulo.valor_nominal,
    data_vencimento: titulo.vencimento,
    data_liquidacao: new Date().toISOString().split("T")[0],
    regras_juros_multa: {
      juros_diario: 0.033, // 0.033% ao dia (padrão)
      multa_atraso: 2, // 2% (padrão)
      desconto_antecipacao: 0,
    },
    tarifa_bancaria: 0,
    comissao_factoring: 0,
    percentual_repasse: 100,
  });

  const [resultado, setResultado] = useState<ResultadoLiquidacao | null>(null);
  const [validacao, setValidacao] = useState<{ valido: boolean; erros: string[] }>({
    valido: true,
    erros: [],
  });

  // Recalcular sempre que os parâmetros mudarem
  useEffect(() => {
    const validacaoResult = validarParametrosLiquidacao(parametros);
    setValidacao(validacaoResult);

    if (validacaoResult.valido) {
      const calculado = calcularLiquidacao(parametros);
      setResultado(calculado);
    } else {
      setResultado(null);
    }
  }, [parametros]);

  // Mutation para criar/atualizar evento de liquidação
  const salvarMutation = useMutation({
    mutationFn: async (resultadoCalc: ResultadoLiquidacao) => {
      if (!resultadoCalc) throw new Error("Resultado de cálculo inválido");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const eventoData = {
        titulo_id: titulo.id,
        carteira_id: titulo.carteira_id,
        tipo_evento: "LIQUIDACAO" as const,
        data_evento: parametros.data_liquidacao,
        valor_principal: resultadoCalc.valor_principal,
        juros: resultadoCalc.juros,
        multa: resultadoCalc.multa,
        desconto: resultadoCalc.desconto,
        tarifa: resultadoCalc.tarifa,
        valor_liquido: resultadoCalc.valor_liquido,
        origem: {
          usuario: user.id,
          tipo: "calculo_manual",
          parametros: parametros,
        },
        conciliado: true,
        confianca_conciliacao: 100,
        observacoes: `Cálculo manual: ${resultadoCalc.dias_atraso ? `${resultadoCalc.dias_atraso} dias de atraso` : resultadoCalc.dias_antecipacao ? `${resultadoCalc.dias_antecipacao} dias antecipado` : "No prazo"}`,
      };

      if (evento) {
        // Atualizar evento existente
        const { error } = await supabase
          .from("eventos_cobranca")
          .update(eventoData)
          .eq("id", evento.id);

        if (error) throw error;
      } else {
        // Criar novo evento
        const { error } = await supabase.from("eventos_cobranca").insert(eventoData);

        if (error) throw error;
      }

      // Atualizar status do título
      await supabase
        .from("titulos_cobranca")
        .update({ status_atual: "LIQUIDADO" })
        .eq("id", titulo.id);
    },
    onSuccess: () => {
      toast.success("Liquidação calculada e salva com sucesso");
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast.error(`Erro ao salvar liquidação: ${error.message}`);
    },
  });

  const handleSalvar = () => {
    if (!resultado || !validacao.valido) {
      toast.error("Corrija os erros antes de salvar");
      return;
    }

    salvarMutation.mutate(resultado);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cálculo de Liquidação</DialogTitle>
          <DialogDescription>
            Calcule os valores de liquidação para este título
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Parâmetros */}
          <div className="space-y-4">
            <h3 className="font-semibold">Parâmetros</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data de Liquidação</Label>
                <Input
                  type="date"
                  value={parametros.data_liquidacao}
                  onChange={(e) =>
                    setParametros({ ...parametros, data_liquidacao: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Juros Diário (%)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={parametros.regras_juros_multa?.juros_diario || 0}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      regras_juros_multa: {
                        ...parametros.regras_juros_multa,
                        juros_diario: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Multa de Atraso (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={parametros.regras_juros_multa?.multa_atraso || 0}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      regras_juros_multa: {
                        ...parametros.regras_juros_multa,
                        multa_atraso: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Desconto Antecipação (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={parametros.regras_juros_multa?.desconto_antecipacao || 0}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      regras_juros_multa: {
                        ...parametros.regras_juros_multa,
                        desconto_antecipacao: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Tarifa Bancária</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={parametros.tarifa_bancaria || 0}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      tarifa_bancaria: Number(e.target.value),
                    })
                  }
                  placeholder="Valor fixo ou % (se < 1)"
                />
              </div>
              <div className="space-y-2">
                <Label>Comissão Factoring (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={parametros.comissao_factoring || 0}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      comissao_factoring: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Percentual de Repasse (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={parametros.percentual_repasse || 100}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      percentual_repasse: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            {/* Erros de validação */}
            {!validacao.valido && validacao.erros.length > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-sm font-semibold text-red-800 mb-2">Erros:</p>
                <ul className="list-disc list-inside text-sm text-red-700">
                  {validacao.erros.map((erro, index) => (
                    <li key={index}>{erro}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Preview do Cálculo */}
          {resultado && validacao.valido && (
            <Card>
              <CardHeader>
                <CardTitle>Resultado do Cálculo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Valor Principal:</span>
                    <span className="font-semibold">{formatCurrency(resultado.valor_principal)}</span>
                  </div>
                  {resultado.juros > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span className="text-sm">Juros:</span>
                      <span className="font-semibold">+{formatCurrency(resultado.juros)}</span>
                    </div>
                  )}
                  {resultado.multa > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span className="text-sm">Multa:</span>
                      <span className="font-semibold">+{formatCurrency(resultado.multa)}</span>
                    </div>
                  )}
                  {resultado.desconto > 0 && (
                    <div className="flex justify-between text-blue-600">
                      <span className="text-sm">Desconto:</span>
                      <span className="font-semibold">-{formatCurrency(resultado.desconto)}</span>
                    </div>
                  )}
                  {resultado.tarifa > 0 && (
                    <div className="flex justify-between text-orange-600">
                      <span className="text-sm">Tarifa:</span>
                      <span className="font-semibold">-{formatCurrency(resultado.tarifa)}</span>
                    </div>
                  )}
                  {resultado.comissao > 0 && (
                    <div className="flex justify-between text-orange-600">
                      <span className="text-sm">Comissão:</span>
                      <span className="font-semibold">-{formatCurrency(resultado.comissao)}</span>
                    </div>
                  )}
                  <div className="pt-3 border-t">
                    <div className="flex justify-between">
                      <span className="text-lg font-semibold">Valor Líquido:</span>
                      <span className="text-lg font-bold">{formatCurrency(resultado.valor_liquido)}</span>
                    </div>
                  </div>
                  {resultado.dias_atraso && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {resultado.dias_atraso} dias de atraso
                    </p>
                  )}
                  {resultado.dias_antecipacao && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {resultado.dias_antecipacao} dias antecipado
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSalvar}
            disabled={!resultado || !validacao.valido || salvarMutation.isPending}
          >
            {salvarMutation.isPending ? "Salvando..." : evento ? "Atualizar" : "Aplicar Cálculo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

