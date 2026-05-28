import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { EventoCobranca, TituloCobranca } from "@/types/cobranca-bancaria";
import { formatCurrency } from "@/lib/utils";
import { reconcileEvents } from "@/utils/conciliacao";

interface ConciliacaoModalProps {
  evento: EventoCobranca;
  isOpen: boolean;
  onClose: () => void;
}

export function ConciliacaoModal({ evento, isOpen, onClose }: ConciliacaoModalProps) {
  const [selectedTituloId, setSelectedTituloId] = useState<string | null>(null);
  const [confiancaManual, setConfiancaManual] = useState<number>(evento.confianca_conciliacao || 0);
  const queryClient = useQueryClient();

  // Buscar títulos candidatos para conciliação
  const { data: titulosCandidatos } = useQuery<TituloCobranca[]>({
    queryKey: ["cobranca-titulos-candidatos", evento],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Buscar títulos que podem ser candidatos
      // Por nosso número, seu número, ou dados do sacado
      const queries = [];

      if (evento.codigo_banco) {
        queries.push(
          supabase
            .from("titulos_cobranca")
            .select("*")
            .eq("empresa_id", profile.empresa_id)
            .eq("nosso_numero", evento.codigo_banco)
            .limit(10)
        );
      }

      if (evento.descricao_banco) {
        // Tentar extrair nosso número da descrição
        const nossoNumeroMatch = evento.descricao_banco.match(/\d{10,}/);
        if (nossoNumeroMatch) {
          queries.push(
            supabase
              .from("titulos_cobranca")
              .select("*")
              .eq("empresa_id", profile.empresa_id)
              .eq("nosso_numero", nossoNumeroMatch[0])
              .limit(10)
          );
        }
      }

      // Buscar todos os títulos abertos para seleção manual
      queries.push(
        supabase
          .from("titulos_cobranca")
          .select("*")
          .eq("empresa_id", profile.empresa_id)
          .in("status_atual", ["ABERTO", "PROTESTO_INSTRUIDO", "EM_CARTORIO"])
          .limit(50)
      );

      const results = await Promise.all(queries);
      const allTitulos = results.flatMap((r) => r.data || []);

      // Remover duplicatas
      const uniqueTitulos = Array.from(
        new Map(allTitulos.map((t) => [t.id, t])).values()
      );

      return uniqueTitulos;
    },
    enabled: isOpen && !!evento,
  });

  // Mutation para conciliar evento
  const conciliarMutation = useMutation({
    mutationFn: async ({ tituloId, confianca }: { tituloId: string; confianca: number }) => {
      const { error } = await supabase
        .from("eventos_cobranca")
        .update({
          titulo_id: tituloId,
          conciliado: true,
          confianca_conciliacao: confianca,
        })
        .eq("id", evento.id);

      if (error) throw error;

      // Atualizar status do título se for liquidação
      if (evento.tipo_evento === "LIQUIDACAO") {
        await supabase
          .from("titulos_cobranca")
          .update({ status_atual: "LIQUIDADO" })
          .eq("id", tituloId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-eventos"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulos"] });
      toast.success("Evento conciliado com sucesso");
      onClose();
    },
    onError: (error) => {
      toast.error(`Erro ao conciliar: ${error.message}`);
    },
  });

  const handleConciliar = () => {
    if (!selectedTituloId) {
      toast.error("Selecione um título para conciliar");
      return;
    }

    conciliarMutation.mutate({
      tituloId: selectedTituloId,
      confianca: confiancaManual,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conciliação Manual</DialogTitle>
          <DialogDescription>
            Vincule este evento a um título existente
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Informações do Evento */}
          <div className="space-y-2">
            <Label>Evento</Label>
            <div className="rounded-md border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge>{evento.tipo_evento}</Badge>
                <span className="text-sm text-muted-foreground">
                  {new Date(evento.data_evento).toLocaleString("pt-BR")}
                </span>
              </div>
              {evento.descricao_banco && (
                <p className="text-sm">{evento.descricao_banco}</p>
              )}
              <div className="text-sm font-semibold">
                Valor Líquido: {formatCurrency(evento.valor_liquido)}
              </div>
            </div>
          </div>

          {/* Títulos Candidatos */}
          <div className="space-y-2">
            <Label>Títulos Candidatos</Label>
            <div className="rounded-md border max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>ID Interno</TableHead>
                    <TableHead>Nosso Número</TableHead>
                    <TableHead>Sacado</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {titulosCandidatos && titulosCandidatos.length > 0 ? (
                    titulosCandidatos.map((titulo) => (
                      <TableRow
                        key={titulo.id}
                        className={selectedTituloId === titulo.id ? "bg-accent" : ""}
                        onClick={() => setSelectedTituloId(titulo.id)}
                      >
                        <TableCell>
                          <input
                            type="radio"
                            checked={selectedTituloId === titulo.id}
                            onChange={() => setSelectedTituloId(titulo.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {titulo.identificador_interno || "-"}
                        </TableCell>
                        <TableCell>{titulo.nosso_numero || "-"}</TableCell>
                        <TableCell>{titulo.sacado_nome || "-"}</TableCell>
                        <TableCell>
                          {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell>{formatCurrency(titulo.valor_nominal)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{titulo.status_atual}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Nenhum título candidato encontrado
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Confiança Manual */}
          <div className="space-y-2">
            <Label>Confiança de Conciliação (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={confiancaManual}
              onChange={(e) => setConfiancaManual(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Ajuste a confiança manualmente se necessário
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleConciliar}
            disabled={!selectedTituloId || conciliarMutation.isPending}
          >
            {conciliarMutation.isPending ? "Conciliando..." : "Conciliação Manual"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

