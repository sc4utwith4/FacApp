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

interface RelatorioLiquidacoesProps {
  filtros: {
    dataInicio: string;
    dataFim: string;
    carteiraId: string;
  };
}

export function RelatorioLiquidacoes({ filtros }: RelatorioLiquidacoesProps) {
  const { data: liquidacoes, isLoading } = useQuery({
    queryKey: ["cobranca-relatorio-liquidacoes", filtros],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      let query = supabase
        .from("eventos_cobranca")
        .select("*, titulos_cobranca(identificador_interno, sacado_nome, carteira_id, carteiras_cobranca(beneficiario_razao_social))")
        .eq("tipo_evento", "LIQUIDACAO")
        .gte("data_evento", `${filtros.dataInicio}T00:00:00`)
        .lte("data_evento", `${filtros.dataFim}T23:59:59`);

      const { data: eventos, error } = await query;

      if (error) throw error;

      // Agrupar por carteira
      const porCarteira = new Map<string, any[]>();
      eventos?.forEach((evento) => {
        const titulo = evento.titulos_cobranca as any;
        const carteiraId = titulo?.carteira_id || "sem_carteira";
        if (!porCarteira.has(carteiraId)) {
          porCarteira.set(carteiraId, []);
        }
        porCarteira.get(carteiraId)!.push(evento);
      });

      const resumo = Array.from(porCarteira.entries()).map(([carteiraId, eventosCarteira]) => {
        const totalPrincipal = eventosCarteira.reduce((acc, e) => acc + (e.valor_principal || 0), 0);
        const totalJuros = eventosCarteira.reduce((acc, e) => acc + (e.juros || 0), 0);
        const totalMulta = eventosCarteira.reduce((acc, e) => acc + (e.multa || 0), 0);
        const totalDesconto = eventosCarteira.reduce((acc, e) => acc + (e.desconto || 0), 0);
        const totalTarifa = eventosCarteira.reduce((acc, e) => acc + (e.tarifa || 0), 0);
        const totalLiquido = eventosCarteira.reduce((acc, e) => acc + (e.valor_liquido || 0), 0);

        return {
          carteiraId,
          carteiraNome: eventosCarteira[0]?.titulos_cobranca?.carteiras_cobranca?.beneficiario_razao_social || "Sem Carteira",
          qtd: eventosCarteira.length,
          totalPrincipal,
          totalJuros,
          totalMulta,
          totalDesconto,
          totalTarifa,
          totalLiquido,
          eventos: eventosCarteira,
        };
      });

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
          <CardTitle>Relatório de Liquidações</CardTitle>
        </CardHeader>
        <CardContent>
          {liquidacoes && liquidacoes.length > 0 ? (
            <div className="space-y-6">
              {liquidacoes.map((item) => (
                <div key={item.carteiraId} className="space-y-2">
                  <h3 className="font-semibold">{item.carteiraNome}</h3>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Título</TableHead>
                          <TableHead>Sacado</TableHead>
                          <TableHead>Principal</TableHead>
                          <TableHead>Juros</TableHead>
                          <TableHead>Multa</TableHead>
                          <TableHead>Desconto</TableHead>
                          <TableHead>Tarifa</TableHead>
                          <TableHead>Líquido</TableHead>
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
                            <TableCell>{formatCurrency(evento.valor_principal || 0)}</TableCell>
                            <TableCell className="text-green-600">
                              {formatCurrency(evento.juros || 0)}
                            </TableCell>
                            <TableCell className="text-green-600">
                              {formatCurrency(evento.multa || 0)}
                            </TableCell>
                            <TableCell className="text-blue-600">
                              {formatCurrency(evento.desconto || 0)}
                            </TableCell>
                            <TableCell className="text-orange-600">
                              {formatCurrency(evento.tarifa || 0)}
                            </TableCell>
                            <TableCell className="font-semibold">
                              {formatCurrency(evento.valor_liquido || 0)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-semibold bg-muted">
                          <TableCell colSpan={3}>Total</TableCell>
                          <TableCell>{formatCurrency(item.totalPrincipal)}</TableCell>
                          <TableCell className="text-green-600">
                            {formatCurrency(item.totalJuros)}
                          </TableCell>
                          <TableCell className="text-green-600">
                            {formatCurrency(item.totalMulta)}
                          </TableCell>
                          <TableCell className="text-blue-600">
                            {formatCurrency(item.totalDesconto)}
                          </TableCell>
                          <TableCell className="text-orange-600">
                            {formatCurrency(item.totalTarifa)}
                          </TableCell>
                          <TableCell>{formatCurrency(item.totalLiquido)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma liquidação encontrada para o período selecionado
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

