import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sparkles,
  Clock,
  Calendar as CalendarIcon,
  TrendingDown,
  TrendingUp,
  Check,
  Loader2,
  Plus,
  Table as TableIcon,
  Pencil,
  Trash2,
  Filter,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { FullScreenCalendar, type CalendarData, type Event } from "@/components/ui/fullscreen-calendar";
import { format, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn, parseDateFromDB } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useLancamentosPrevistos, usePrevistoActions, useGerarPrevistos, useCreateContaFixa, useContasFixas, useUpdateContaFixa, useDeleteContaFixa } from "@/hooks/useContasFixas";
import { STATUS_PREVISTO, StatusPrevisto, PERIODICIDADES, DIAS_SEMANA, CreateContaFixa } from "@/types/contas-fixas";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID, isConflictError } from "@/lib/uuid";
import { useQueryClient } from "@tanstack/react-query";
import { extractContaFixaRpcErrorDetails } from "@/hooks/contasFixasRpcPayload";

type PrevistoItem = {
  id: number;
  valor: number;
  status: StatusPrevisto;
  vencimento: string;
  tipo: "entrada" | "saida";
  historico?: string | null;
  competencia?: string | null;
  pago_em?: string | null;
  fixa_id?: number | null;
  contas_fixas?: {
    descricao?: string | null;
    periodicidade?: string | null;
  } | null;
  grupos_contas?: {
    nome?: string | null;
    natureza?: string | null;
  } | null;
  contas_bancarias?: {
    descricao?: string | null;
    agencia?: string | null;
    conta?: string | null;
  } | null;
};

type PrevistoStatusFilter = "pendentes" | "todos" | StatusPrevisto | "atrasados";

const statusBadgeStyles: Record<StatusPrevisto, string> = {
  previsto: "border-primary/40 bg-primary/10 text-primary",
  agendado: "border-amber-400/40 bg-amber-500/10 text-amber-500",
  pago: "border-emerald-400/40 bg-emerald-500/10 text-emerald-500",
  atrasado: "border-destructive/40 bg-destructive/10 text-destructive",
};

const statusLabelMap = STATUS_PREVISTO.reduce<Record<StatusPrevisto, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {
  previsto: "Previsto",
  agendado: "Agendado",
  pago: "Pago",
  atrasado: "Atrasado",
});

const statusFilterOptions = (
  tipo: "entrada" | "saida",
): Array<{ value: PrevistoStatusFilter; label: string }> => [
  { value: "pendentes", label: "Pendentes" },
  { value: "todos", label: "Todos" },
  { value: "previsto", label: "Somente previstos" },
  { value: "agendado", label: "Somente agendados" },
  { value: "atrasados", label: "Somente vencidos" },
  { value: "pago", label: tipo === "saida" ? "Pagos" : "Recebidos" },
];

const parseDate = (input?: string | null) => {
  // Usar função auxiliar que garante tratamento como data local
  return parseDateFromDB(input);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = parseDate(value);
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR");
};

const formatCompetencia = (date: Date) => date.toISOString().slice(0, 7);

const getCompetenciaFromDate = (dateString?: string) => {
  if (dateString && dateString.length >= 7) {
    return dateString.slice(0, 7);
  }
  return new Date().toISOString().slice(0, 7);
};

type ContaFixaFormState = {
  descricao: string;
  natureza: "entrada" | "saida";
  grupo_contas_id: string;
  conta_bancaria_id: string;
  periodicidade: "mensal" | "semanal" | "quinzenal" | "anual";
  dia_ref: number;
  weekday_ref?: number;
  valor: number;
  ativo: boolean;
  proximo_evento: string;
  tolerancia_dias: number;
  observacoes: string;
};

const initialFormState: ContaFixaFormState = {
  descricao: "",
  natureza: "saida",
  grupo_contas_id: "",
  conta_bancaria_id: "",
  periodicidade: "mensal",
  dia_ref: 1,
  weekday_ref: undefined,
  valor: 0,
  ativo: true,
  proximo_evento: "",
  tolerancia_dias: 0,
  observacoes: "",
};

