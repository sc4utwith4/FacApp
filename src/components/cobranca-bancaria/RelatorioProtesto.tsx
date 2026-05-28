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
import { FileText, FileSpreadsheet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

interface RelatorioProtestoProps {
  filtros: {
    dataInicio: string;
    dataFim: string;
    carteiraId: string;
  };
}

export function RelatorioProtesto({ filtros }: RelatorioProtestoProps) {
  const { data: titulos, isLoading } = useQuery({
    queryKey: ["cobranca-relatorio-protesto", filtros],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { data: titulosData, error } = await supabase
        .from("titulos_cobranca")
        .select("*, eventos_cobranca(*), carteiras_cobranca(beneficiario_razao_social)")
        .eq("empresa_id", profile.empresa_id)
        .in("status_atual", ["PROTESTO_INSTRUIDO", "EM_CARTORIO"]);

      if (error) throw error;

      // Separar por status
      const emAberto = titulosData?.filter((t) => t.status_atual === "PROTESTO_INSTRUIDO") || [];
      const emCartorio = titulosData?.filter((t) => t.status_atual === "EM_CARTORIO") || [];

      // Buscar eventos de protesto e cartório
      const eventosProtesto = titulosData
        ?.flatMap((t) => (t.eventos_cobranca as any[]) || [])
        .filter((e) => e.tipo_evento === "PROTESTO" || e.tipo_evento === "CARTORIO") || [];

      return {
        emAberto,
        emCartorio,
        eventosProtesto,
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
          <CardTitle>Relatório de Protesto/Cartório</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Títulos em Aberto (Protesto Instruído) */}
            <div>
              <h3 className="font-semibold mb-4">
                Títulos em Aberto (Protesto Instruído) - {titulos?.emAberto.length || 0} títulos
              </h3>
              {titulos && titulos.emAberto.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Título</TableHead>
                        <TableHead>Sacado</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {titulos.emAberto.map((titulo) => (
                        <TableRow key={titulo.id}>
                          <TableCell className="font-medium">
                            {titulo.identificador_interno || titulo.nosso_numero || "-"}
                          </TableCell>
                          <TableCell>{titulo.sacado_nome || "-"}</TableCell>
                          <TableCell>
                            {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell>{formatCurrency(titulo.valor_nominal)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{titulo.status_atual}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum título em aberto</p>
              )}
            </div>

            {/* Títulos em Cartório */}
            <div>
              <h3 className="font-semibold mb-4">
                Títulos em Cartório - {titulos?.emCartorio.length || 0} títulos
              </h3>
              {titulos && titulos.emCartorio.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Título</TableHead>
                        <TableHead>Sacado</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {titulos.emCartorio.map((titulo) => (
                        <TableRow key={titulo.id}>
                          <TableCell className="font-medium">
                            {titulo.identificador_interno || titulo.nosso_numero || "-"}
                          </TableCell>
                          <TableCell>{titulo.sacado_nome || "-"}</TableCell>
                          <TableCell>
                            {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell>{formatCurrency(titulo.valor_nominal)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{titulo.status_atual}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum título em cartório</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

