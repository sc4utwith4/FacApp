import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import type { EventoCobranca, TipoEvento } from "@/types/cobranca-bancaria";
import { Clock, CheckCircle2, XCircle, AlertCircle, FileText } from "lucide-react";

interface EventoTimelineProps {
  tituloId: string;
}

const getEventoIcon = (tipo: TipoEvento) => {
  switch (tipo) {
    case "LIQUIDACAO":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "BAIXA":
    case "DEVOLUCAO":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "PROTESTO":
    case "CARTORIO":
      return <AlertCircle className="h-4 w-4 text-orange-600" />;
    default:
      return <FileText className="h-4 w-4 text-blue-600" />;
  }
};

const getEventoColor = (tipo: TipoEvento) => {
  switch (tipo) {
    case "LIQUIDACAO":
      return "bg-green-100 text-green-800 border-green-300";
    case "BAIXA":
    case "DEVOLUCAO":
      return "bg-red-100 text-red-800 border-red-300";
    case "PROTESTO":
    case "CARTORIO":
      return "bg-orange-100 text-orange-800 border-orange-300";
    default:
      return "bg-blue-100 text-blue-800 border-blue-300";
  }
};

export function EventoTimeline({ tituloId }: EventoTimelineProps) {
  const { data: eventos, isLoading } = useQuery<EventoCobranca[]>({
    queryKey: ["cobranca-eventos", tituloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eventos_cobranca")
        .select("*")
        .eq("titulo_id", tituloId)
        .order("data_evento", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!eventos || eventos.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            Nenhum evento registrado para este título
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Eventos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Linha vertical da timeline */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-6">
            {eventos.map((evento, index) => (
              <div key={evento.id} className="relative flex gap-4">
                {/* Ícone do evento */}
                <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background border-2 border-border">
                  {getEventoIcon(evento.tipo_evento)}
                </div>

                {/* Conteúdo do evento */}
                <div className="flex-1 space-y-2 pb-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={getEventoColor(evento.tipo_evento)}
                        >
                          {evento.tipo_evento}
                        </Badge>
                        {evento.conciliado && (
                          <Badge variant="secondary" className="text-xs">
                            Conciliado
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium">
                        {new Date(evento.data_evento).toLocaleString("pt-BR")}
                      </p>
                      {evento.descricao_banco && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {evento.descricao_banco}
                        </p>
                      )}
                      {evento.observacoes && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {evento.observacoes}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Valores do evento */}
                  {(evento.valor_principal > 0 ||
                    evento.juros > 0 ||
                    evento.multa > 0 ||
                    evento.desconto > 0 ||
                    evento.tarifa > 0 ||
                    evento.valor_liquido > 0) && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {evento.valor_principal > 0 && (
                        <div>
                          <span className="text-muted-foreground">Principal: </span>
                          <span className="font-medium">
                            {formatCurrency(evento.valor_principal)}
                          </span>
                        </div>
                      )}
                      {evento.juros > 0 && (
                        <div>
                          <span className="text-muted-foreground">Juros: </span>
                          <span className="font-medium text-green-600">
                            {formatCurrency(evento.juros)}
                          </span>
                        </div>
                      )}
                      {evento.multa > 0 && (
                        <div>
                          <span className="text-muted-foreground">Multa: </span>
                          <span className="font-medium text-red-600">
                            {formatCurrency(evento.multa)}
                          </span>
                        </div>
                      )}
                      {evento.desconto > 0 && (
                        <div>
                          <span className="text-muted-foreground">Desconto: </span>
                          <span className="font-medium text-blue-600">
                            {formatCurrency(evento.desconto)}
                          </span>
                        </div>
                      )}
                      {evento.tarifa > 0 && (
                        <div>
                          <span className="text-muted-foreground">Tarifa: </span>
                          <span className="font-medium text-orange-600">
                            {formatCurrency(evento.tarifa)}
                          </span>
                        </div>
                      )}
                      {evento.valor_liquido > 0 && (
                        <div className="col-span-2 md:col-span-4 pt-2 border-t">
                          <span className="text-muted-foreground">Valor Líquido: </span>
                          <span className="font-bold text-lg">
                            {formatCurrency(evento.valor_liquido)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Informações de origem */}
                  {evento.origem && Object.keys(evento.origem).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      <span className="font-medium">Origem: </span>
                      {evento.origem.arquivo && (
                        <span>Arquivo: {evento.origem.arquivo}</span>
                      )}
                      {evento.origem.usuario && (
                        <span> • Usuário: {evento.origem.usuario}</span>
                      )}
                    </div>
                  )}

                  {/* Confiança de conciliação */}
                  {!evento.conciliado && evento.confianca_conciliacao > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Confiança: {evento.confianca_conciliacao}%
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