export type FinanceiroPrevistosBoardProps = {
  tipo: "entrada" | "saida";
  title: string;
  description: string;
  emptyMessage: string;
  defaultStatusFilter?: PrevistoStatusFilter;
};

export const FinanceiroPrevistosBoard = ({
  tipo,
  title,
  description,
  emptyMessage,
  defaultStatusFilter = "pendentes",
}: FinanceiroPrevistosBoardProps) => {
  const today = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return base;
  }, []);

  const upcomingThreshold = useMemo(() => {
    const limit = new Date(today);
    limit.setDate(limit.getDate() + 7);
    return limit;
  }, [today]);

  const thirtyDaysAgo = useMemo(() => {
    const limit = new Date(today);
    limit.setDate(limit.getDate() - 30);
    return limit;
  }, [today]);

  const [statusFilter, setStatusFilter] = useState<PrevistoStatusFilter>(defaultStatusFilter);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [competencia, setCompetencia] = useState<string>(() => formatCompetencia(today));
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContaId, setEditingContaId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ContaFixaFormState>({ ...initialFormState });
  const [gruposContas, setGruposContas] = useState<any[]>([]);
  const [contasBancarias, setContasBancarias] = useState<any[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: previstos, isLoading } = useLancamentosPrevistos({ tipo, competencia });
  const { data: contasFixas } = useContasFixas();
  const previstoActions = usePrevistoActions();
  const gerarPrevistos = useGerarPrevistos();
  const createConta = useCreateContaFixa();
  const updateConta = useUpdateContaFixa();
  const deleteConta = useDeleteContaFixa();
  const [contaToDelete, setContaToDelete] = useState<number | null>(null);

  const annotatedPrevistos = useMemo(() => {
    return (
      previstos?.map((item) => {
        const parsedVencimento = parseDate(item.vencimento);
        const parsedPagamento = parseDate(item.pago_em ?? undefined);
        const isOverdue =
          item.status !== "pago" &&
          parsedVencimento !== null &&
          parsedVencimento.getTime() < today.getTime();
        const isUpcoming =
          item.status !== "pago" &&
          parsedVencimento !== null &&
          parsedVencimento.getTime() >= today.getTime() &&
          parsedVencimento.getTime() <= upcomingThreshold.getTime();
        const isPaidRecently =
          item.status === "pago" &&
          parsedPagamento !== null &&
          parsedPagamento.getTime() >= thirtyDaysAgo.getTime();

        return {
          ...(item as PrevistoItem),
          parsedVencimento,
          parsedPagamento,
          isOverdue,
          isUpcoming,
          isPaidRecently,
        };
      }) ?? []
    );
  }, [previstos, today, upcomingThreshold, thirtyDaysAgo]);

  const filteredPrevistos = useMemo(() => {
    return annotatedPrevistos
      .filter((item) => {
        switch (statusFilter) {
          case "todos":
            return true;
          case "pendentes":
            return item.status !== "pago";
          case "atrasados":
            return item.isOverdue;
          default:
            return item.status === statusFilter;
        }
      })
      .sort((a, b) => {
        const aTime = a.parsedVencimento ? a.parsedVencimento.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.parsedVencimento ? b.parsedVencimento.getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });
  }, [annotatedPrevistos, statusFilter]);

  const totals = useMemo(() => {
    const pendentes = annotatedPrevistos.filter((item) => item.status !== "pago");
    const overdue = annotatedPrevistos.filter((item) => item.isOverdue);
    const upcoming = annotatedPrevistos.filter((item) => item.isUpcoming);
    const paidRecently = annotatedPrevistos.filter((item) => item.isPaidRecently);

    const sum = (list: typeof annotatedPrevistos) =>
      list.reduce((acc, item) => acc + (item.valor || 0), 0);

    return {
      pendentes: sum(pendentes),
      vencidos: sum(overdue),
      proximos: sum(upcoming),
      pagosRecentes: sum(paidRecently),
      countPendentes: pendentes.length,
      countOverdue: overdue.length,
      countUpcoming: upcoming.length,
    };
  }, [annotatedPrevistos]);

  // Transformar dados para formato do calendário
  const calendarData = useMemo(() => {
    const dataMap = new Map<string, typeof filteredPrevistos>();

    // Agrupar previstos por data
    filteredPrevistos.forEach((previsto) => {
      if (!previsto.parsedVencimento) return;
      
      const dateKey = format(previsto.parsedVencimento, "yyyy-MM-dd");
      if (!dataMap.has(dateKey)) {
        dataMap.set(dateKey, []);
      }
      dataMap.get(dateKey)!.push(previsto);
    });

    // Transformar em formato CalendarData
    return Array.from(dataMap.entries()).map(([dateKey, previstos]) => {
      const day = parse(dateKey, "yyyy-MM-dd", new Date());
      const events: Event[] = previstos.map((previsto) => {
        const isOverdue = previsto.isOverdue;
        const status = isOverdue && previsto.status !== "pago" 
          ? "atrasado" 
          : previsto.status;
        
        return {
          id: previsto.id,
          name: previsto.historico || previsto.contas_fixas?.descricao || "Sem descrição",
          time: "",
          datetime: previsto.vencimento,
          valor: previsto.valor,
          status: status,
          tipo: previsto.tipo,
        };
      });

      return {
        day,
        events,
      };
    });
  }, [filteredPrevistos]);

  const handleMarkAsPaid = async (previstoId: number) => {
    setActionLoadingId(previstoId);
    try {
      await previstoActions.mutateAsync({
        action: "marcar_pago",
        id: previstoId,
        data_pagamento: new Date().toISOString().split("T")[0],
      });
    } catch (error) {
      logger.error("Erro ao marcar previsto como pago:", error);
    } finally {
      setActionLoadingId(null);
    }
  };

  const actionLabel = tipo === "saida" ? "Marcar como pago" : "Marcar como recebido";
  const pagosLabel = tipo === "saida" ? "Pagos (últimos 30d)" : "Recebidos (últimos 30d)";

  const handleGerarPrevistos = async () => {
    if (!empresaId || !isValidUUID(empresaId)) {
      toast.error("Empresa não encontrada. Aguarde o carregamento.");
      return;
    }
    try {
      await gerarPrevistos.mutateAsync({ competencia, empresa_id: empresaId });
    } catch (error) {
      logger.error("Erro ao gerar previstos:", error);
    }
  };

  // Buscar empresa_id do usuário
  useEffect(() => {
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
          logger.error("Erro ao buscar empresa_id:", error);
          return;
        }

        if (!profile) {
          const empresaIdPadrao = '00000000-0000-0000-0000-000000000001';
          const nomeUsuario = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
          
          const { error: insertError } = await supabase
            .from("profiles")
            .insert({
              id: session.user.id,
              empresa_id: empresaIdPadrao,
              nome: nomeUsuario,
              email: session.user.email || '',
              perfil: 'Admin',
            });
          
          if (insertError) {
            if (isConflictError(insertError)) {
              const { data: existingProfile } = await supabase
                .from("profiles")
                .select("empresa_id")
                .eq("id", session.user.id)
                .maybeSingle();
              
              if (existingProfile && existingProfile.empresa_id) {
                const empresaIdValue = ensureUUID(existingProfile.empresa_id);
                if (empresaIdValue) {
                  setEmpresaId(empresaIdValue);
                  return;
                }
              }
            } else {
              logger.error("Erro ao criar perfil:", insertError);
              return;
            }
          }
          
          const empresaIdValue = ensureUUID(empresaIdPadrao);
          if (empresaIdValue) {
            setEmpresaId(empresaIdValue);
            return;
          }
          return;
        }

        if (profile.empresa_id) {
          const empresaIdValue = ensureUUID(profile.empresa_id);
          if (empresaIdValue) {
            setEmpresaId(empresaIdValue);
          }
        }
      } catch (error) {
        logger.error("Erro ao buscar empresa_id:", error);
      }
    };
    fetchEmpresaId();
  }, []);

  // Carregar dados iniciais
  useEffect(() => {
    if (!empresaId || !isValidUUID(empresaId)) return;

    const loadData = async () => {
      try {
        const { data: grupos, error: gruposError } = await supabase
          .from('grupos_contas')
          .select('id, nome, natureza')
          .eq('empresa_id', empresaId)
          .order('nome');
        
        if (gruposError) throw gruposError;
        setGruposContas(grupos || []);

        const { data: contas, error: contasError } = await supabase
          .from('contas_bancarias')
          .select('id, descricao, agencia, conta, bancos(nome)')
          .eq('empresa_id', empresaId)
          .order('descricao');
        
        if (contasError) throw contasError;
        setContasBancarias(contas || []);
      } catch (error) {
        logger.error('Erro ao carregar dados:', error);
      }
    };

    loadData();
  }, [empresaId]);

  const resetForm = () => {
    setFormData({
      ...initialFormState,
      natureza: tipo, // Pré-configurar natureza baseado no tipo da página
    });
    setEditingContaId(null);
  };

  const handleAddConta = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleCalendarDateSelect = (date: Date | undefined) => {
    if (date) {
      // Formatar data para YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const dateString = `${year}-${month}-${day}`;
      
      resetForm();
      setFormData({
        ...initialFormState,
        natureza: tipo,
        proximo_evento: dateString,
      });
      setIsDialogOpen(true);
    }
  };

  const handleEditConta = (fixaId: number, opts?: { vencimento?: string | null }) => {
    const contaFixa = contasFixas?.find((cf) => cf.id === fixaId);
    if (!contaFixa) {
      toast.error("Conta fixa não encontrada");
      return;
    }

    const proximoFromLinha =
      opts?.vencimento != null && String(opts.vencimento).trim() !== ""
        ? (() => {
            const parsed = parseDateFromDB(opts.vencimento);
            return parsed ? format(parsed, "yyyy-MM-dd") : "";
          })()
        : "";

    setEditingContaId(fixaId);
    setFormData({
      descricao: contaFixa.descricao || "",
      natureza: contaFixa.natureza || tipo,
      grupo_contas_id: contaFixa.grupo_contas_id || "",
      conta_bancaria_id: contaFixa.conta_bancaria_id || "",
      periodicidade: contaFixa.periodicidade || "mensal",
      dia_ref: contaFixa.dia_ref || 1,
      weekday_ref: contaFixa.weekday_ref,
      valor: contaFixa.valor || 0,
      ativo: contaFixa.ativo ?? true,
      proximo_evento:
        proximoFromLinha !== ""
          ? proximoFromLinha
          : contaFixa.proximo_evento
            ? (() => {
                const parsedDate = parseDateFromDB(contaFixa.proximo_evento);
                return parsedDate ? format(parsedDate, "yyyy-MM-dd") : "";
              })()
            : "",
      tolerancia_dias: contaFixa.tolerancia_dias || 0,
      observacoes: contaFixa.observacoes || "",
    });
    setIsDialogOpen(true);
  };

  const handleDeleteConta = async (fixaId: number) => {
    try {
      await deleteConta.mutateAsync(fixaId);
      const competencia = getCompetenciaFromDate(new Date().toISOString().slice(0, 10));
      if (!gerarPrevistos.isPending && empresaId && isValidUUID(empresaId)) {
        await gerarPrevistos.mutateAsync({ competencia, empresa_id: empresaId }).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      setContaToDelete(null);
    } catch (error) {
      logger.error("Erro ao deletar conta fixa:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.grupo_contas_id || !formData.conta_bancaria_id) {
      toast.error("Selecione um grupo de contas e uma conta bancária");
      return;
    }

    // Validar se o grupo de contas tem a natureza correta
    const grupoSelecionado = gruposContas.find((g) => g.id.toString() === formData.grupo_contas_id);
    if (grupoSelecionado) {
      // Para entradas, aceitar grupos de entrada, escrito_imob e aplic
      const naturezasValidas = tipo === "entrada" 
        ? ["entrada", "escrito_imob", "aplic"]
        : [tipo];
      
      if (!naturezasValidas.includes(grupoSelecionado.natureza)) {
        toast.error(`O grupo de contas selecionado é de natureza "${grupoSelecionado.natureza}", mas você está criando uma conta de natureza "${tipo}". Selecione um grupo de contas compatível.`);
        return;
      }
    }

    try {
      const competenciaFromProximo = getCompetenciaFromDate(formData.proximo_evento);
      const competenciasParaGerar = Array.from(
        new Set([competencia, competenciaFromProximo].filter((c): c is string => Boolean(c && c.length >= 7))),
      );

      if (editingContaId) {
        // Atualizar conta existente
        await updateConta.mutateAsync({
          id: editingContaId,
          ...formData,
        });
      } else {
        // Criar nova conta
        const payload: CreateContaFixa = {
          ...formData,
        };
        await createConta.mutateAsync(payload);
      }

      // Regenerar previstos para o mês visível no quadro E para o mês do próximo evento no formulário
      // (podem divergir quando a linha está vencida: contas_fixas.proximo_evento já aponta para M+1).
      if (empresaId && isValidUUID(empresaId)) {
        let totalGerados = 0;
        for (const comp of competenciasParaGerar) {
          const { data: count, error: gerarError } = await supabase.rpc("gerar_previstos_mes", {
            p_competencia: comp,
            p_empresa_id: empresaId,
          });
          if (gerarError) {
            logger.error(
              "[previstos][gerar_previstos_mes] Erro ao regenerar previstos após salvar conta fixa",
              JSON.stringify({
                competencia: comp,
                empresaId,
                tipo,
                error: extractContaFixaRpcErrorDetails(gerarError),
              }),
            );
          } else {
            totalGerados += Number(count) || 0;
          }
        }
        await queryClient.invalidateQueries({ queryKey: ["lancamentos-previstos"] });
        await queryClient.invalidateQueries({ queryKey: ["contas-fixas"] });
        if (totalGerados > 0) {
          toast.success(`${totalGerados} lançamentos previstos gerados com sucesso!`);
        }
      }

      setIsDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
    } catch (error: unknown) {
      logger.error(
        "Erro ao salvar conta fixa:",
        JSON.stringify(extractContaFixaRpcErrorDetails(error)),
      );
    }
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border/40 bg-card p-6 shadow-subtle lg:p-8">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-4">
            <Badge variant="secondary" className="w-fit gap-2 border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Inteligência de fluxo
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {title}
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                {totals.countPendentes} pendentes
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                {totals.countOverdue} vencidos
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5">
                <CalendarIcon className="h-3.5 w-3.5 text-success" />
                {totals.countUpcoming} próximos 7 dias
              </span>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-background/80 p-1">
                <Button
                  variant={viewMode === "table" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("table")}
                  className="gap-2"
                >
                  <TableIcon className="h-4 w-4" />
                  Tabela
                </Button>
                <Button
                  variant={viewMode === "calendar" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("calendar")}
                  className="gap-2"
                >
                  <CalendarIcon className="h-4 w-4" />
                  Calendário
                </Button>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={handleAddConta}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Adicionar Conta
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGerarPrevistos}
                disabled={gerarPrevistos.isPending}
                className="gap-2"
              >
                {gerarPrevistos.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Gerar previsões do mês
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card variant="glass">
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-2 flex-1">
              <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">
                Pendentes
              </span>
              <p className="text-lg sm:text-xl font-semibold text-foreground whitespace-nowrap">{formatCurrency(totals.pendentes)}</p>
            </div>
            <span className="rounded-full bg-primary/15 p-2 text-primary">
              <TrendingDown className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Valor total ainda não {tipo === "saida" ? "pago" : "recebido"}.
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-2 flex-1">
              <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">
                Vencidos
              </span>
              <p className="text-lg sm:text-xl font-semibold text-destructive whitespace-nowrap">{formatCurrency(totals.vencidos)}</p>
            </div>
            <span className="rounded-full bg-destructive/15 p-2 text-destructive">
              <Clock className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Valores vencidos aguardando ação imediata.
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-2 flex-1">
              <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">
                Próximos 7 dias
              </span>
              <p className="text-lg sm:text-xl font-semibold text-success whitespace-nowrap">{formatCurrency(totals.proximos)}</p>
            </div>
            <span className="rounded-full bg-success/15 p-2 text-success">
              <CalendarIcon className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Antecipe-se às movimentações desta semana.
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-2 flex-1">
              <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">
                {pagosLabel}
              </span>
              <p className="text-lg sm:text-xl font-semibold text-muted-foreground whitespace-nowrap">
                {formatCurrency(totals.pagosRecentes)}
              </p>
            </div>
            <span className="rounded-full bg-foreground/10 p-2 text-foreground">
              <TrendingUp className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Volume confirmado nos últimos 30 dias.
          </CardContent>
        </Card>
      </section>

      <div className="mb-6 p-4 rounded-lg border border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-semibold text-foreground">Filtrar lançamentos previstos</Label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="status-filter">Status</Label>
            <Select value={statusFilter} onValueChange={(value: PrevistoStatusFilter) => setStatusFilter(value)}>
              <SelectTrigger id="status-filter" className="border border-border/60 bg-background/80 backdrop-blur">
                <SelectValue placeholder="Selecione um status" />
              </SelectTrigger>
              <SelectContent>
                {statusFilterOptions(tipo).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="competencia">Competência</Label>
            <Input
              id="competencia"
              type="month"
              value={competencia}
              max="2999-12"
              onChange={(event) => {
                if (event.target.value) {
                  setCompetencia(event.target.value);
                }
              }}
              className="border border-border/60 bg-background/80 backdrop-blur"
            />
          </div>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <Card variant="glass" className="border border-border/40">
          <CardContent className="p-0">
            <FullScreenCalendar
              data={calendarData}
              initialMonth={format(parse(competencia + "-01", "yyyy-MM-dd", new Date()), "MMM-yyyy", { locale: ptBR })}
              onAddEvent={handleAddConta}
              onEventClick={(event) => {
                // Buscar fixa_id do previsto original
                const previstoOriginal = previstos?.find((p) => p.id === event.id);
                if (previstoOriginal && (previstoOriginal as any).fixa_id) {
                  handleEditConta((previstoOriginal as any).fixa_id, {
                    vencimento: previstoOriginal.vencimento,
                  });
                }
              }}
              onDayClick={(day) => {
                const dayCompetencia = format(day, "yyyy-MM");
                setCompetencia(dayCompetencia);
                handleCalendarDateSelect(day);
              }}
              onMonthChange={(month) => {
                setCompetencia(month);
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card variant="glass" className="border border-border/40">
          <CardHeader className="flex flex-col gap-1 pb-4">
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              Visão consolidada dos lançamentos {tipo === "saida" ? "a pagar" : "a receber"} com alertas operacionais.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                Carregando previsões...
              </div>
            ) : filteredPrevistos.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-12">
                <p className="text-muted-foreground">{emptyMessage}</p>
                <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-background/80 p-1">
                  <Button
                    variant={viewMode === "table" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("table")}
                    className="gap-2"
                  >
                    <TableIcon className="h-4 w-4" />
                    Tabela
                  </Button>
                  <Button
                    variant={viewMode === "calendar" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("calendar")}
                    className="gap-2"
                  >
                    <CalendarIcon className="h-4 w-4" />
                    Calendário
                  </Button>
                </div>
              </div>
            ) : (
              <Table>
              <TableHeader>
                <TableRow className="bg-foreground/5">
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Descrição
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Vencimento
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Conta
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Grupo
                  </TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70 min-w-[120px]">
                    Valor
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Status
                  </TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPrevistos.map((previsto) => {
                  const statusLabel = statusLabelMap[previsto.status];
                  const badgeClasses = statusBadgeStyles[previsto.status];
                  const isButtonDisabled = previsto.status === "pago" || actionLoadingId === previsto.id;

                  return (
                    <TableRow
                      key={previsto.id}
                      className={cn(
                        "group border-b border-border/40 transition hover:bg-foreground/5",
                        previsto.isOverdue && "bg-destructive/5 hover:bg-destructive/10",
                      )}
                    >
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold tracking-tight">
                            {previsto.historico || previsto.contas_fixas?.descricao || "Sem descrição"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Competência: {previsto.competencia || "-"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col text-sm">
                          <span>{formatDate(previsto.vencimento)}</span>
                          {previsto.isOverdue && (
                            <span className="text-xs font-medium text-destructive">Vencido</span>
                          )}
                          {previsto.isUpcoming && (
                            <span className="text-xs text-amber-500">Vence em breve</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {previsto.contas_bancarias?.descricao || "-"}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {previsto.grupos_contas?.nome || "-"}
                      </TableCell>
                      <TableCell className="align-top font-semibold text-right min-w-[120px] whitespace-nowrap">
                        {formatCurrency(previsto.valor)}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-1">
                          <Badge className={cn("w-fit rounded-full border px-3 py-1 text-xs font-medium", badgeClasses)}>
                            {statusLabel}
                          </Badge>
                          {previsto.status === "pago" && previsto.pago_em && (
                            <span className="text-xs text-muted-foreground">
                              {tipo === "saida" ? "Pago" : "Recebido"} em {formatDate(previsto.pago_em)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          {previsto.status === "pago" ? (
                            <Badge variant="outline" className="gap-1 border-emerald-300/60 bg-emerald-500/10 text-emerald-500">
                              <Check className="h-3.5 w-3.5" />
                              Confirmado
                            </Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isButtonDisabled}
                              onClick={() => handleMarkAsPaid(previsto.id)}
                              className="gap-2"
                            >
                              {actionLoadingId === previsto.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              {actionLabel}
                            </Button>
                          )}
                          {(() => {
                            const previstoOriginal = previstos?.find((p) => p.id === previsto.id);
                            const fixaId = previstoOriginal && (previstoOriginal as any).fixa_id;
                            if (!fixaId) return null;
                            
                            return (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleEditConta(fixaId, { vencimento: previstoOriginal?.vencimento })
                                  }
                                  className="h-8 w-8 p-0"
                                  title="Editar conta fixa"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setContaToDelete(fixaId)}
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                  title="Excluir conta fixa"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            );
                          })()}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        </Card>
      )}

      {/* Dialog de Criação de Conta Fixa */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingContaId 
                ? (tipo === "saida" ? "Editar Conta a Pagar" : "Editar Conta a Receber")
                : (tipo === "saida" ? "Nova Conta a Pagar" : "Nova Conta a Receber")
              }
            </DialogTitle>
            <DialogDescription>
              {editingContaId 
                ? "Edite os dados da conta recorrente"
                : "Configure uma conta recorrente para geração automática de lançamentos"
              }
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="descricao">Descrição *</Label>
                <Input
                  id="descricao"
                  value={formData.descricao}
                  onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                  placeholder="Ex: Aluguel do escritório"
                  required
                />
              </div>

              <div>
                <Label htmlFor="periodicidade">Periodicidade *</Label>
                <Select
                  value={formData.periodicidade}
                  onValueChange={(value) => setFormData({ ...formData, periodicidade: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODICIDADES.map((periodo) => (
                      <SelectItem key={periodo.value} value={periodo.value}>
                        {periodo.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.periodicidade === 'semanal' ? (
                <div>
                  <Label htmlFor="weekday_ref">Dia da Semana *</Label>
                  <Select
                    value={formData.weekday_ref !== undefined ? formData.weekday_ref.toString() : ""}
                    onValueChange={(value) => setFormData({ ...formData, weekday_ref: parseInt(value, 10) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o dia" />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAS_SEMANA.map((dia) => (
                        <SelectItem key={dia.value} value={dia.value.toString()}>
                          {dia.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label htmlFor="dia_ref">Dia do Mês *</Label>
                  <Input
                    id="dia_ref"
                    type="number"
                    min="1"
                    max="31"
                    value={formData.dia_ref}
                    onChange={(e) => setFormData({ ...formData, dia_ref: parseInt(e.target.value, 10) })}
                    required
                  />
                </div>
              )}

              <div>
                <Label htmlFor="valor">Valor *</Label>
                <Input
                  id="valor"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.valor}
                  onChange={(e) => setFormData({ ...formData, valor: parseFloat(e.target.value) || 0 })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="tolerancia_dias">Tolerância (dias)</Label>
                <Input
                  id="tolerancia_dias"
                  type="number"
                  min="0"
                  value={Number.isNaN(formData.tolerancia_dias) ? 0 : formData.tolerancia_dias}
                  onChange={(e) => setFormData({ ...formData, tolerancia_dias: Number(e.target.value) || 0 })}
                />
              </div>

              <div>
                <Label htmlFor="proximo_evento">Próximo Evento *</Label>
                <Input
                  id="proximo_evento"
                  type="date"
                  value={formData.proximo_evento}
                  onChange={(e) => setFormData({ ...formData, proximo_evento: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="grupo_contas_id">Grupo de Contas *</Label>
                <Select
                  value={formData.grupo_contas_id || ""}
                  onValueChange={(value) => setFormData({ ...formData, grupo_contas_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    {gruposContas
                      .filter((grupo) => {
                        // Para entradas, incluir grupos de entrada, escrito_imob e aplic
                        if (tipo === "entrada") {
                          return grupo.natureza === "entrada" || grupo.natureza === "escrito_imob" || grupo.natureza === "aplic";
                        }
                        // Para saídas, apenas grupos de saída
                        return grupo.natureza === tipo;
                      })
                      .map((grupo) => (
                        <SelectItem key={grupo.id} value={grupo.id.toString()}>
                          {grupo.nome} ({grupo.natureza})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="conta_bancaria_id">Conta Bancária *</Label>
                <Select
                  value={formData.conta_bancaria_id || ""}
                  onValueChange={(value) => setFormData({ ...formData, conta_bancaria_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {contasBancarias.map((conta) => (
                      <SelectItem key={conta.id} value={conta.id.toString()}>
                        {conta.descricao} - {conta.bancos?.nome} ({conta.agencia}/{conta.conta})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2">
                <Label htmlFor="observacoes">Observações</Label>
                <Textarea
                  id="observacoes"
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  placeholder="Observações adicionais..."
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createConta.isPending || updateConta.isPending}>
                {(createConta.isPending || updateConta.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Confirmação de Exclusão */}
      <Dialog open={contaToDelete !== null} onOpenChange={(open) => {
        if (!open) setContaToDelete(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta conta fixa? Esta ação não pode ser desfeita e todos os lançamentos previstos relacionados serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setContaToDelete(null)}
              disabled={deleteConta.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => contaToDelete && handleDeleteConta(contaToDelete)}
              disabled={deleteConta.isPending}
            >
              {deleteConta.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                "Excluir"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinanceiroPrevistosBoard;
