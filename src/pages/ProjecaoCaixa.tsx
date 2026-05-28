import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Calendar, 
  DollarSign,
  AlertCircle,
  CheckCircle
} from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID } from "@/lib/uuid";

interface ProjecaoItem {
  data: string;
  tipo: "entrada" | "saida";
  descricao: string;
  valor: number;
  origem: "realizado" | "previsto";
  status?: string;
  saldoDia: number;
}

export default function ProjecaoCaixa() {
  const [periodo, setPeriodo] = useState<"7" | "30" | "365">("7");
  const [dataInicio, setDataInicio] = useState(new Date().toISOString().split('T')[0]);
  const [contaBancariaId, setContaBancariaId] = useState<string>("todos");
  const [contasBancarias, setContasBancarias] = useState<any[]>([]);
  const [projecao, setProjecao] = useState<ProjecaoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  useEffect(() => {
    fetchEmpresaId();
  }, []);

  useEffect(() => {
    if (empresaId) {
      loadContasBancarias();
    }
  }, [empresaId]);

  useEffect(() => {
    if (dataInicio && empresaId) {
      gerarProjecao();
    }
  }, [periodo, dataInicio, contaBancariaId, empresaId]);

  const fetchEmpresaId = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", session.user.id)
        .maybeSingle();
      
      if (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error("Erro ao buscar empresa_id:", error);
        }
        return;
      }
      
      if (profile?.empresa_id) {
        const empresaIdValue = ensureUUID(profile.empresa_id);
        if (empresaIdValue) {
          setEmpresaId(empresaIdValue);
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao buscar empresa_id:", error);
      }
    }
  };

  const loadContasBancarias = async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contas_bancarias')
        .select('id, descricao, saldo_atual, saldo_inicial, bancos(nome)')
        .eq('empresa_id', empresaId)
        .order('descricao');
      
      if (error) throw error;
      setContasBancarias(data || []);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao carregar contas:', error);
      }
      toast.error('Erro ao carregar contas bancárias');
    }
  };

  const gerarProjecao = async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      toast.error("Empresa não encontrada. Aguarde o carregamento.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const dataFim = new Date(dataInicio);
      dataFim.setDate(dataFim.getDate() + parseInt(periodo));
      const dataFimStr = dataFim.toISOString().split('T')[0];

      // Buscar lançamentos realizados
      let queryRealizados = supabase
        .from('lancamentos_caixa')
        .select('data, tipo, historico, valor, grupos_contas(nome)')
        .eq('empresa_id', empresaId)
        .gte('data', dataInicio)
        .lte('data', dataFimStr)
        .order('data');

      if (contaBancariaId !== 'todos') {
        queryRealizados = queryRealizados.eq('conta_bancaria_id', contaBancariaId);
      }

      const { data: realizados, error: errorRealizados } = await queryRealizados;
      if (errorRealizados) throw errorRealizados;

      // Buscar lançamentos previstos
      let queryPrevistos = supabase
        .from('lancamentos_previstos')
        .select('vencimento, tipo, historico, valor, status, contas_fixas(descricao)')
        .eq('empresa_id', empresaId)
        .gte('vencimento', dataInicio)
        .lte('vencimento', dataFimStr)
        .in('status', ['previsto', 'agendado'])
        .order('vencimento');

      if (contaBancariaId !== 'todos') {
        queryPrevistos = queryPrevistos.eq('conta_bancaria_id', contaBancariaId);
      }

      const { data: previstos, error: errorPrevistos } = await queryPrevistos;
      if (errorPrevistos) throw errorPrevistos;

      // Calcular saldo inicial usando mesma lógica de ContasEstoques
      let saldoInicialCalc = 0;
      if (contaBancariaId === 'todos') {
        const { data: contas } = await supabase
          .from('contas_bancarias')
          .select('saldo_atual, saldo_inicial')
          .eq('empresa_id', empresaId);
        saldoInicialCalc = contas?.reduce((acc, c) => {
          // Usar mesma lógica: saldo_atual se definido (inclusive zero), senão saldo_inicial
          const saldo = c.saldo_atual !== null && c.saldo_atual !== undefined
            ? c.saldo_atual
            : (c.saldo_inicial ?? 0);
          return acc + saldo;
        }, 0) || 0;
      } else {
        const conta = contasBancarias.find(c => c.id === contaBancariaId);
        if (conta) {
          // Usar mesma lógica: saldo_atual se definido (inclusive zero), senão saldo_inicial
          saldoInicialCalc = conta.saldo_atual !== null && conta.saldo_atual !== undefined
            ? conta.saldo_atual
            : (conta.saldo_inicial ?? 0);
        }
      }
      setSaldoInicial(saldoInicialCalc);

      // Combinar e ordenar
      const items: ProjecaoItem[] = [
        ...(realizados || []).map(r => ({
          data: r.data,
          tipo: r.tipo as "entrada" | "saida",
          descricao: r.historico || r.grupos_contas?.nome || 'Sem descrição',
          valor: r.valor,
          origem: 'realizado' as const,
          saldoDia: 0,
        })),
        ...(previstos || []).map(p => ({
          data: p.vencimento,
          tipo: p.tipo as "entrada" | "saida",
          descricao: p.historico || p.contas_fixas?.descricao || 'Sem descrição',
          valor: p.valor,
          origem: 'previsto' as const,
          status: p.status,
          saldoDia: 0,
        })),
      ];

      // Ordenar por data
      items.sort((a, b) => a.data.localeCompare(b.data));

      // Calcular saldo acumulado
      let saldoAcumulado = saldoInicialCalc;
      items.forEach(item => {
        if (item.tipo === 'entrada') {
          saldoAcumulado += item.valor;
        } else {
          saldoAcumulado -= item.valor;
        }
        item.saldoDia = saldoAcumulado;
      });

      setProjecao(items);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao gerar projeção:', error);
      }
      const message = "Erro ao gerar projeção. Verifique os filtros e tente novamente.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      weekday: 'short',
    });
  };

  // Estatísticas
  const stats = {
    totalEntradas: projecao
      .filter(p => p.tipo === 'entrada')
      .reduce((acc, p) => acc + p.valor, 0),
    totalSaidas: projecao
      .filter(p => p.tipo === 'saida')
      .reduce((acc, p) => acc + p.valor, 0),
    saldoFinal: projecao.length > 0 ? projecao[projecao.length - 1].saldoDia : saldoInicial,
    diasNegativos: projecao.filter(p => p.saldoDia < 0).length,
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Projeção de Caixa</h1>
            <p className="text-muted-foreground">Previsão de fluxo de caixa para os próximos dias</p>
          </div>
        </div>

        {/* Filtros */}
        <Card>
          <CardHeader>
            <CardTitle>Parâmetros da Projeção</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="periodo">Período</Label>
                <Select value={periodo} onValueChange={(value: "7" | "30" | "365") => setPeriodo(value)} disabled={loading}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Próximos 7 dias (D+7)</SelectItem>
                    <SelectItem value="30">Próximos 30 dias (D+30)</SelectItem>
                    <SelectItem value="365">Próximos 365 dias (Anual)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="dataInicio">Data Inicial</Label>
                <Input
                  id="dataInicio"
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <Label htmlFor="conta">Conta Bancária</Label>
                <Select value={contaBancariaId} onValueChange={setContaBancariaId} disabled={loading}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                    <SelectContent>
                    <SelectItem value="todos">Todas as Contas</SelectItem>
                    {contasBancarias.map((conta) => {
                      // Usar mesma lógica de ContasEstoques: saldo_atual se definido (inclusive zero), senão saldo_inicial
                      const saldoExibicao = conta.saldo_atual !== null && conta.saldo_atual !== undefined
                        ? conta.saldo_atual
                        : (conta.saldo_inicial ?? 0);
                      return (
                        <SelectItem key={conta.id} value={conta.id.toString()}>
                          {conta.descricao} - {formatCurrency(saldoExibicao)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {errorMessage ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-destructive">{errorMessage}</p>
                <Button variant="outline" onClick={gerarProjecao} disabled={loading}>
                  Tentar novamente
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Cards de Resumo */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo Inicial</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold whitespace-nowrap">{formatCurrency(saldoInicial)}</div>
              <p className="text-xs text-muted-foreground">Saldo atual consolidado</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Entradas Previstas</CardTitle>
              <TrendingUp className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-success whitespace-nowrap">{formatCurrency(stats.totalEntradas)}</div>
              <p className="text-xs text-muted-foreground">Período selecionado</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saídas Previstas</CardTitle>
              <TrendingDown className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-xl font-bold text-destructive whitespace-nowrap">{formatCurrency(stats.totalSaidas)}</div>
              <p className="text-xs text-muted-foreground">Período selecionado</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo Projetado</CardTitle>
              {stats.saldoFinal >= 0 ? (
                <CheckCircle className="h-4 w-4 text-success" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-lg sm:text-xl font-bold whitespace-nowrap ${stats.saldoFinal >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(stats.saldoFinal)}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.diasNegativos > 0 ? `${stats.diasNegativos} dia(s) negativo(s)` : 'Sempre positivo'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabela de Projeção */}
        <Card>
          <CardHeader>
            <CardTitle>Movimentações Projetadas ({projecao.length})</CardTitle>
          </CardHeader>
          <CardContent className="relative">
            {loading && projecao.length > 0 ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-[1px]">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : null}
            {loading && projecao.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Carregando projeção...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Saldo Projetado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projecao.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Nenhuma movimentação projetada para o período
                      </TableCell>
                    </TableRow>
                  ) : (
                    projecao.map((item, index) => (
                      <TableRow key={index} className={item.saldoDia < 0 ? 'bg-destructive/5' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatDate(item.data)}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{item.descricao}</TableCell>
                        <TableCell>
                          <Badge variant={item.tipo === 'entrada' ? 'default' : 'destructive'}>
                            {item.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.origem === 'realizado' ? 'default' : 'outline'}>
                            {item.origem === 'realizado' ? 'Realizado' : 'Previsto'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono min-w-[120px] whitespace-nowrap">
                          {formatCurrency(item.valor)}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-bold min-w-[120px] whitespace-nowrap ${
                          item.saldoDia >= 0 ? 'text-success' : 'text-destructive'
                        }`}>
                          {formatCurrency(item.saldoDia)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Alertas */}
        {stats.diasNegativos > 0 && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                Atenção: Saldo Negativo Projetado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Há <strong>{stats.diasNegativos} dia(s)</strong> com saldo negativo no período projetado.
                Considere adiar pagamentos ou antecipar recebimentos para evitar problemas de fluxo de caixa.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
  );
}



