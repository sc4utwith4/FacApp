import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { RelatorioBancoPDF } from "@/types/relatorio-banco-pdf";
import { formatCurrency } from "@/lib/utils";

interface EditarRelatorioBancoProps {
  relatorio: RelatorioBancoPDF;
  onSuccess: () => void;
  onCancel?: () => void;
}

export function EditarRelatorioBanco({ relatorio, onSuccess, onCancel }: EditarRelatorioBancoProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    // Dados da Consulta
    agencia: relatorio.agencia || "",
    conta: relatorio.conta || "",
    beneficiario_nome: relatorio.beneficiario_nome || "",
    beneficiario_razao: relatorio.beneficiario_razao || "",
    data_operacao: relatorio.data_operacao || "",
    hora_operacao: relatorio.hora_operacao || "",
    
    // Posição de Carteira
    saldo_anterior_qtd: relatorio.saldo_anterior_qtd?.toString() || "0",
    saldo_anterior_valor: relatorio.saldo_anterior_valor?.toString() || "0",
    saldo_entradas_qtd: relatorio.saldo_entradas_qtd?.toString() || "0",
    saldo_entradas_valor: relatorio.saldo_entradas_valor?.toString() || "0",
    saldo_baixas_qtd: relatorio.saldo_baixas_qtd?.toString() || "0",
    saldo_baixas_valor: relatorio.saldo_baixas_valor?.toString() || "0",
    saldo_atual_qtd: relatorio.saldo_atual_qtd?.toString() || "0",
    saldo_atual_valor: relatorio.saldo_atual_valor?.toString() || "0",
    registrados_mes_qtd: relatorio.registrados_mes_qtd?.toString() || "0",
    registrados_mes_valor: relatorio.registrados_mes_valor?.toString() || "0",
    registrados_mes_anterior_qtd: relatorio.registrados_mes_anterior_qtd?.toString() || "0",
    registrados_mes_anterior_valor: relatorio.registrados_mes_anterior_valor?.toString() || "0",
    acumulados_pagos_mes_qtd: relatorio.acumulados_pagos_mes_qtd?.toString() || "0",
    acumulados_pagos_mes_valor: relatorio.acumulados_pagos_mes_valor?.toString() || "0",
    acumulados_nao_pagos_mes_qtd: relatorio.acumulados_nao_pagos_mes_qtd?.toString() || "0",
    acumulados_nao_pagos_mes_valor: relatorio.acumulados_nao_pagos_mes_valor?.toString() || "0",
    acumulados_pagos_compensacao_mes_qtd: relatorio.acumulados_pagos_compensacao_mes_qtd?.toString() || "0",
    acumulados_pagos_compensacao_mes_valor: relatorio.acumulados_pagos_compensacao_mes_valor?.toString() || "0",
    pagos_mes_anterior_qtd: relatorio.pagos_mes_anterior_qtd?.toString() || "0",
    pagos_mes_anterior_valor: relatorio.pagos_mes_anterior_valor?.toString() || "0",
    pagos_compensacao_mes_anterior_qtd: relatorio.pagos_compensacao_mes_anterior_qtd?.toString() || "0",
    pagos_compensacao_mes_anterior_valor: relatorio.pagos_compensacao_mes_anterior_valor?.toString() || "0",
    titulos_instrucao_protesto_qtd: relatorio.titulos_instrucao_protesto_qtd?.toString() || "0",
    titulos_instrucao_protesto_valor: relatorio.titulos_instrucao_protesto_valor?.toString() || "0",
    titulos_poder_cartorio_qtd: relatorio.titulos_poder_cartorio_qtd?.toString() || "0",
    titulos_poder_cartorio_valor: relatorio.titulos_poder_cartorio_valor?.toString() || "0",
    
    // Índice Liquidez
    liquidez_diaria_percent: relatorio.liquidez_diaria_percent?.toString() || "0",
    liquidez_mensal_percent: relatorio.liquidez_mensal_percent?.toString() || "0",
    
    // Observações
    observacoes: relatorio.observacoes || "",
  });

  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Detectar mudanças
    const original = {
      agencia: relatorio.agencia || "",
      conta: relatorio.conta || "",
      // ... outros campos
    };
    // Comparação simplificada - em produção, fazer comparação completa
    setHasChanges(true);
  }, [formData, relatorio]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const updateData: Partial<RelatorioBancoPDF> = {
        agencia: formData.agencia || null,
        conta: formData.conta || null,
        beneficiario_nome: formData.beneficiario_nome || null,
        beneficiario_razao: formData.beneficiario_razao || null,
        data_operacao: formData.data_operacao || null,
        hora_operacao: formData.hora_operacao || null,
        saldo_anterior_qtd: parseInt(formData.saldo_anterior_qtd) || null,
        saldo_anterior_valor: parseFloat(formData.saldo_anterior_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        saldo_entradas_qtd: parseInt(formData.saldo_entradas_qtd) || null,
        saldo_entradas_valor: parseFloat(formData.saldo_entradas_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        saldo_baixas_qtd: parseInt(formData.saldo_baixas_qtd) || null,
        saldo_baixas_valor: parseFloat(formData.saldo_baixas_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        saldo_atual_qtd: parseInt(formData.saldo_atual_qtd) || null,
        saldo_atual_valor: parseFloat(formData.saldo_atual_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        registrados_mes_qtd: parseInt(formData.registrados_mes_qtd) || null,
        registrados_mes_valor: parseFloat(formData.registrados_mes_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        registrados_mes_anterior_qtd: parseInt(formData.registrados_mes_anterior_qtd) || null,
        registrados_mes_anterior_valor: parseFloat(formData.registrados_mes_anterior_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        acumulados_pagos_mes_qtd: parseInt(formData.acumulados_pagos_mes_qtd) || null,
        acumulados_pagos_mes_valor: parseFloat(formData.acumulados_pagos_mes_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        acumulados_nao_pagos_mes_qtd: parseInt(formData.acumulados_nao_pagos_mes_qtd) || null,
        acumulados_nao_pagos_mes_valor: parseFloat(formData.acumulados_nao_pagos_mes_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        acumulados_pagos_compensacao_mes_qtd: parseInt(formData.acumulados_pagos_compensacao_mes_qtd) || null,
        acumulados_pagos_compensacao_mes_valor: parseFloat(formData.acumulados_pagos_compensacao_mes_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        pagos_mes_anterior_qtd: parseInt(formData.pagos_mes_anterior_qtd) || null,
        pagos_mes_anterior_valor: parseFloat(formData.pagos_mes_anterior_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        pagos_compensacao_mes_anterior_qtd: parseInt(formData.pagos_compensacao_mes_anterior_qtd) || null,
        pagos_compensacao_mes_anterior_valor: parseFloat(formData.pagos_compensacao_mes_anterior_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        titulos_instrucao_protesto_qtd: parseInt(formData.titulos_instrucao_protesto_qtd) || null,
        titulos_instrucao_protesto_valor: parseFloat(formData.titulos_instrucao_protesto_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        titulos_poder_cartorio_qtd: parseInt(formData.titulos_poder_cartorio_qtd) || null,
        titulos_poder_cartorio_valor: parseFloat(formData.titulos_poder_cartorio_valor.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        liquidez_diaria_percent: parseFloat(formData.liquidez_diaria_percent.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        liquidez_mensal_percent: parseFloat(formData.liquidez_mensal_percent.replace(/[^\d,.-]/g, "").replace(",", ".")) || null,
        observacoes: formData.observacoes || null,
      };

      const { error } = await supabase
        .from("relatorios_banco_pdf")
        .update(updateData)
        .eq("id", relatorio.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relatorios-banco"] });
      toast.success("Relatório atualizado com sucesso");
      onSuccess();
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Dados da Consulta */}
      <Card>
        <CardHeader>
          <CardTitle>Dados da Consulta</CardTitle>
          <CardDescription>Informações básicas do relatório bancário</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Agência</Label>
              <Input
                value={formData.agencia}
                onChange={(e) => setFormData({ ...formData, agencia: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Conta</Label>
              <Input
                value={formData.conta}
                onChange={(e) => setFormData({ ...formData, conta: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Beneficiário</Label>
              <Input
                value={formData.beneficiario_nome}
                onChange={(e) => setFormData({ ...formData, beneficiario_nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Razão</Label>
              <Input
                value={formData.beneficiario_razao}
                onChange={(e) => setFormData({ ...formData, beneficiario_razao: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Data da Operação</Label>
              <Input
                type="date"
                value={formData.data_operacao}
                onChange={(e) => setFormData({ ...formData, data_operacao: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Hora da Operação</Label>
              <Input
                type="time"
                value={formData.hora_operacao}
                onChange={(e) => setFormData({ ...formData, hora_operacao: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Posição de Carteira */}
      <Card>
        <CardHeader>
          <CardTitle>Posição de Carteira</CardTitle>
          <CardDescription>Valores e quantidades da carteira</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Saldo Anterior - Qtd</Label>
              <Input
                type="number"
                value={formData.saldo_anterior_qtd}
                onChange={(e) => setFormData({ ...formData, saldo_anterior_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Anterior - Valor</Label>
              <Input
                value={formData.saldo_anterior_valor}
                onChange={(e) => setFormData({ ...formData, saldo_anterior_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Entradas - Qtd</Label>
              <Input
                type="number"
                value={formData.saldo_entradas_qtd}
                onChange={(e) => setFormData({ ...formData, saldo_entradas_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Entradas - Valor</Label>
              <Input
                value={formData.saldo_entradas_valor}
                onChange={(e) => setFormData({ ...formData, saldo_entradas_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Baixas - Qtd</Label>
              <Input
                type="number"
                value={formData.saldo_baixas_qtd}
                onChange={(e) => setFormData({ ...formData, saldo_baixas_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Baixas - Valor</Label>
              <Input
                value={formData.saldo_baixas_valor}
                onChange={(e) => setFormData({ ...formData, saldo_baixas_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Atual - Qtd</Label>
              <Input
                type="number"
                value={formData.saldo_atual_qtd}
                onChange={(e) => setFormData({ ...formData, saldo_atual_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Atual - Valor</Label>
              <Input
                value={formData.saldo_atual_valor}
                onChange={(e) => setFormData({ ...formData, saldo_atual_valor: e.target.value })}
              />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Registrados Mês - Qtd</Label>
              <Input
                type="number"
                value={formData.registrados_mes_qtd}
                onChange={(e) => setFormData({ ...formData, registrados_mes_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Registrados Mês - Valor</Label>
              <Input
                value={formData.registrados_mes_valor}
                onChange={(e) => setFormData({ ...formData, registrados_mes_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Registrados Mês Anterior - Qtd</Label>
              <Input
                type="number"
                value={formData.registrados_mes_anterior_qtd}
                onChange={(e) => setFormData({ ...formData, registrados_mes_anterior_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Registrados Mês Anterior - Valor</Label>
              <Input
                value={formData.registrados_mes_anterior_valor}
                onChange={(e) => setFormData({ ...formData, registrados_mes_anterior_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Acumulados Pagos Mês - Qtd</Label>
              <Input
                type="number"
                value={formData.acumulados_pagos_mes_qtd}
                onChange={(e) => setFormData({ ...formData, acumulados_pagos_mes_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Acumulados Pagos Mês - Valor</Label>
              <Input
                value={formData.acumulados_pagos_mes_valor}
                onChange={(e) => setFormData({ ...formData, acumulados_pagos_mes_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Acumulados Não Pagos Mês - Qtd</Label>
              <Input
                type="number"
                value={formData.acumulados_nao_pagos_mes_qtd}
                onChange={(e) => setFormData({ ...formData, acumulados_nao_pagos_mes_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Acumulados Não Pagos Mês - Valor</Label>
              <Input
                value={formData.acumulados_nao_pagos_mes_valor}
                onChange={(e) => setFormData({ ...formData, acumulados_nao_pagos_mes_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Acumulados Pagos Compensação Mês - Qtd</Label>
              <Input
                type="number"
                value={formData.acumulados_pagos_compensacao_mes_qtd}
                onChange={(e) => setFormData({ ...formData, acumulados_pagos_compensacao_mes_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Acumulados Pagos Compensação Mês - Valor</Label>
              <Input
                value={formData.acumulados_pagos_compensacao_mes_valor}
                onChange={(e) => setFormData({ ...formData, acumulados_pagos_compensacao_mes_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pagos Mês Anterior - Qtd</Label>
              <Input
                type="number"
                value={formData.pagos_mes_anterior_qtd}
                onChange={(e) => setFormData({ ...formData, pagos_mes_anterior_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pagos Mês Anterior - Valor</Label>
              <Input
                value={formData.pagos_mes_anterior_valor}
                onChange={(e) => setFormData({ ...formData, pagos_mes_anterior_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pagos Compensação Mês Anterior - Qtd</Label>
              <Input
                type="number"
                value={formData.pagos_compensacao_mes_anterior_qtd}
                onChange={(e) => setFormData({ ...formData, pagos_compensacao_mes_anterior_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pagos Compensação Mês Anterior - Valor</Label>
              <Input
                value={formData.pagos_compensacao_mes_anterior_valor}
                onChange={(e) => setFormData({ ...formData, pagos_compensacao_mes_anterior_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Títulos Instrução Protesto - Qtd</Label>
              <Input
                type="number"
                value={formData.titulos_instrucao_protesto_qtd}
                onChange={(e) => setFormData({ ...formData, titulos_instrucao_protesto_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Títulos Instrução Protesto - Valor</Label>
              <Input
                value={formData.titulos_instrucao_protesto_valor}
                onChange={(e) => setFormData({ ...formData, titulos_instrucao_protesto_valor: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Títulos Poder Cartório - Qtd</Label>
              <Input
                type="number"
                value={formData.titulos_poder_cartorio_qtd}
                onChange={(e) => setFormData({ ...formData, titulos_poder_cartorio_qtd: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Títulos Poder Cartório - Valor</Label>
              <Input
                value={formData.titulos_poder_cartorio_valor}
                onChange={(e) => setFormData({ ...formData, titulos_poder_cartorio_valor: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Índice Liquidez */}
      <Card>
        <CardHeader>
          <CardTitle>Índice Liquidez</CardTitle>
          <CardDescription>Percentuais de liquidez</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Liquidez Diária (%)</Label>
              <Input
                value={formData.liquidez_diaria_percent}
                onChange={(e) => setFormData({ ...formData, liquidez_diaria_percent: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Liquidez Mensal (%)</Label>
              <Input
                value={formData.liquidez_mensal_percent}
                onChange={(e) => setFormData({ ...formData, liquidez_mensal_percent: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Observações */}
      <Card>
        <CardHeader>
          <CardTitle>Observações</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.observacoes}
            onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Botões */}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

