import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Calendar, 
  Wallet,
  Building2,
  ArrowLeftRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID, isConflictError } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { type ContasEstoquesAnalytics, type AlertItem, type ContaResumo } from '@/components/Dashboard/ContasEstoquesView';
import { useDevolucoesTotais, useEstoquesResumo } from '@/hooks/useEstoque';
import { MetricCardLarge } from '@/components/Dashboard/MetricCardLarge';
import { PageHeader } from '@/components/Layout/PageHeader';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart
} from 'recharts';

type ModoFiltro = 'periodo' | 'custom';
type ProfileEmpresaId = { empresa_id: string | null };
type ContaBancariaOption = { id: string; descricao: string; bancos: { nome: string } | null };
type GrupoContaOption = { id: string; nome: string; natureza: string | null };
type ErrorLike = { message?: string; code?: string };

export default function DashboardAvancado() {
  const [periodo, setPeriodo] = useState("30"); // hoje, 7, 30, 90, 365 dias
  const [modoFiltro, setModoFiltro] = useState<ModoFiltro>('periodo');
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [contaBancariaId, setContaBancariaId] = useState<string>("todos");
  const [contasBancarias, setContasBancarias] = useState<ContaBancariaOption[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [contasEstoquesAnalytics, setContasEstoquesAnalytics] = useState<ContasEstoquesAnalytics | null>(null);
  const [contasEstoquesLoading, setContasEstoquesLoading] = useState(false);
  const [contasEstoquesError, setContasEstoquesError] = useState<string | null>(null);
  const [contasAplicacao, setContasAplicacao] = useState<ContaResumo[]>([]);
  const [gruposContas, setGruposContas] = useState<GrupoContaOption[]>([]);

  const { data: estoquesResumo, isLoading: estoquesResumoLoading } = useEstoquesResumo();
  const {
    data: devolucoesTotais,
    isLoading: devolucoesTotaisLoading,
    isError: devolucoesTotaisError,
  } = useDevolucoesTotais();

  const loadContasEstoquesAnalytics = useCallback(async () => {

    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    setContasEstoquesLoading(true);
    setContasEstoquesError(null);

    try {
      let dataInicioCalc: Date;
      let dataFimCalc: Date;
      let periodoDescricao: string;

      if (modoFiltro === "custom" && dataInicio && dataFim) {
        dataInicioCalc = new Date(dataInicio);
        dataInicioCalc.setHours(0, 0, 0, 0);
        dataFimCalc = new Date(dataFim);
        dataFimCalc.setHours(23, 59, 59, 999);
        
        // Validar que data início não é maior que data fim
        if (dataInicioCalc > dataFimCalc) {
          toast.error("Data início não pode ser maior que data fim");
          setContasEstoquesLoading(false);
          return;
        }
        
        periodoDescricao = `${dataInicioCalc.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${dataFimCalc.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
      } else {
        const hoje = new Date();
        dataFimCalc = new Date();
        dataFimCalc.setHours(23, 59, 59, 999);
        dataInicioCalc = new Date();
        dataInicioCalc.setHours(0, 0, 0, 0);
        if (periodo !== "hoje") {
          const dias = parseInt(periodo, 10);
          if (!Number.isNaN(dias)) {
            dataInicioCalc.setDate(dataInicioCalc.getDate() - dias);
          }
        }
        periodoDescricao = periodo === "hoje" ? "Hoje" : `Últimos ${periodo} dias`;
      }

      const periodoIsoInicio = dataInicioCalc.toISOString().split("T")[0];
      const periodoIsoFim = dataFimCalc.toISOString().split("T")[0];

      const { data: contasRows, error: contasError } = await supabase
        .from("contas_bancarias")
        .select(`
          id,
          descricao,
          saldo_atual,
          saldo_inicial,
          status,
          bancos (
            nome,
            codigo
          )
        `)
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });

      if (contasError) {
        throw contasError;
      }

      // Função helper para normalizar string (remover acentos, espaços extras, caracteres especiais)
      const normalizeString = (str: string): string => {
        return (str || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") // Remove acentos
          .replace(/[^a-zA-Z0-9]/g, "") // Remove caracteres especiais
          .toUpperCase();
      };

      // Separar contas de aplicação e fornecedor das contas normais usando matching mais flexível
      const contasDeAplicacao = (contasRows || []).filter((conta) => {
        const descNorm = normalizeString(conta.descricao);
        return descNorm.includes("SBOI2APLIC") || 
               descNorm.includes("SBGAPLIC") ||
               descNorm.includes("SBOI2FORNEC") || 
               descNorm.includes("SBGFORNEC");
      });

      // Criar conjunto de IDs das contas de aplicação para exclusão garantida
      const idsContasAplicacao = new Set(contasDeAplicacao.map(conta => conta.id?.toString() ?? String(conta.id)));

      // Contas normais (excluindo fornecedor e aplicação por ID e descrição)
      const contasFiltradas = (contasRows || []).filter((conta) => {
        const contaId = conta.id?.toString() ?? String(conta.id);
        // Excluir por ID primeiro (mais confiável)
        if (idsContasAplicacao.has(contaId)) {
          return false;
        }
        // Excluir por descrição também (backup) usando normalização
        const descNorm = normalizeString(conta.descricao);
        return !descNorm.includes("SBGFORNEC") && 
               !descNorm.includes("SBOI2FORNEC") &&
               !descNorm.includes("SBOI2APLIC") &&
               !descNorm.includes("SBGAPLIC");
      });

      const contasNormalizadas = contasFiltradas.map((conta) => {
        // Usar mesma lógica de ContasEstoques: saldo_atual se definido (inclusive zero), senão saldo_inicial
        const saldoAtual = conta.saldo_atual !== null && conta.saldo_atual !== undefined
          ? Number(conta.saldo_atual)
          : Number(conta.saldo_inicial ?? 0);
        const saldoInicial = Number(conta.saldo_inicial ?? 0);
        const variacao = saldoAtual - saldoInicial;

        return {
          id: conta.id?.toString?.() ?? String(conta.id),
          descricao: conta.descricao ?? "-",
          saldoAtual,
          status: Boolean(conta.status),
          bancoNome: conta.bancos?.nome ?? null,
          percentualDoTotal: 0,
          variacao,
        };
      });

      const contasAtivasNormalizadas = contasNormalizadas.filter((conta) => conta.status);
      const saldoContasTotal = contasAtivasNormalizadas.reduce((acc, conta) => acc + conta.saldoAtual, 0);
      const contasAtivas = contasAtivasNormalizadas.length;
      const contasInativas = contasNormalizadas.length - contasAtivas;

      const contasComPercentual = contasAtivasNormalizadas.map((conta) => ({
        ...conta,
        percentualDoTotal: saldoContasTotal > 0 ? (conta.saldoAtual / saldoContasTotal) * 100 : 0,
      }));

      // Processar contas de aplicação separadamente
      const contasAplicNormalizadas = contasDeAplicacao.map((conta) => {
        const saldoAtual = conta.saldo_atual !== null && conta.saldo_atual !== undefined
          ? Number(conta.saldo_atual)
          : Number(conta.saldo_inicial ?? 0);
        const saldoInicial = Number(conta.saldo_inicial ?? 0);
        const variacao = saldoAtual - saldoInicial;

        return {
          id: conta.id?.toString?.() ?? String(conta.id),
          descricao: conta.descricao ?? "-",
          saldoAtual,
          status: Boolean(conta.status),
          bancoNome: conta.bancos?.nome ?? null,
          percentualDoTotal: 0,
          variacao,
        };
      });

      // Ordenar contas de aplicação por valor (maior para menor)
      const contasAplicOrdenadas = [...contasAplicNormalizadas].sort((a, b) => {
        // Ordenar por saldoAtual em ordem decrescente (maior valor primeiro)
        return b.saldoAtual - a.saldoAtual;
      });

      // Armazenar contas de aplicação no estado
      setContasAplicacao(contasAplicOrdenadas);

      const contasAplicAtivasNormalizadas = contasAplicOrdenadas.filter((conta) => conta.status);

      // Calcular saldo total e variação das contas de aplicação ativas
      const saldoAplicTotal = contasAplicAtivasNormalizadas.reduce((acc, conta) => acc + conta.saldoAtual, 0);
      const variacaoAplic = contasAplicAtivasNormalizadas.reduce((acc, conta) => acc + (conta.variacao || 0), 0);

      let lancamentosQuery = supabase
        .from("lancamentos_caixa")
        .select(`
          id,
          data,
          tipo,
          valor,
          conta_bancaria_id,
          grupos_contas(nome)
        `)
        .eq("empresa_id", empresaId)
        .gte("data", periodoIsoInicio)
        .lte("data", periodoIsoFim);

      if (contaBancariaId !== "todos") {
        lancamentosQuery = lancamentosQuery.eq("conta_bancaria_id", contaBancariaId);
      }

      const { data: lancamentosRows, error: lancamentosError } = await lancamentosQuery;
      if (lancamentosError) {
        throw lancamentosError;
      }

      const fluxoMap = new Map<string, { data: string; entradas: number; saidas: number; saldo: number }>();

      (lancamentosRows || []).forEach((lanc) => {
        const chave = lanc.data;
        if (!fluxoMap.has(chave)) {
          fluxoMap.set(chave, { data: chave, entradas: 0, saidas: 0, saldo: 0 });
        }

        const atual = fluxoMap.get(chave)!;
        const valor = Number(lanc.valor) || 0;

        if (lanc.tipo === "entrada") {
          atual.entradas += valor;
        } else {
          atual.saidas += valor;
        }
      });

      const datasOrdenadas = Array.from(fluxoMap.keys()).sort((a, b) => a.localeCompare(b));
      let saldoAcumulado = 0;
      const fluxoDiario = datasOrdenadas.map((data) => {
        const ponto = fluxoMap.get(data)!;
        saldoAcumulado += ponto.entradas - ponto.saidas;
        return { ...ponto, saldo: saldoAcumulado };
      });

      const entradasTotais = fluxoDiario.reduce((acc, item) => acc + item.entradas, 0);
      const saidasTotais = fluxoDiario.reduce((acc, item) => acc + item.saidas, 0);
      const saldoVariacao = fluxoDiario.length ? fluxoDiario[fluxoDiario.length - 1].saldo : 0;
      const saldoBase = saldoContasTotal - saldoVariacao;
      const saldoVariacaoPercentual = saldoBase !== 0 ? (saldoVariacao / saldoBase) * 100 : 0;

      const despesasMap = new Map<string, { grupo: string; valor: number }>();
      (lancamentosRows || []).forEach((lanc) => {
        if (lanc.tipo !== "saida") return;
        const grupoNome = lanc.grupos_contas?.nome || "Sem grupo";
        if (!despesasMap.has(grupoNome)) {
          despesasMap.set(grupoNome, { grupo: grupoNome, valor: 0 });
        }
        despesasMap.get(grupoNome)!.valor += Number(lanc.valor) || 0;
      });

      const totalDespesas = Array.from(despesasMap.values()).reduce((acc, item) => acc + item.valor, 0);
      const topDespesas = Array.from(despesasMap.values())
        .map((item) => ({
          ...item,
          percentual: totalDespesas > 0 ? (item.valor / totalDespesas) * 100 : 0,
        }))
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5);

      const hoje = new Date();
      const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

      const { data: lancamentosMes, error: lancamentosMesError } = await supabase
        .from("lancamentos_caixa")
        .select("tipo, valor")
        .eq("empresa_id", empresaId)
        .gte("data", primeiroDiaMes.toISOString().split("T")[0])
        .lte("data", ultimoDiaMes.toISOString().split("T")[0]);

      if (lancamentosMesError) {
        throw lancamentosMesError;
      }

      const balancoMes = {
        entradas: (lancamentosMes || [])
          .filter((item) => item.tipo === "entrada")
          .reduce((acc, item) => acc + (Number(item.valor) || 0), 0),
        saidas: (lancamentosMes || [])
          .filter((item) => item.tipo === "saida")
          .reduce((acc, item) => acc + (Number(item.valor) || 0), 0),
        resultado: 0,
      };
      balancoMes.resultado = balancoMes.entradas - balancoMes.saidas;

      const semanaFim = new Date();
      semanaFim.setDate(semanaFim.getDate() + 7);

      const hojeIso = new Date().toISOString().split("T")[0];
      const semanaFimIso = semanaFim.toISOString().split("T")[0];

      const { data: previstosSemana, error: previstosSemanaError } = await supabase
        .from("lancamentos_previstos")
        .select("vencimento, valor, tipo, status")
        .eq("empresa_id", empresaId)
        .in("status", ["previsto", "agendado", "atrasado"])
        .gte("vencimento", hojeIso)
        .lte("vencimento", semanaFimIso);

      if (previstosSemanaError) {
        throw previstosSemanaError;
      }

      const { data: estoquesRows, error: estoquesError } = await supabase
        .from("estoques")
        .select("tipo, saldo_atual")
        .eq("empresa_id", empresaId)
        .eq("ativo", true);

      if (estoquesError) {
        throw estoquesError;
      }

      const estoqueResumo = { sppro: 0, soi: 0, total: 0 };
      (estoquesRows || []).forEach((row) => {
        const valor = Number(row.saldo_atual) || 0;
        
        // Excluir DEVOLUCOES do total do estoque (saldo operacional considera apenas SPPRO/SOI)
        if (row.tipo !== "DEVOLUCOES") {
          estoqueResumo.total += valor;
        }
        
        if (row.tipo === "SPPRO") {
          estoqueResumo.sppro += valor;
        } else if (row.tipo === "SOI") {
          estoqueResumo.soi += valor;
        }
      });

      const estoqueMix = [
        {
          label: "SPPRO",
          value: estoqueResumo.sppro,
          percent: estoqueResumo.total > 0 ? (estoqueResumo.sppro / estoqueResumo.total) * 100 : 0,
        },
        {
          label: "SOI",
          value: estoqueResumo.soi,
          percent: estoqueResumo.total > 0 ? (estoqueResumo.soi / estoqueResumo.total) * 100 : 0,
        },
      ];

      const estoqueVariacao = estoqueResumo.sppro - estoqueResumo.soi;
      const estoqueVariacaoPercentual = estoqueResumo.total > 0 ? (estoqueVariacao / estoqueResumo.total) * 100 : 0;

      const lowBalanceAccounts = contasComPercentual.filter(
        (conta) => conta.saldoAtual < 10000 || conta.percentualDoTotal < 2,
      );
      const contasConciliadas = Math.max(0, contasAtivas - lowBalanceAccounts.length);

      const alerts: AlertItem[] = [];
      if (lowBalanceAccounts.length > 0) {
        alerts.push({
          type: "warning",
          title: "Contas com baixa liquidez",
          description: `${lowBalanceAccounts.length} conta(s) abaixo de ${formatCurrency(10000)}. Considere reforçar essas posições.`,
        });
      }

      const contasFixasSaida = (previstosSemana || []).filter((item) => item.tipo === "saida");
      if (contasFixasSaida.length > 0) {
        const total = contasFixasSaida.reduce((acc, item) => acc + (Number(item.valor) || 0), 0);
        alerts.push({
          type: "warning",
          title: "Pagamentos na próxima semana",
          description: `${contasFixasSaida.length} obrigação(ões) somando ${formatCurrency(total)} vencem em até 7 dias.`,
        });
      }

      const contasFixasEntrada = (previstosSemana || []).filter((item) => item.tipo === "entrada");
      if (contasFixasEntrada.length > 0) {
        const total = contasFixasEntrada.reduce((acc, item) => acc + (Number(item.valor) || 0), 0);
        alerts.push({
          type: "info",
          title: "Recebimentos previstos",
          description: `${contasFixasEntrada.length} entrada(s) estimadas em ${formatCurrency(total)} para o período.`,
        });
      }

      if (estoqueResumo.total > saldoContasTotal * 1.2) {
        alerts.push({
          type: "info",
          title: "Estoque volumoso",
          description: "O estoque financeiro supera 120% da posição bancária. Avalie recompras ou liquidações.",
        });
      }

      if (alerts.length === 0) {
        alerts.push({
          type: "success",
          title: "Liquidez equilibrada",
          description: "Nenhum alerta crítico detectado. Continue acompanhando as métricas chave.",
        });
      }

      // Calcular saldo global (contas ativas + estoques operacionais + aplicações ativas)
      const saldoGlobal = saldoContasTotal + estoqueResumo.total + saldoAplicTotal;

      // Calcular variação total do saldo global (soma das variações individuais)
      const saldoGlobalVariacao = saldoVariacao + estoqueVariacao + variacaoAplic;

      // Calcular saldo base para percentual (saldo inicial do período)
      const saldoBaseGlobal = saldoBase + (estoqueResumo.total - estoqueVariacao) + (saldoAplicTotal - variacaoAplic);
      const saldoGlobalVariacaoPercentual = saldoBaseGlobal !== 0 
        ? (saldoGlobalVariacao / saldoBaseGlobal) * 100 
        : 0;

      const analytics: ContasEstoquesAnalytics = {
        periodoDescricao,
        contasSaldoTotal: saldoContasTotal,
        contasSaldoVariacao: saldoVariacao,
        contasSaldoVariacaoPercentual: saldoVariacaoPercentual,
        contasAtivas,
        contasInativas,
        contasConciliadas,
        contas: contasComPercentual,
        estoque: {
          total: estoqueResumo.total,
          variacao: estoqueVariacao,
          variacaoPercentual: estoqueVariacaoPercentual,
          sppro: estoqueResumo.sppro,
          soi: estoqueResumo.soi,
          mix: estoqueMix,
        },
        saldoGlobal, // Saldo global = contas ativas + estoques operacionais + aplicações ativas
        aplicSaldoTotal: saldoAplicTotal,
        aplicSaldoVariacao: variacaoAplic,
        saldoGlobalVariacao,
        saldoGlobalVariacaoPercentual,
        fluxoDiario,
        entradasTotais,
        saidasTotais,
        topDespesas,
        balancoMes,
        alerts,
      };

      setContasEstoquesAnalytics(analytics);
    } catch (error: unknown) {
      logger.error("Erro ao consolidar visão de Contas & Estoque:", error);
      const errorData = error as ErrorLike;
      const errorMessage = errorData?.message || errorData?.code 
        ? `Erro ao carregar dados: ${errorData.message || errorData.code}. Verifique sua conexão e tente novamente.`
        : "Erro inesperado ao carregar dados de Contas & Estoque. Por favor, recarregue a página.";
      setContasEstoquesError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setContasEstoquesLoading(false);
    }
  }, [empresaId, modoFiltro, dataInicio, dataFim, periodo, contaBancariaId]);

  useEffect(() => {
    fetchEmpresaId();
  }, []);

  useEffect(() => {
    if (empresaId) {
      loadContasEstoquesAnalytics();
    }
  }, [empresaId, loadContasEstoquesAnalytics]);

  const fetchEmpresaId = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profileRaw, error } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", session.user.id)
        .maybeSingle();

      if (error) {
        logger.error("Erro ao buscar empresa_id:", error);
        return;
      }

      const profile = profileRaw as ProfileEmpresaId | null;
      const empresaIdRaw = profile?.empresa_id ?? null;
      if (!empresaIdRaw) {
        return;
      }

      const empresaIdValue = ensureUUID(empresaIdRaw);
      if (empresaIdValue) {
        setEmpresaId(empresaIdValue);
      }
    } catch (error) {
      logger.error("Erro ao buscar empresa_id:", error);
    }
  };

  const loadContasBancarias = useCallback(async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contas_bancarias')
        .select('id, descricao, bancos(nome)')
        .eq('empresa_id', empresaId)
        .order('descricao');
            
      if (error) throw error;
      setContasBancarias((data as ContaBancariaOption[]) || []);
    } catch (error: unknown) {
      logger.error('Erro ao carregar contas:', error);
      const errorData = error as ErrorLike;
      const errorMessage = errorData?.message || errorData?.code
        ? `Erro ao carregar contas bancárias: ${errorData.message || errorData.code}`
        : "Erro ao carregar contas bancárias. Por favor, recarregue a página.";
      toast.error(errorMessage);
    }
  }, [empresaId]);

  const fetchGruposContas = useCallback(async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from("grupos_contas")
        .select("id, nome, natureza")
        .eq("empresa_id", empresaId)
        .order("nome");
      
      if (error) throw error;
      setGruposContas((data as GrupoContaOption[]) || []);
    } catch (error: unknown) {
      logger.error("Erro ao carregar grupos de contas:", error);
      const errorData = error as ErrorLike;
      const errorMessage = errorData?.message || errorData?.code
        ? `Erro ao carregar grupos de contas: ${errorData.message || errorData.code}`
        : "Erro ao carregar grupos de contas. Por favor, recarregue a página.";
      toast.error(errorMessage);
    }
  }, [empresaId]);

  useEffect(() => {
    if (empresaId) {
      loadContasBancarias();
      fetchGruposContas();
    }
  }, [empresaId, loadContasBancarias, fetchGruposContas]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  // Helper para gerar ícone/abreviação do banco
  const getBankIcon = (bancoNome: string | null | undefined): string => {
    if (!bancoNome) return "🏦";
    const nome = bancoNome.toUpperCase();
    
    // Mapeamento de bancos conhecidos
    if (nome.includes("BRADESCO")) return "B";
    if (nome.includes("ITAU") || nome.includes("ITAÚ")) return "I";
    if (nome.includes("BANCOOB") || nome.includes("COOPERATIVO")) return "C";
    if (nome.includes("SANTANDER")) return "S";
    if (nome.includes("CAIXA") || nome.includes("CEF")) return "CX";
    if (nome.includes("BANRISUL")) return "BR";
    if (nome.includes("SICOOB")) return "SC";
    if (nome.includes("INTER")) return "IN";
    if (nome.includes("NUBANK")) return "N";
    if (nome.includes("C6")) return "C6";
    
    // Retorna primeira letra se não encontrar match
    return nome.charAt(0);
  };

  // Handlers para mudança de filtros
  const handlePeriodoChange = (value: string) => {
    setPeriodo(value);
    setModoFiltro('periodo');
    setDataInicio("");
    setDataFim("");
  };

  const handleDataInicioChange = (value: string) => {
    setDataInicio(value);
    setModoFiltro('custom');
  };

  const handleDataFimChange = (value: string) => {
    setDataFim(value);
    setModoFiltro('custom');
  };

  // Renderizar visualização de Contas & Estoque
  const analytics = contasEstoquesAnalytics;
    const heroLoading = contasEstoquesLoading;
    const devolucoesFallbackAtivo = devolucoesTotaisError;
    const devolucoesResumo = useMemo(
      () => (!devolucoesFallbackAtivo && devolucoesTotais
        ? devolucoesTotais
        : {
            total: Number(estoquesResumo?.devolucoes) || 0,
            sppro: Number(estoquesResumo?.devolucoesSppro) || 0,
            soi: Number(estoquesResumo?.devolucoesSoi) || 0,
            naoClassificado: 0,
          }),
      [devolucoesFallbackAtivo, devolucoesTotais, estoquesResumo],
    );
    const devolucoesLoading =
      devolucoesTotaisLoading || (devolucoesFallbackAtivo && estoquesResumoLoading);
    const estoqueConsolidado = useMemo(() => {
      if (!analytics) {
        return null;
      }

      const devolucoesSppro = Number(devolucoesResumo?.sppro) || 0;
      const devolucoesSoi = Number(devolucoesResumo?.soi) || 0;
      const spproFinal = (Number(analytics.estoque?.sppro) || 0) + devolucoesSppro;
      const soiFinal = (Number(analytics.estoque?.soi) || 0) + devolucoesSoi;
      const totalFinal = spproFinal + soiFinal;
      const variacaoFinal = spproFinal - soiFinal;

      return {
        sppro: spproFinal,
        soi: soiFinal,
        total: totalFinal,
        variacao: variacaoFinal,
        variacaoPercentual: totalFinal > 0 ? (variacaoFinal / totalFinal) * 100 : 0,
        mix: [
          {
            label: "SPPRO",
            value: spproFinal,
            percent: totalFinal > 0 ? (spproFinal / totalFinal) * 100 : 0,
          },
          {
            label: "SOI",
            value: soiFinal,
            percent: totalFinal > 0 ? (soiFinal / totalFinal) * 100 : 0,
          },
        ],
      };
    }, [analytics, devolucoesResumo]);
    const saldoEstoqueLoading = heroLoading || devolucoesLoading;
    const saldoGlobalCard = useMemo(() => {
      if (!analytics || !estoqueConsolidado) {
        return null;
      }

      const contasTotal = Number(analytics.contasSaldoTotal) || 0;
      const contasVariacao = Number(analytics.contasSaldoVariacao) || 0;
      const aplicTotal = Number(analytics.aplicSaldoTotal) || 0;
      const aplicVariacao = Number(analytics.aplicSaldoVariacao) || 0;
      const estoqueTotal = Number(estoqueConsolidado.total) || 0;
      const estoqueVariacao = Number(estoqueConsolidado.variacao) || 0;

      const total = contasTotal + estoqueTotal + aplicTotal;
      const variacao = contasVariacao + estoqueVariacao + aplicVariacao;
      const base =
        (contasTotal - contasVariacao) +
        (estoqueTotal - estoqueVariacao) +
        (aplicTotal - aplicVariacao);

      return {
        total,
        variacao,
        variacaoPercentual: base !== 0 ? (variacao / base) * 100 : 0,
      };
    }, [analytics, estoqueConsolidado]);

    // Usar contas de aplicação do estado (processadas separadamente)
    const contasAplic: ContaResumo[] = contasAplicacao || [];
    const totalAplic = contasAplic.filter((conta) => conta.status).reduce((acc, conta) => acc + conta.saldoAtual, 0);
    const contasAplicAtivas = contasAplic.filter((conta) => conta.status).length;
    const contasAplicInativas = contasAplic.length - contasAplicAtivas;

    // Contas já foram filtradas no processamento inicial, então todas as contas já excluem aplicações
    const contasSemAplic = analytics?.contas || [];
    const saldoTotalContas = contasSemAplic.reduce((acc, conta) => acc + conta.saldoAtual, 0);

    return (
        <div className="space-y-6">
          <PageHeader
            title="Dashboard"
          />

          {contasEstoquesError ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <p className="text-sm text-destructive">{contasEstoquesError}</p>
                <Button variant="outline" onClick={loadContasEstoquesAnalytics} disabled={contasEstoquesLoading}>
                  Tentar novamente
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Layout snapshot: grid 1/3 + 2/3 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {/* Col 1: Contas ativas */}
            <div className="lg:col-span-1 flex flex-col">
              <Card className="relative overflow-hidden rounded-lg border text-card-foreground border-border/20 bg-card shadow-sm transition-all duration-200 hover:shadow-md flex flex-col h-full w-full">
                <div className="flex flex-col gap-2 px-6 py-4 border-b border-border-light pb-3 flex-shrink-0">
                  <h3 className="tracking-[-0.01em] text-xs sm:text-sm font-medium text-muted-foreground">Contas ativas</h3>
                </div>
                <div className="p-4 sm:p-5 flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex-shrink-0 mb-3">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Saldo total</p>
                    <div className="space-y-1.5 mt-2">
                      <p className="text-base sm:text-lg font-bold text-text whitespace-nowrap">
                        {heroLoading ? "--" : analytics ? formatCurrency(saldoTotalContas) : "--"}
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar min-h-0">
                      <div className="space-y-2 pr-3 pb-2">
                        {heroLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-14 w-full rounded-lg" />
                            <Skeleton className="h-14 w-full rounded-lg" />
                            <Skeleton className="h-14 w-full rounded-lg" />
                          </div>
                        ) : (
                          analytics?.contas?.map((conta) => (
                            <div
                              key={conta.id}
                              className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-background hover:border-primary/50 transition-all duration-200"
                            >
                              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-sm font-bold text-primary">
                                  {getBankIcon(conta.bancoNome)}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-text truncate">{conta.descricao}</p>
                                <p className="text-xs text-muted-foreground mt-1">Conta corrente</p>
                              </div>
                              <div className="flex-shrink-0 text-right">
                                <p className="text-sm font-bold text-text whitespace-nowrap">
                                  {formatCurrency(conta.saldoAtual)}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Col 2: Saldo Global + Saldo Estoque + Contas Aplic + Estoque Devoluções + Visualizar Movimentações */}
            <div className="lg:col-span-2 space-y-6 flex flex-col">
              {/* Row 1: Saldo Global + Saldo Estoque */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MetricCardLarge
                  isPrimary
                  title="Saldo Global"
                  value={saldoGlobalCard ? formatCurrency(saldoGlobalCard.total) : "--"}
                  subtitle={analytics?.periodoDescricao ?? "Últimos 30 dias"}
                  icon={<Wallet className="h-4 w-4 sm:h-5 sm:w-5" />}
                  trend={saldoGlobalCard ? {
                    value: `${saldoGlobalCard.variacao >= 0 ? '+' : ''}${formatCurrency(Math.abs(saldoGlobalCard.variacao))}${saldoGlobalCard.variacaoPercentual ? ` ${saldoGlobalCard.variacaoPercentual >= 0 ? '+' : ''}${saldoGlobalCard.variacaoPercentual.toFixed(1)}%` : ''}`,
                    type: saldoGlobalCard.variacao >= 0 ? 'up' : 'down'
                  } : undefined}
                  loading={heroLoading}
                />
                <Card className="relative overflow-hidden rounded-lg border text-card-foreground border-border/20 bg-card shadow-sm transition-all duration-200 h-full flex flex-col hover:shadow-md">
                  <CardContent className="p-4 sm:p-5 flex flex-col flex-1 min-h-0">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Saldo Estoque</p>
                        <p className="text-xs text-muted-foreground/70">
                          {saldoEstoqueLoading
                            ? ""
                            : estoqueConsolidado
                              ? estoqueConsolidado.mix.map((item) => `${item.label} ${item.percent.toFixed(0)}%`).join(" • ")
                              : ""}
                        </p>
                      </div>
                      <div className="text-muted-foreground/50">
                        <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {saldoEstoqueLoading ? (
                        <>
                          <Skeleton className="h-6 sm:h-8 w-32 sm:w-40 rounded-md" />
                          <Skeleton className="h-4 w-48 sm:w-56 rounded-md" />
                        </>
                      ) : (
                        <p className="font-bold text-text whitespace-nowrap text-base sm:text-lg">
                          {estoqueConsolidado ? formatCurrency(estoqueConsolidado.total) : "--"}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 border-t border-border/40 pt-4 flex-1 min-h-0 flex flex-col">
                      <p className="text-xs font-medium text-muted-foreground mb-3 flex-shrink-0">Estoques disponíveis</p>
                      <div className="flex-1 overflow-y-auto pr-1 -mr-1">
                        <div className="space-y-2">
                          {saldoEstoqueLoading ? (
                            <>
                              <Skeleton className="h-14 w-full rounded-lg" />
                              <Skeleton className="h-14 w-full rounded-lg" />
                            </>
                          ) : (
                            estoqueConsolidado?.mix?.map((estoque: { label: string; value: number; percent: number }, index: number) => (
                              <div
                                key={estoque.label || index}
                                className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-background hover:border-primary/50 transition-all duration-200"
                              >
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-bold text-primary">
                                    {estoque.label === "SPPRO" ? "S" : "O"}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-text truncate">{estoque.label}</p>
                                  <p className="text-xs text-muted-foreground mt-1">{estoque.percent.toFixed(1)}% do total</p>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-sm font-bold text-text whitespace-nowrap">{formatCurrency(estoque.value)}</p>
                                  <p className="text-xs text-muted-foreground whitespace-nowrap">{estoque.percent.toFixed(1)}%</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Row 2: Contas Aplic + Estoque Devoluções */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Contas Aplic */}
                <Card className="relative overflow-hidden rounded-lg border text-card-foreground border-border/20 bg-card shadow-sm transition-all duration-200 h-full flex flex-col hover:shadow-md">
                  <CardContent className="p-4 sm:p-5 flex flex-col flex-1 min-h-0">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Contas Aplic</p>
                        <p className="text-xs text-muted-foreground/70">
                          {heroLoading ? "" : `${contasAplicAtivas} ativas${contasAplicInativas > 0 ? ` • ${contasAplicInativas} inativas` : ""}`}
                        </p>
                      </div>
                      <div className="text-muted-foreground/50">
                        <Building2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {heroLoading ? (
                        <>
                          <Skeleton className="h-6 sm:h-8 w-32 sm:w-40 rounded-md" />
                          <Skeleton className="h-4 w-48 sm:w-56 rounded-md" />
                        </>
                      ) : (
                        <p className="font-bold text-text whitespace-nowrap text-base sm:text-lg">
                          {analytics ? formatCurrency(totalAplic) : "--"}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 border-t border-border/40 pt-4 flex-1 min-h-0 flex flex-col">
                      <p className="text-xs font-medium text-muted-foreground mb-3 flex-shrink-0">Contas de aplicação</p>
                      <div className="flex-1 overflow-y-auto pr-1 -mr-1">
                        <div className="space-y-2">
                          {heroLoading ? (
                            <>
                              <Skeleton className="h-14 w-full rounded-lg" />
                              <Skeleton className="h-14 w-full rounded-lg" />
                            </>
                          ) : (
                            contasAplic.map((conta) => (
                              <div
                                key={conta.id}
                                className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-background hover:border-primary/50 transition-all duration-200"
                              >
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-bold text-primary">{getBankIcon(conta.bancoNome)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-text truncate">{conta.descricao}</p>
                                    <Badge variant="outline" className="text-xs px-2 py-0.5 h-5">
                                      {conta.status ? "Ativa" : "Inativa"}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-sm font-bold text-text whitespace-nowrap">{formatCurrency(conta.saldoAtual)}</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Estoque Devoluções — disponível determinístico via valor_restante (com fallback visual) */}
                <Card className="relative overflow-hidden rounded-lg border text-card-foreground border-border/20 bg-card shadow-sm transition-all duration-200 h-full flex flex-col hover:shadow-md">
                  <CardContent className="p-4 sm:p-5 flex flex-col flex-1 min-h-0">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Estoque Devoluções</p>
                        <p className="text-xs text-muted-foreground/70">
                          {devolucoesLoading
                            ? ""
                            : [
                                `SPPRO: ${formatCurrency(devolucoesResumo.sppro ?? 0)}`,
                                `SOI: ${formatCurrency(devolucoesResumo.soi ?? 0)}`,
                              ].join(' • ')}
                        </p>
                        {devolucoesFallbackAtivo && (
                          <p className="mt-1 text-[11px] text-amber-600">
                            Fallback ativo: exibindo snapshot de DEVOLUCOES.
                          </p>
                        )}
                      </div>
                      <div className="text-muted-foreground/50">
                        <ArrowLeftRight className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {devolucoesLoading ? (
                        <>
                          <Skeleton className="h-6 sm:h-8 w-32 sm:w-40 rounded-md" />
                          <Skeleton className="h-4 w-48 sm:w-56 rounded-md" />
                        </>
                      ) : (
                        <p className="font-bold text-text whitespace-nowrap text-base sm:text-lg">
                          {formatCurrency(devolucoesResumo.total ?? 0)}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 border-t border-border/40 pt-4 flex-1 min-h-0 flex flex-col">
                      <div className="flex-1 overflow-y-auto pr-1 -mr-1">
                        <div className="space-y-2">
                          {devolucoesLoading ? (
                            <>
                              <Skeleton className="h-14 w-full rounded-lg" />
                              <Skeleton className="h-14 w-full rounded-lg" />
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-background hover:border-primary/50 transition-all duration-200">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-bold text-primary">S</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-text truncate">SPPRO</p>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-sm font-bold text-text whitespace-nowrap">{formatCurrency(devolucoesResumo.sppro ?? 0)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-background hover:border-primary/50 transition-all duration-200">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-bold text-primary">O</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-text truncate">SOI</p>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-sm font-bold text-text whitespace-nowrap">{formatCurrency(devolucoesResumo.soi ?? 0)}</p>
                                </div>
                              </div>
                              {(devolucoesResumo.naoClassificado ?? 0) > 0 && (
                                <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-300/50 bg-amber-50/60 transition-all duration-200">
                                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                    <span className="text-sm font-bold text-amber-700">N</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-text truncate">Não classificado</p>
                                  </div>
                                  <div className="flex-shrink-0 text-right">
                                    <p className="text-sm font-bold text-text whitespace-nowrap">
                                      {formatCurrency(devolucoesResumo.naoClassificado ?? 0)}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Row 3: Visualizar Movimentações do Dia */}
              <Card className="relative overflow-hidden rounded-lg border text-card-foreground border-border/20 bg-card shadow-sm transition-all duration-200 hover:shadow-md cursor-pointer">
                <CardContent className="p-6">
                  <Link
                    to="/financeiro/lancamentos"
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Calendar className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="tracking-[-0.01em] text-base font-semibold text-text">Visualizar Movimentações do Dia</h3>
                        <p className="text-sm text-muted-foreground mt-1">Acesse o fluxo de caixa diário e movimentações detalhadas</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 px-3">
                      Ver detalhes
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
    );
}
