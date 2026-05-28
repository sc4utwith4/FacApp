import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, FileSpreadsheet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

interface RelatorioDevolucoesProps {
  filtros: {
    dataInicio: string;
    dataFim: string;
    carteiraId: string;
  };
}

export function RelatorioDevolucoes({ filtros }: RelatorioDevolucoesProps) {
  const { data: devolucoes, isLoading } = useQuery({
    queryKey: ["cobranca-relatorio-devolucoes", filtros],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { data: eventos, error } = await supabase
        .from("eventos_cobranca")
        .select("*, titulos_cobranca(identificador_interno, sacado_nome, valor_nominal)")
        .eq("tipo_evento", "DEVOLUCAO")
        .gte("data_evento", `${filtros.dataInicio}T00:00:00`)
        .lte("data_evento", `${filtros.dataFim}T23:59:59`);

      if (error) throw error;

      // Agrupar por motivo (descricao_banco)
      const porMotivo = new Map<string, any[]>();
      eventos?.forEach((evento) => {
        const motivo = evento.descricao_banco || "Sem motivo informado";
        if (!porMotivo.has(motivo)) {
          porMotivo.set(motivo, []);
        }
        porMotivo.get(motivo)!.push(evento);
      });

      const resumo = Array.from(porMotivo.entries()).map(([motivo, eventosMotivo]) => ({
        motivo,
        qtd: eventosMotivo.length,
        valorTotal: eventosMotivo.reduce(
          (acc, e) => acc + ((e.titulos_cobranca as any)?.valor_nominal || 0),
          0
        ),
        eventos: eventosMotivo,
      }));

      return resumo;
    },
  });

  const handleExportPDF = () => {
    toast.info("Exportação PDF será implementada em breve");
  };

  const handleExportExcel = () => {
    toast.info("Exportação Excel será implementada em breve");
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleExportPDF}>
          <FileText className="mr-2 h-4 w-4" />
          Exportar PDF
        </Button>
        <Button variant="outline" onClick={handleExportExcel}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Exportar Excel
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Relatório de Devoluções/Rejeições</CardTitle>
        </CardHeader>
        <CardContent>
          {devolucoes && devolucoes.length > 0 ? (
            <div className="space-y-6">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Quantidade</TableHead>
                      <TableHead>Valor Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devolucoes.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.motivo}</TableCell>
                        <TableCell>{item.qtd} títulos</TableCell>
                        <TableCell>{formatCurrency(item.valorTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Detalhamento */}
              <div className="space-y-4">
                <h3 className="font-semibold">Detalhamento</h3>
                {devolucoes.map((item, index) => (
                  <div key={index} className="space-y-2">
                    <h4 className="text-sm font-medium">{item.motivo}</h4>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Título</TableHead>
                            <TableHead>Sacado</TableHead>
                            <TableHead>Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {item.eventos.map((evento: any) => (
                            <TableRow key={evento.id}>
                              <TableCell>
                                {new Date(evento.data_evento).toLocaleDateString("pt-BR")}
                              </TableCell>
                              <TableCell>
                                {evento.titulos_cobranca?.identificador_interno || "-"}
                              </TableCell>
                              <TableCell>{evento.titulos_cobranca?.sacado_nome || "-"}</TableCell>
                              <TableCell>
                                {formatCurrency((evento.titulos_cobranca as any)?.valor_nominal || 0)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma devolução encontrada para o período selecionado
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

