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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, FileSpreadsheet, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

interface RelatorioDivergenciasProps {
  filtros: {
    dataInicio: string;
    dataFim: string;
    carteiraId: string;
  };
}

export function RelatorioDivergencias({ filtros }: RelatorioDivergenciasProps) {
  const { data: divergencias, isLoading } = useQuery({
    queryKey: ["cobranca-relatorio-divergencias", filtros],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Buscar eventos de liquidação
      const { data: eventos, error } = await supabase
        .from("eventos_cobranca")
        .select("*, titulos_cobranca(valor_nominal, identificador_interno, sacado_nome)")
        .eq("tipo_evento", "LIQUIDACAO")
        .gte("data_evento", `${filtros.dataInicio}T00:00:00`)
        .lte("data_evento", `${filtros.dataFim}T23:59:59`);

      if (error) throw error;

      // Identificar divergências
      const pagamentosMenores: any[] = [];
      const pagamentosMaiores: any[] = [];
      const duplicidades: any[] = [];

      eventos?.forEach((evento) => {
        const titulo = evento.titulos_cobranca as any;
        const valorEsperado = titulo?.valor_nominal || 0;
        const valorRecebido = evento.valor_liquido || 0;
        const diferenca = valorRecebido - valorEsperado;

        if (diferenca < -0.01) {
          // Pagamento menor
          pagamentosMenores.push({
            evento,
            titulo,
            valorEsperado,
            valorRecebido,
            diferenca: Math.abs(diferenca),
          });
        } else if (diferenca > 0.01) {
          // Pagamento maior
          pagamentosMaiores.push({
            evento,
            titulo,
            valorEsperado,
            valorRecebido,
            diferenca,
          });
        }
      });

      // Buscar duplicidades na fila de ocorrências
      const { data: ocorrenciasDuplicidade } = await supabase
        .from("fila_ocorrencias")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .eq("acao", "duplicidade")
        .eq("resolvido", false);

      if (ocorrenciasDuplicidade) {
        duplicidades.push(...ocorrenciasDuplicidade);
      }

      return {
        pagamentosMenores,
        pagamentosMaiores,
        duplicidades,
      };
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

  const totalDivergencias =
    (divergencias?.pagamentosMenores.length || 0) +
    (divergencias?.pagamentosMaiores.length || 0) +
    (divergencias?.duplicidades.length || 0);

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

      {totalDivergencias > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {totalDivergencias} divergência(s) encontrada(s) no período selecionado
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Relatório de Divergências</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Pagamentos Menores */}
            {divergencias && divergencias.pagamentosMenores.length > 0 && (
              <div>
                <h3 className="font-semibold mb-4 text-red-600">
                  Pagamentos Menores que o Esperado ({divergencias.pagamentosMenores.length})
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Título</TableHead>
                        <TableHead>Sacado</TableHead>
                        <TableHead>Valor Esperado</TableHead>
                        <TableHead>Valor Recebido</TableHead>
                        <TableHead>Diferença</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {divergencias.pagamentosMenores.map((item: any) => (
                        <TableRow key={item.evento.id}>
                          <TableCell>
                            {new Date(item.evento.data_evento).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            {item.titulo?.identificador_interno || "-"}
                          </TableCell>
                          <TableCell>{item.titulo?.sacado_nome || "-"}</TableCell>
                          <TableCell>{formatCurrency(item.valorEsperado)}</TableCell>
                          <TableCell>{formatCurrency(item.valorRecebido)}</TableCell>
                          <TableCell className="text-red-600 font-semibold">
                            -{formatCurrency(item.diferenca)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Pagamentos Maiores */}
            {divergencias && divergencias.pagamentosMaiores.length > 0 && (
              <div>
                <h3 className="font-semibold mb-4 text-green-600">
                  Pagamentos Maiores que o Esperado ({divergencias.pagamentosMaiores.length})
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Título</TableHead>
                        <TableHead>Sacado</TableHead>
                        <TableHead>Valor Esperado</TableHead>
                        <TableHead>Valor Recebido</TableHead>
                        <TableHead>Diferença</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {divergencias.pagamentosMaiores.map((item: any) => (
                        <TableRow key={item.evento.id}>
                          <TableCell>
                            {new Date(item.evento.data_evento).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            {item.titulo?.identificador_interno || "-"}
                          </TableCell>
                          <TableCell>{item.titulo?.sacado_nome || "-"}</TableCell>
                          <TableCell>{formatCurrency(item.valorEsperado)}</TableCell>
                          <TableCell>{formatCurrency(item.valorRecebido)}</TableCell>
                          <TableCell className="text-green-600 font-semibold">
                            +{formatCurrency(item.diferenca)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Duplicidades */}
            {divergencias && divergencias.duplicidades.length > 0 && (
              <div>
                <h3 className="font-semibold mb-4 text-orange-600">
                  Duplicidades Detectadas ({divergencias.duplicidades.length})
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Identificador</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {divergencias.duplicidades.map((ocorrencia: any) => (
                        <TableRow key={ocorrencia.id}>
                          <TableCell>
                            {new Date(ocorrencia.data_ocorrencia).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell>{ocorrencia.identificador || "-"}</TableCell>
                          <TableCell>{ocorrencia.status_motivo || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={ocorrencia.resolvido ? "secondary" : "destructive"}>
                              {ocorrencia.resolvido ? "Resolvido" : "Pendente"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {totalDivergencias === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma divergência encontrada para o período selecionado
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

