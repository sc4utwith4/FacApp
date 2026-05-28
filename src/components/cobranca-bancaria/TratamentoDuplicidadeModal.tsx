import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { DuplicidadeDetectada } from "@/utils/detecaoDuplicidade";
import { formatCurrency } from "@/lib/utils";

interface TratamentoDuplicidadeModalProps {
  duplicidade: DuplicidadeDetectada;
  isOpen: boolean;
  onClose: () => void;
}

type AcaoDuplicidade = "recompra" | "cancelar" | "manter";

export function TratamentoDuplicidadeModal({
  duplicidade,
  isOpen,
  onClose,
}: TratamentoDuplicidadeModalProps) {
  const [acao, setAcao] = useState<AcaoDuplicidade>("manter");
  const [observacoes, setObservacoes] = useState("");
  const queryClient = useQueryClient();

  const tratamentoMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      switch (acao) {
        case "recompra": {
          // Criar operação de recompra
          const { data: operacao, error: operacaoError } = await supabase
            .from("operacoes")
            .insert({
              empresa_id: profile.empresa_id,
              tipo: "recompra",
              valor: duplicidade.titulo2.valor_nominal,
              data_operacao: new Date().toISOString().split("T")[0],
              descricao: `Recompra por duplicidade: ${duplicidade.titulo2.identificador_interno || duplicidade.titulo2.nosso_numero}`,
              status: "pendente",
            })
            .select()
            .single();

          if (operacaoError) throw operacaoError;

          // Vincular título duplicado à operação
          await supabase
            .from("titulos_cobranca")
            .update({ operacao_id: operacao.id })
            .eq("id", duplicidade.titulo2.id);

          // Baixar título duplicado
          await supabase
            .from("titulos_cobranca")
            .update({ status_atual: "BAIXADO" })
            .eq("id", duplicidade.titulo2.id);

          // Criar crédito para cliente (se houver cliente_codigo)
          if (duplicidade.titulo2.cliente_codigo) {
            // TODO: Implementar criação de crédito no sistema financeiro
            console.log(
              `Crédito de ${formatCurrency(duplicidade.titulo2.valor_nominal)} para cliente ${duplicidade.titulo2.cliente_codigo}`
            );
          }

          break;
        }
        case "cancelar": {
          // Baixar título duplicado
          await supabase
            .from("titulos_cobranca")
            .update({ status_atual: "BAIXADO" })
            .eq("id", duplicidade.titulo2.id);

          break;
        }
        case "manter": {
          // Apenas registrar observação
          break;
        }
      }

      // Marcar ocorrência como resolvida
      const { data: ocorrencia } = await supabase
        .from("fila_ocorrencias")
        .select("id")
        .eq("titulo_id", duplicidade.titulo1.id)
        .eq("acao", "duplicidade")
        .eq("resolvido", false)
        .maybeSingle();

      if (ocorrencia) {
        await supabase
          .from("fila_ocorrencias")
          .update({
            resolvido: true,
            resolvido_por: user.id,
            resolvido_em: new Date().toISOString(),
            observacoes: observacoes || `Ação: ${acao}`,
          })
          .eq("id", ocorrencia.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulos"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-fila-ocorrencias"] });
      toast.success("Duplicidade tratada com sucesso");
      onClose();
    },
    onError: (error) => {
      toast.error(`Erro ao tratar duplicidade: ${error.message}`);
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tratamento de Duplicidade</DialogTitle>
          <DialogDescription>
            Selecione a ação para tratar esta duplicidade
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Informações dos Títulos */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <Label className="font-semibold">Título 1</Label>
                  <p className="text-sm">
                    <span className="font-medium">ID:</span>{" "}
                    {duplicidade.titulo1.identificador_interno ||
                      duplicidade.titulo1.nosso_numero ||
                      duplicidade.titulo1.id}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Sacado:</span> {duplicidade.titulo1.sacado_nome}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Valor:</span>{" "}
                    {formatCurrency(duplicidade.titulo1.valor_nominal)}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Vencimento:</span>{" "}
                    {new Date(duplicidade.titulo1.vencimento).toLocaleDateString("pt-BR")}
                  </p>
                  <Badge variant="outline">{duplicidade.titulo1.status_atual}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <Label className="font-semibold">Título 2 (Duplicado)</Label>
                  <p className="text-sm">
                    <span className="font-medium">ID:</span>{" "}
                    {duplicidade.titulo2.identificador_interno ||
                      duplicidade.titulo2.nosso_numero ||
                      duplicidade.titulo2.id}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Sacado:</span> {duplicidade.titulo2.sacado_nome}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Valor:</span>{" "}
                    {formatCurrency(duplicidade.titulo2.valor_nominal)}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Vencimento:</span>{" "}
                    {new Date(duplicidade.titulo2.vencimento).toLocaleDateString("pt-BR")}
                  </p>
                  <Badge variant="outline">{duplicidade.titulo2.status_atual}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tipo de Duplicidade */}
          <div>
            <Label>Tipo de Duplicidade</Label>
            <Badge className="mt-2">
              {duplicidade.tipo === "identificador_interno"
                ? "Identificador Interno"
                : duplicidade.tipo === "nosso_numero"
                  ? "Nosso Número"
                  : "Chave Composta"}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">
              Confiança: {duplicidade.confianca}%
            </p>
          </div>

          {/* Ação */}
          <div className="space-y-2">
            <Label>Ação</Label>
            <Select value={acao} onValueChange={(value) => setAcao(value as AcaoDuplicidade)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recompra">
                  Recompra/Crédito (criar operação de recompra e crédito para cliente)
                </SelectItem>
                <SelectItem value="cancelar">
                  Cancelar Título Duplicado (baixar título duplicado)
                </SelectItem>
                <SelectItem value="manter">Manter Ambos (apenas registrar observação)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Observações */}
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Adicione observações sobre o tratamento desta duplicidade..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => tratamentoMutation.mutate()}
            disabled={tratamentoMutation.isPending}
          >
            {tratamentoMutation.isPending ? "Processando..." : "Confirmar Tratamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

