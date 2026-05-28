import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Filter, Search, Calendar } from 'lucide-react';
import { useRecebidos } from '@/hooks/useRecebidos';
import { RecebidosResumo } from '@/components/financeiro/RecebidosResumo';
import { RecebidosCards } from '@/components/financeiro/RecebidosCards';
import { RecebiveisEstoqueCard } from '@/components/financeiro/RecebiveisEstoqueCard';
import { FiltrosRecebidos, Recebimento, RecebimentoEstoque } from '@/types/recebidos';
import { supabase } from '@/integrations/supabase/client';
import { ensureUUID, isValidUUID } from '@/lib/uuid';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

export default function Recebidos() {
  // Estado padrão: mês atual (primeiro dia do mês até hoje)
  const periodoPadrao = useMemo(() => {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return {
      inicio: format(primeiroDiaMes, 'yyyy-MM-dd'),
      fim: format(hoje, 'yyyy-MM-dd'),
    };
  }, []);

  const [filtros, setFiltros] = useState<FiltrosRecebidos>({
    data_inicio: periodoPadrao.inicio,
    data_fim: periodoPadrao.fim,
  });

  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [gruposContas, setGruposContas] = useState<Array<{ id: string; nome: string; natureza: string }>>([]);
  const [contasBancarias, setContasBancarias] = useState<Array<{ id: string; descricao: string; bancos?: { nome: string } | null }>>([]);
  const [todosGruposEntrada, setTodosGruposEntrada] = useState<Array<{ id: string; nome: string }>>([]);

  const { data: recebimentos = [], isLoading, error } = useRecebidos(filtros, false);
  
  // Buscar todos os recebimentos para cálculos de resumo (sem filtro de período)
  const { data: todosRecebimentos = [] } = useRecebidos({ ...filtros, data_inicio: undefined, data_fim: undefined }, true);

  // Separar recebimentos de caixa e estoque
  const recebimentosCaixa = useMemo(() => {
    return recebimentos.filter((r) => r.origem === 'caixa');
  }, [recebimentos]);

  const recebimentosEstoque = useMemo(() => {
    return recebimentos.filter((r) => r.origem === 'estoque') as RecebimentoEstoque[];
  }, [recebimentos]);

  // Buscar empresa_id
  useEffect(() => {
    const fetchEmpresaId = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('empresa_id')
          .eq('id', session.user.id)
          .maybeSingle();

        if (profileError) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Erro ao buscar empresa_id:', profileError);
          }
          return;
        }

        if (profile) {
          const empresaIdFromProfile = (profile as { empresa_id?: string | null })?.empresa_id;
          if (empresaIdFromProfile) {
            const empresaIdValue = ensureUUID(empresaIdFromProfile);
            if (empresaIdValue && isValidUUID(empresaIdValue)) {
              setEmpresaId(empresaIdValue);
            }
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erro ao buscar empresa_id:', error);
        }
      }
    };

    fetchEmpresaId();
  }, []);

  // Carregar grupos de contas e contas bancárias
  useEffect(() => {
    if (!empresaId || !isValidUUID(empresaId)) return;

    const loadData = async () => {
      try {
        // Carregar grupos de contas (entrada, escrito_imob, aplic)
        const { data: grupos, error: gruposError } = await supabase
          .from('grupos_contas')
          .select('id, nome, natureza')
          .eq('empresa_id', empresaId)
          .in('natureza', ['entrada', 'escrito_imob', 'aplic'])
          .order('nome');

        if (gruposError) throw gruposError;
        const gruposData = grupos || [];
        setGruposContas(gruposData);
        // Armazenar todos os grupos de entrada para mostrar cards vazios
        setTodosGruposEntrada(gruposData.map((g) => ({ id: g.id, nome: g.nome })));

        // Carregar contas bancárias
        const { data: contas, error: contasError } = await supabase
          .from('contas_bancarias')
          .select('id, descricao, bancos(nome)')
          .eq('empresa_id', empresaId)
          .order('descricao');

        if (contasError) throw contasError;
        setContasBancarias(contas || []);

        // Removido: carregamento de clientes - campo cliente_id não existe em lancamentos_caixa
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erro ao carregar dados:', error);
        }
      }
    };

    loadData();
  }, [empresaId]);

  const handleFiltroChange = (key: keyof FiltrosRecebidos, value: string | undefined) => {
    setFiltros((prev) => ({
      ...prev,
      [key]: value === 'todos' ? undefined : (value || undefined),
    }));
  };

  const handleResetFiltros = () => {
    setFiltros({
      data_inicio: periodoPadrao.inicio,
      data_fim: periodoPadrao.fim,
    });
  };

  // Validar que data_fim >= data_inicio
  const dataInicioValida = filtros.data_inicio || periodoPadrao.inicio;
  const dataFimValida = filtros.data_fim || periodoPadrao.fim;
  const filtrosValidos = new Date(dataFimValida) >= new Date(dataInicioValida);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border/40 bg-card p-6 shadow-subtle lg:p-8">
        <div className="relative flex flex-col gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Receitas
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Visualize todos os recebimentos registrados, organizados por grupos de contas e recebíveis de estoque.
            </p>
          </div>
        </div>
      </section>

      {/* Cards de Resumo */}
      {!isLoading && filtrosValidos && (
        <RecebidosResumo
          recebimentos={todosRecebimentos}
          dataInicio={dataInicioValida}
          dataFim={dataFimValida}
        />
      )}

      {/* Barra de Filtros */}
      <Card variant="glass" className="border border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-semibold text-foreground">Filtros</Label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="data-inicio">Data Início</Label>
              <Input
                id="data-inicio"
                type="date"
                value={filtros.data_inicio || ''}
                onChange={(e) => handleFiltroChange('data_inicio', e.target.value)}
                className="border border-border/60 bg-background/80 backdrop-blur"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="data-fim">Data Fim</Label>
              <Input
                id="data-fim"
                type="date"
                value={filtros.data_fim || ''}
                onChange={(e) => handleFiltroChange('data_fim', e.target.value)}
                className="border border-border/60 bg-background/80 backdrop-blur"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="conta-bancaria">Conta Bancária</Label>
              <Select
                value={filtros.conta_bancaria_id || 'todos'}
                onValueChange={(value) =>
                  handleFiltroChange('conta_bancaria_id', value)
                }
              >
                <SelectTrigger id="conta-bancaria" className="border border-border/60 bg-background/80 backdrop-blur">
                  <SelectValue placeholder="Todas as contas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas as contas</SelectItem>
                  {contasBancarias.map((conta) => (
                    <SelectItem key={conta.id} value={conta.id}>
                      {conta.descricao} {conta.bancos?.nome ? `- ${conta.bancos.nome}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="grupo-contas">Grupo de Contas</Label>
              <Select
                value={filtros.grupo_contas_id || 'todos'}
                onValueChange={(value) =>
                  handleFiltroChange('grupo_contas_id', value)
                }
              >
                <SelectTrigger id="grupo-contas" className="border border-border/60 bg-background/80 backdrop-blur">
                  <SelectValue placeholder="Todos os grupos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os grupos</SelectItem>
                  {gruposContas.map((grupo) => (
                    <SelectItem key={grupo.id} value={grupo.id}>
                      {grupo.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Filtro de cliente removido - campo cliente_id não existe na tabela lancamentos_caixa */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="tipo-estoque">Tipo de Estoque</Label>
              <Select
                value={filtros.tipo_estoque || 'todos'}
                onValueChange={(value) =>
                  handleFiltroChange('tipo_estoque', value as 'SPPRO' | 'SOI' | 'todos')
                }
              >
                <SelectTrigger id="tipo-estoque" className="border border-border/60 bg-background/80 backdrop-blur">
                  <SelectValue placeholder="Todos os tipos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  <SelectItem value="SPPRO">SPPRO</SelectItem>
                  <SelectItem value="SOI">SOI</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mt-3">
            <div className="flex flex-col gap-2 lg:col-span-6">
              <Label htmlFor="busca">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="busca"
                  type="text"
                  placeholder="Histórico, documento ou descrição..."
                  value={filtros.busca || ''}
                  onChange={(e) => handleFiltroChange('busca', e.target.value)}
                  className="pl-8 border border-border/60 bg-background/80 backdrop-blur"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFiltros}
              className="gap-2"
            >
              <Calendar className="h-4 w-4" />
              Este Mês
            </Button>
          </div>
          {!filtrosValidos && (
            <p className="text-sm text-destructive mt-2">
              A data fim deve ser maior ou igual à data início.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Conteúdo Principal */}
      {isLoading ? (
        <Card variant="glass">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Carregando recebimentos...</p>
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <Card variant="glass">
          <CardContent className="py-12">
            <p className="text-center text-destructive">
              Erro ao carregar recebimentos. Tente novamente.
            </p>
          </CardContent>
        </Card>
      ) : !filtrosValidos ? (
        <Card variant="glass">
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground">
              Ajuste as datas do filtro para visualizar os recebimentos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Card de Recebíveis de Estoque (no início) */}
          {recebimentosEstoque.length > 0 && (
            <RecebiveisEstoqueCard recebimentos={recebimentosEstoque} />
          )}

          {/* Cards por Grupo de Contas */}
          <RecebidosCards 
            recebimentos={recebimentosCaixa} 
            todosGruposEntrada={todosGruposEntrada} 
          />
        </>
      )}
    </div>
  );
}
