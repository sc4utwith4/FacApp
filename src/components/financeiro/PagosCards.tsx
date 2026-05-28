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
import { Pagamento, PagamentoPorGrupo } from '@/types/pagos';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { parseDateFromDB } from '@/lib/utils';

interface PagosCardsProps {
  pagamentos: Pagamento[];
  todosGruposSaida?: Array<{ id: string; nome: string }>;
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

export function PagosCards({ pagamentos, todosGruposSaida = [] }: PagosCardsProps) {
  const pagamentosPorGrupo = useMemo<PagamentoPorGrupo[]>(() => {
    // Agrupar por grupo_contas_id
    const gruposMap = new Map<string, PagamentoPorGrupo>();

    pagamentos.forEach((pagamento) => {
      const grupoId = pagamento.grupo_contas_id || 'sem-grupo';
      const grupoNome = pagamento.grupos_contas?.nome || 'Sem Grupo';

      if (!gruposMap.has(grupoId)) {
        gruposMap.set(grupoId, {
          grupo_id: grupoId,
          grupo_nome: grupoNome,
          pagamentos: [],
          total: 0,
          quantidade: 0,
        });
      }

      const grupo = gruposMap.get(grupoId)!;
      grupo.pagamentos.push(pagamento);
      grupo.total += pagamento.valor;
      grupo.quantidade += 1;
    });

    // Ordenar grupos alfabeticamente por nome
    const gruposArray = Array.from(gruposMap.values());
    gruposArray.sort((a, b) => a.grupo_nome.localeCompare(b.grupo_nome));

    // Ordenar pagamentos dentro de cada grupo por data DESC (já vem ordenado da query)
    gruposArray.forEach((grupo) => {
      grupo.pagamentos.sort((a, b) => {
        const dateA = new Date(a.data).getTime();
        const dateB = new Date(b.data).getTime();
        return dateB - dateA; // DESC
      });
    });

    return gruposArray;
  }, [pagamentos]);

  // Adicionar grupos vazios (grupos de saída que não têm pagamentos)
  const todosGrupos = useMemo(() => {
    const gruposComPagamentos = new Set(pagamentosPorGrupo.map((g) => g.grupo_id));
    
    // Criar grupos vazios para grupos de saída que não têm pagamentos
    const gruposVazios: PagamentoPorGrupo[] = todosGruposSaida
      .filter((grupo) => !gruposComPagamentos.has(grupo.id))
      .map((grupo) => ({
        grupo_id: grupo.id,
        grupo_nome: grupo.nome,
        pagamentos: [],
        total: 0,
        quantidade: 0,
      }));

    // Combinar e ordenar alfabeticamente
    return [...pagamentosPorGrupo, ...gruposVazios].sort((a, b) =>
      a.grupo_nome.localeCompare(b.grupo_nome)
    );
  }, [pagamentosPorGrupo, todosGruposSaida]);

  if (todosGrupos.length === 0) {
    return (
      <Card variant="glass">
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground">
            Nenhum pagamento encontrado para o período selecionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {todosGrupos.map((grupo) => (
        <Card key={grupo.grupo_id} variant="glass">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {grupo.grupo_nome} ({grupo.quantidade})
              </CardTitle>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total do grupo</p>
                <p className="text-xl font-semibold">{formatCurrency(grupo.total)}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {grupo.pagamentos.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                Nenhum pagamento neste grupo para o período selecionado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-foreground/5">
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Data
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Histórico
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Valor
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Conta Bancária
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Documento
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Observações
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grupo.pagamentos.map((pagamento) => {
                      const contaBancaria = pagamento.contas_bancarias
                        ? `${pagamento.contas_bancarias.descricao}${pagamento.contas_bancarias.bancos ? ` - ${pagamento.contas_bancarias.bancos.nome}` : ''}`
                        : '-';

                      return (
                        <TableRow
                          key={pagamento.id}
                          className="border-b border-border/40 hover:bg-foreground/5"
                        >
                          <TableCell className="text-sm">{formatDate(pagamento.data)}</TableCell>
                          <TableCell className="text-sm font-medium">
                            {pagamento.historico || '-'}
                          </TableCell>
                          <TableCell className="text-sm font-semibold">
                            {formatCurrency(pagamento.valor)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {contaBancaria}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {pagamento.documento || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {pagamento.observacoes || '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

