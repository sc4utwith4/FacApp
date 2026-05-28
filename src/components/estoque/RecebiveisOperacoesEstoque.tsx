import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useRecebiveisEstoque } from "@/hooks/useRecebiveisEstoque";
import { formatCurrency } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function RecebiveisOperacoesEstoque() {
  const { data: recebiveis, isLoading, error } = useRecebiveisEstoque();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recebíveis de Operações de Estoque</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recebíveis de Operações de Estoque</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Erro ao carregar recebíveis: {error instanceof Error ? error.message : "Erro desconhecido"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!recebiveis || recebiveis.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recebíveis de Operações de Estoque</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum recebível encontrado
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recebíveis de Operações de Estoque</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operação</TableHead>
                <TableHead>Tipo Estoque</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Descrição</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recebiveis.map((recebivel) => {
                const operacao = recebivel.operacoes_estoque;
                const fornecedorNome = operacao?.fornecedores?.razao_social || 
                                       operacao?.fornecedores?.nome_fantasia || 
                                       "Sem fornecedor";
                
                return (
                  <TableRow key={recebivel.id}>
                    <TableCell className="font-medium">
                      #{operacao?.id || recebivel.operacao_estoque_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {recebivel.tipo_estoque}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {fornecedorNome}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {formatCurrency(recebivel.valor)}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                      {recebivel.descricao || "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              Total de recebíveis: {recebiveis.length}
            </span>
            <span className="text-sm font-semibold">
              Valor total: {formatCurrency(
                recebiveis.reduce((sum, r) => sum + r.valor, 0)
              )}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

