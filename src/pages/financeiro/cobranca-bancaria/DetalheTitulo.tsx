import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Edit,
  Trash2,
  Download,
  FileText,
  AlertCircle,
  Plus,
  CheckCircle2,
  XCircle,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { TituloCobranca, EventoCobranca, TipoEvento } from "@/types/cobranca-bancaria";
import { formatCurrency } from "@/lib/utils";
import { EventoTimeline } from "@/components/cobranca-bancaria/EventoTimeline";
import { ConciliacaoModal } from "@/components/cobranca-bancaria/ConciliacaoModal";
import { TituloForm } from "@/components/cobranca-bancaria/TituloForm";
import { CalculoLiquidacaoModal } from "@/components/cobranca-bancaria/CalculoLiquidacaoModal";
import { aplicarCalculoLiquidacaoAutomatico } from "@/utils/aplicarCalculoLiquidacao";

export default function DetalheTitulo() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isEventoDialogOpen, setIsEventoDialogOpen] = useState(false);
  const [isAcaoDialogOpen, setIsAcaoDialogOpen] = useState(false);
  const [eventoParaConciliar, setEventoParaConciliar] = useState<EventoCobranca | null>(null);
  const [acaoSelecionada, setAcaoSelecionada] = useState<string>("");
  const [isCalculoDialogOpen, setIsCalculoDialogOpen] = useState(false);

  // Query para buscar título
  const { data: titulo, isLoading } = useQuery<TituloCobranca>({
    queryKey: ["cobranca-titulo", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("titulos_cobranca")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Query para buscar eventos não conciliados
  const { data: eventosNaoConciliados } = useQuery<EventoCobranca[]>({
    queryKey: ["cobranca-eventos-nao-conciliados", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eventos_cobranca")
        .select("*")
        .eq("titulo_id", id)
        .eq("conciliado", false)
        .order("data_evento", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  // Mutation para deletar título
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("titulos_cobranca").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulos"] });
      toast.success("Título excluído com sucesso");
      navigate("/financeiro/cobranca-bancaria");
    },
    onError: (error) => {
      toast.error(`Erro ao excluir: ${error.message}`);
    },
  });

  // Mutation para criar evento manual
  const criarEventoMutation = useMutation({
    mutationFn: async (eventoData: {
      tipo_evento: TipoEvento;
      data_evento: string;
      valor_liquido: number;
      observacoes?: string;
    }) => {
      if (!titulo) throw new Error("Título não encontrado");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data, error } = await supabase
        .from("eventos_cobranca")
        .insert({
          titulo_id: titulo.id,
          carteira_id: titulo.carteira_id,
          tipo_evento: eventoData.tipo_evento,
          data_evento: eventoData.data_evento,
          valor_principal: titulo.valor_nominal,
          valor_liquido: eventoData.valor_liquido,
          origem: { usuario: user.id, tipo: "manual" },
          conciliado: true,
          confianca_conciliacao: 100,
          observacoes: eventoData.observacoes,
        })
        .select()
        .single();

      if (error) throw error;

      // Aplicar cálculo automático se for liquidação
      if (eventoData.tipo_evento === "LIQUIDACAO") {
        try {
          await aplicarCalculoLiquidacaoAutomatico(data, titulo);
          // Buscar evento atualizado
          const { data: eventoAtualizado } = await supabase
            .from("eventos_cobranca")
            .select("*")
            .eq("id", data.id)
            .single();
          if (eventoAtualizado) {
            // Retornar evento atualizado em vez de reatribuir
            return eventoAtualizado;
          }
        } catch (calcError) {
          console.warn("Erro ao calcular liquidação automática:", calcError);
        }
        
        await supabase
          .from("titulos_cobranca")
          .update({ status_atual: "LIQUIDADO" })
          .eq("id", titulo.id);
      } else if (eventoData.tipo_evento === "BAIXA") {
        await supabase
          .from("titulos_cobranca")
          .update({ status_atual: "BAIXADO" })
          .eq("id", titulo.id);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-eventos", id] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulo", id] });
      toast.success("Evento criado com sucesso");
      setIsEventoDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Erro ao criar evento: ${error.message}`);
    },
  });

  // Mutation para ações no título
  const acaoMutation = useMutation({
    mutationFn: async (acao: string) => {
      if (!titulo) throw new Error("Título não encontrado");

      switch (acao) {
        case "baixar":
          await supabase
            .from("titulos_cobranca")
            .update({ status_atual: "BAIXADO" })
            .eq("id", titulo.id);
          break;
        case "cartorio":
          await supabase
            .from("titulos_cobranca")
            .update({ status_atual: "EM_CARTORIO" })
            .eq("id", titulo.id);
          break;
        case "protesto":
          await supabase
            .from("titulos_cobranca")
            .update({ status_atual: "PROTESTO_INSTRUIDO" })
            .eq("id", titulo.id);
          break;
        default:
          throw new Error("Ação inválida");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulo", id] });
      toast.success("Ação executada com sucesso");
      setIsAcaoDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Erro ao executar ação: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/financeiro/cobranca-bancaria")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Carregando...</h1>
        </div>
      </div>
    );
  }

  if (!titulo) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/financeiro/cobranca-bancaria")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Título não encontrado</h1>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      ABERTO: "bg-blue-100 text-blue-800",
      LIQUIDADO: "bg-green-100 text-green-800",
      BAIXADO: "bg-gray-100 text-gray-800",
      DEVOLVIDO: "bg-red-100 text-red-800",
      PROTESTO_INSTRUIDO: "bg-orange-100 text-orange-800",
      EM_CARTORIO: "bg-purple-100 text-purple-800",
    };
    return variants[status] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/financeiro/cobranca-bancaria")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Detalhe do Título</h1>
            <p className="text-muted-foreground">
              {titulo.identificador_interno || titulo.nosso_numero || titulo.id}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsEditDialogOpen(true)}>
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button variant="outline" onClick={() => setIsAcaoDialogOpen(true)}>
            Ações
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm("Tem certeza que deseja excluir este título?")) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir
          </Button>
        </div>
      </div>

      {/* Informações do Título */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Informações do Título</CardTitle>
            <Badge className={getStatusBadge(titulo.status_atual)}>{titulo.status_atual}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label>ID Interno</Label>
                <p className="text-sm font-medium">{titulo.identificador_interno || "-"}</p>
              </div>
              <div>
                <Label>Nosso Número</Label>
                <p className="text-sm font-medium">{titulo.nosso_numero || "-"}</p>
              </div>
              <div>
                <Label>Seu Número</Label>
                <p className="text-sm font-medium">{titulo.seu_numero || "-"}</p>
              </div>
              <div>
                <Label>Valor Nominal</Label>
                <p className="text-sm font-medium">{formatCurrency(titulo.valor_nominal)}</p>
              </div>
              <div>
                <Label>Vencimento</Label>
                <p className="text-sm font-medium">
                  {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <Label>Sacado</Label>
                <p className="text-sm font-medium">{titulo.sacado_nome || "-"}</p>
              </div>
              <div>
                <Label>Documento</Label>
                <p className="text-sm font-medium">{titulo.sacado_documento || "-"}</p>
              </div>
              <div>
                <Label>Cliente Código</Label>
                <p className="text-sm font-medium">{titulo.cliente_codigo || "-"}</p>
              </div>
              <div>
                <Label>Data de Emissão</Label>
                <p className="text-sm font-medium">
                  {titulo.data_emissao
                    ? new Date(titulo.data_emissao).toLocaleDateString("pt-BR")
                    : "-"}
                </p>
              </div>
              <div>
                <Label>Registrado no Banco</Label>
                <p className="text-sm font-medium">
                  {titulo.registrado_banco ? (
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Sim
                    </Badge>
                  ) : (
                    <Badge variant="outline">Não</Badge>
                  )}
                </p>
              </div>
            </div>
          </div>
          {titulo.tags && titulo.tags.length > 0 && (
            <div className="mt-4">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {titulo.tags.map((tag, index) => (
                  <Badge key={index} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline de Eventos */}
      <EventoTimeline tituloId={titulo.id} />

      {/* Conciliação */}
      {eventosNaoConciliados && eventosNaoConciliados.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Eventos Não Conciliados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {eventosNaoConciliados.map((evento) => (
                <div
                  key={evento.id}
                  className="flex items-center justify-between p-4 border rounded-md"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge>{evento.tipo_evento}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(evento.data_evento).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {evento.descricao_banco && (
                      <p className="text-sm mt-1">{evento.descricao_banco}</p>
                    )}
                    <p className="text-sm font-semibold mt-1">
                      Valor: {formatCurrency(evento.valor_liquido)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEventoParaConciliar(evento)}
                  >
                    Conciliação Manual
                  </Button>
                </div>
              ))}
            </div>
            <Button
              className="mt-4"
              onClick={() => {
                // TODO: Implementar conciliação automática em lote
                toast.info("Conciliação automática em lote será implementada em breve");
              }}
            >
              Conciliação Automática
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Dialog de Edição */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Título</DialogTitle>
            <DialogDescription>Atualize as informações do título</DialogDescription>
          </DialogHeader>
          <TituloForm
            titulo={titulo}
            onClose={() => setIsEditDialogOpen(false)}
            onSuccess={() => {
              setIsEditDialogOpen(false);
              queryClient.invalidateQueries({ queryKey: ["cobranca-titulo", id] });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog de Criar Evento */}
      <Dialog open={isEventoDialogOpen} onOpenChange={setIsEventoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Evento Manual</DialogTitle>
            <DialogDescription>
              Adicione um evento manual para este título
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              criarEventoMutation.mutate({
                tipo_evento: formData.get("tipo_evento") as TipoEvento,
                data_evento: formData.get("data_evento") as string,
                valor_liquido: Number(formData.get("valor_liquido")),
                observacoes: formData.get("observacoes") as string,
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Tipo de Evento</Label>
              <Select name="tipo_evento" required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LIQUIDACAO">Liquidação</SelectItem>
                  <SelectItem value="BAIXA">Baixa</SelectItem>
                  <SelectItem value="DEVOLUCAO">Devolução</SelectItem>
                  <SelectItem value="PROTESTO">Protesto</SelectItem>
                  <SelectItem value="CARTORIO">Cartório</SelectItem>
                  <SelectItem value="AJUSTE_MANUAL">Ajuste Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data do Evento</Label>
              <Input type="datetime-local" name="data_evento" required />
            </div>
            <div className="space-y-2">
              <Label>Valor Líquido</Label>
              <Input type="number" step="0.01" name="valor_liquido" required />
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea name="observacoes" rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEventoDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={criarEventoMutation.isPending}>
                {criarEventoMutation.isPending ? "Criando..." : "Criar Evento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Ações */}
      <Dialog open={isAcaoDialogOpen} onOpenChange={setIsAcaoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ações no Título</DialogTitle>
            <DialogDescription>Selecione uma ação para executar</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setAcaoSelecionada("baixar");
                acaoMutation.mutate("baixar");
              }}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Baixar Título
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setAcaoSelecionada("cartorio");
                acaoMutation.mutate("cartorio");
              }}
            >
              <FileText className="mr-2 h-4 w-4" />
              Enviar ao Cartório
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setAcaoSelecionada("protesto");
                acaoMutation.mutate("protesto");
              }}
            >
              <AlertCircle className="mr-2 h-4 w-4" />
              Instruir Protesto
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setIsAcaoDialogOpen(false);
                setIsEventoDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Criar Evento Manual
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setIsAcaoDialogOpen(false);
                setIsCalculoDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Calcular Liquidação
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAcaoDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Conciliação */}
      {eventoParaConciliar && (
        <ConciliacaoModal
          evento={eventoParaConciliar}
          isOpen={!!eventoParaConciliar}
          onClose={() => setEventoParaConciliar(null)}
        />
      )}

      {/* Modal de Cálculo de Liquidação */}
      {isCalculoDialogOpen && (
        <CalculoLiquidacaoModal
          titulo={titulo}
          evento={null}
          isOpen={isCalculoDialogOpen}
          onClose={() => setIsCalculoDialogOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["cobranca-eventos", id] });
            queryClient.invalidateQueries({ queryKey: ["cobranca-titulo", id] });
          }}
        />
      )}
    </div>
  );
}

