import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RecebimentoEstoque, RecebivelPorFornecedor } from '@/types/recebidos';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { parseDateFromDB } from '@/lib/utils';

interface RecebiveisEstoqueCardProps {
  recebimentos: RecebimentoEstoque[];
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const formatDate = (dateString: string) => {
  const date = parseDateFromDB(dateString);
  if (!date) return '-';
  return format(date, 'dd/MM/yyyy', { locale: ptBR });
};

const getFornecedorNome = (recebimento: RecebimentoEstoque): string => {
  const fornecedor = recebimento.operacoes_estoque?.fornecedores;
  if (!fornecedor) return 'Sem fornecedor';
  return fornecedor.razao_social || fornecedor.nome_fantasia || 'Sem fornecedor';
};

const getFornecedorId = (recebimento: RecebimentoEstoque): string | null => {
  // Usar o ID da operação como identificador do fornecedor para agrupamento
  return recebimento.operacoes_estoque?.id?.toString() || null;
};

export function RecebiveisEstoqueCard({ recebimentos }: RecebiveisEstoqueCardProps) {
  const recebiveisPorFornecedor = useMemo<RecebivelPorFornecedor[]>(() => {
    // Agrupar por fornecedor (via operacao_estoque_id)
    const fornecedoresMap = new Map<string, RecebivelPorFornecedor>();

    recebimentos.forEach((recebimento) => {
      const fornecedorId = getFornecedorId(recebimento) || 'sem-fornecedor';
      const fornecedorNome = getFornecedorNome(recebimento);

      if (!fornecedoresMap.has(fornecedorId)) {
        fornecedoresMap.set(fornecedorId, {
          fornecedor_id: fornecedorId,
          fornecedor_nome: fornecedorNome,
          recebimentos: [],
          total: 0,
          quantidade: 0,
        });
      }

      const fornecedor = fornecedoresMap.get(fornecedorId)!;
      fornecedor.recebimentos.push(recebimento);
      fornecedor.total += recebimento.valor;
      fornecedor.quantidade += 1;
    });

    // Ordenar fornecedores alfabeticamente por nome
    const fornecedoresArray = Array.from(fornecedoresMap.values());
    fornecedoresArray.sort((a, b) => a.fornecedor_nome.localeCompare(b.fornecedor_nome));

    // Ordenar recebimentos dentro de cada fornecedor por data DESC
    fornecedoresArray.forEach((fornecedor) => {
      fornecedor.recebimentos.sort((a, b) => {
        const dateA = new Date(a.data_vencimento).getTime();
        const dateB = new Date(b.data_vencimento).getTime();
        return dateB - dateA; // DESC
      });
    });

    return fornecedoresArray;
  }, [recebimentos]);

  if (recebiveisPorFornecedor.length === 0) {
    return null; // Não mostrar card se não houver recebíveis
  }

  return (
    <div className="space-y-6">
      <Card variant="glass" className="border-2 border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              Recebíveis de Estoque
              <Badge variant="outline" className="text-xs">
                {recebimentos.length} recebível{recebimentos.length !== 1 ? 's' : ''}
              </Badge>
            </CardTitle>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total geral</p>
              <p className="text-xl font-semibold">
                {formatCurrency(recebimentos.reduce((sum, r) => sum + r.valor, 0))}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {recebiveisPorFornecedor.map((fornecedor) => (
              <div key={fornecedor.fornecedor_id} className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <h3 className="font-semibold text-base">
                    {fornecedor.fornecedor_nome} ({fornecedor.quantidade})
                  </h3>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total do fornecedor</p>
                    <p className="text-lg font-semibold">{formatCurrency(fornecedor.total)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-foreground/5">
                        <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                          Data
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                          Descrição
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                          Valor
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                          Tipo Estoque
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                          Operação
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fornecedor.recebimentos.map((recebimento) => (
                        <TableRow
                          key={recebimento.id}
                          className="border-b border-border/40 hover:bg-foreground/5"
                        >
                          <TableCell className="text-sm">
                            {formatDate(recebimento.data_vencimento)}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            <div className="flex items-center gap-2">
                              {recebimento.descricao || recebimento.operacoes_estoque?.historico || '-'}
                              <Badge variant="outline" className="text-xs border-primary/40 bg-primary/10 text-primary">
                                Recebível de Estoque
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm font-semibold">
                            {formatCurrency(recebimento.valor)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <Badge variant="outline">
                              {recebimento.tipo_estoque}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            #{recebimento.operacao_estoque_id}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

