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
import { Recebimento, RecebimentoPorGrupo, RecebimentoCaixa } from '@/types/recebidos';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { parseDateFromDB } from '@/lib/utils';

interface RecebidosCardsProps {
  recebimentos: Recebimento[];
  todosGruposEntrada?: Array<{ id: string; nome: string }>;
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

const getDataRecebimento = (recebimento: Recebimento): string => {
  if (recebimento.origem === 'caixa') {
    return recebimento.data;
  } else {
    return recebimento.data_vencimento;
  }
};

const getClienteNome = (recebimento: Recebimento): string => {
  // Campo cliente não disponível na tabela lancamentos_caixa
  return '-';
};

export function RecebidosCards({ recebimentos, todosGruposEntrada = [] }: RecebidosCardsProps) {
  // Separar recebimentos de caixa (que têm grupos) dos de estoque
  const recebimentosCaixa = useMemo(() => {
    return recebimentos.filter((r) => r.origem === 'caixa') as RecebimentoCaixa[];
  }, [recebimentos]);

  const recebimentosPorGrupo = useMemo<RecebimentoPorGrupo[]>(() => {
    // Agrupar por grupo_contas_id
    const gruposMap = new Map<string, RecebimentoPorGrupo>();

    recebimentosCaixa.forEach((recebimento) => {
      const grupoId = recebimento.grupo_contas_id || 'sem-grupo';
      const grupoNome = recebimento.grupos_contas?.nome || 'Sem Grupo';

      if (!gruposMap.has(grupoId)) {
        gruposMap.set(grupoId, {
          grupo_id: grupoId,
          grupo_nome: grupoNome,
          recebimentos: [],
          total: 0,
          quantidade: 0,
        });
      }

      const grupo = gruposMap.get(grupoId)!;
      grupo.recebimentos.push(recebimento);
      grupo.total += recebimento.valor;
      grupo.quantidade += 1;
    });

    // Ordenar grupos alfabeticamente por nome
    const gruposArray = Array.from(gruposMap.values());
    gruposArray.sort((a, b) => a.grupo_nome.localeCompare(b.grupo_nome));

    // Ordenar recebimentos dentro de cada grupo por data DESC
    gruposArray.forEach((grupo) => {
      grupo.recebimentos.sort((a, b) => {
        const dateA = new Date(a.data).getTime();
        const dateB = new Date(b.data).getTime();
        return dateB - dateA; // DESC
      });
    });

    return gruposArray;
  }, [recebimentosCaixa]);

  // Adicionar grupos vazios (grupos de entrada que não têm recebimentos)
  const todosGrupos = useMemo(() => {
    const gruposComRecebimentos = new Set(recebimentosPorGrupo.map((g) => g.grupo_id));

    // Criar grupos vazios para grupos de entrada que não têm recebimentos
    const gruposVazios: RecebimentoPorGrupo[] = todosGruposEntrada
      .filter((grupo) => !gruposComRecebimentos.has(grupo.id))
      .map((grupo) => ({
        grupo_id: grupo.id,
        grupo_nome: grupo.nome,
        recebimentos: [],
        total: 0,
        quantidade: 0,
      }));

    // Combinar e ordenar alfabeticamente
    return [...recebimentosPorGrupo, ...gruposVazios].sort((a, b) =>
      a.grupo_nome.localeCompare(b.grupo_nome)
    );
  }, [recebimentosPorGrupo, todosGruposEntrada]);

  if (todosGrupos.length === 0) {
    return (
      <Card variant="glass">
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground">
            Nenhum recebimento encontrado para o período selecionado.
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
            {grupo.recebimentos.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                Nenhum recebimento neste grupo para o período selecionado.
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
                        Cliente
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Tipo
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                        Observações
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grupo.recebimentos.map((recebimento) => {
                      const contaBancaria = recebimento.contas_bancarias
                        ? `${recebimento.contas_bancarias.descricao}${recebimento.contas_bancarias.bancos ? ` - ${recebimento.contas_bancarias.bancos.nome}` : ''}`
                        : '-';

                      const clienteNome = getClienteNome(recebimento);

                      return (
                        <TableRow
                          key={recebimento.id}
                          className="border-b border-border/40 hover:bg-foreground/5"
                        >
                          <TableCell className="text-sm">{formatDate(recebimento.data)}</TableCell>
                          <TableCell className="text-sm font-medium">
                            {recebimento.historico || '-'}
                          </TableCell>
                          <TableCell className="text-sm font-semibold">
                            {formatCurrency(recebimento.valor)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {contaBancaria}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {recebimento.documento || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {clienteNome}
                          </TableCell>
                          <TableCell className="text-sm">
                            <Badge variant="outline" className="border-blue-400/40 bg-blue-500/10 text-blue-500">
                              Caixa
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {recebimento.observacoes || '-'}
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

