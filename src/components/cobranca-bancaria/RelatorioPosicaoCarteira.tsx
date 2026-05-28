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

interface RelatorioPosicaoCarteiraProps {
  filtros: {
    dataInicio: string;
    dataFim: string;
    carteiraId: string;
  };
}

export function RelatorioPosicaoCarteira({ filtros }: RelatorioPosicaoCarteiraProps) {
  const { data: posicao, isLoading } = useQuery({
    queryKey: ["cobranca-relatorio-posicao", filtros],
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
        .from("titulos_cobranca")
        .select("*, carteiras_cobranca(beneficiario_razao_social)")
        .eq("empresa_id", profile.empresa_id);

      if (filtros.carteiraId !== "todas") {
        query = query.eq("carteira_id", filtros.carteiraId);
      }

      const { data: titulos, error } = await query;

      if (error) throw error;

      // Agrupar por carteira
      const porCarteira = new Map<string, any[]>();
      titulos?.forEach((titulo) => {
        const carteiraId = titulo.carteira_id || "sem_carteira";
        if (!porCarteira.has(carteiraId)) {
          porCarteira.set(carteiraId, []);
        }
        porCarteira.get(carteiraId)!.push(titulo);
      });

      // Calcular totais
      const resumo = Array.from(porCarteira.entries()).map(([carteiraId, titulosCarteira]) => {
        const abertos = titulosCarteira.filter((t) =>
          ["ABERTO", "PROTESTO_INSTRUIDO", "EM_CARTORIO"].includes(t.status_atual)
        );
        const liquidados = titulosCarteira.filter((t) => t.status_atual === "LIQUIDADO");
        const emCartorio = titulosCarteira.filter((t) => t.status_atual === "EM_CARTORIO");
        const comProtesto = titulosCarteira.filter(
          (t) => t.status_atual === "PROTESTO_INSTRUIDO"
        );

        return {
          carteiraId,
          carteiraNome:
            titulosCarteira[0]?.carteiras_cobranca?.beneficiario_razao_social || "Sem Carteira",
          totalTitulos: titulosCarteira.length,
          abertos: {
            qtd: abertos.length,
            valor: abertos.reduce((acc, t) => acc + t.valor_nominal, 0),
          },
          liquidados: {
            qtd: liquidados.length,
            valor: liquidados.reduce((acc, t) => acc + t.valor_nominal, 0),
          },
          emCartorio: {
            qtd: emCartorio.length,
            valor: emCartorio.reduce((acc, t) => acc + t.valor_nominal, 0),
          },
          comProtesto: {
            qtd: comProtesto.length,
            valor: comProtesto.reduce((acc, t) => acc + t.valor_nominal, 0),
          },
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
          <CardTitle>Posição de Carteira</CardTitle>
        </CardHeader>
        <CardContent>
          {posicao && posicao.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Carteira</TableHead>
                    <TableHead>Títulos Abertos</TableHead>
                    <TableHead>Títulos Liquidados</TableHead>
                    <TableHead>Em Cartório</TableHead>
                    <TableHead>Com Protesto</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posicao.map((item) => (
                    <TableRow key={item.carteiraId}>
                      <TableCell className="font-medium">{item.carteiraNome}</TableCell>
                      <TableCell>
                        <div className="text-sm">{item.abertos.qtd} títulos</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(item.abertos.valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-green-600">{item.liquidados.qtd} títulos</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(item.liquidados.valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-orange-600">{item.emCartorio.qtd} títulos</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(item.emCartorio.valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-red-600">{item.comProtesto.qtd} títulos</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(item.comProtesto.valor)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-semibold">{item.totalTitulos} títulos</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(
                            item.abertos.valor +
                              item.liquidados.valor +
                              item.emCartorio.valor +
                              item.comProtesto.valor
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum dado encontrado para o período selecionado
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

