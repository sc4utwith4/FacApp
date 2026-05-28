import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Plus, 
  Search, 
  Pencil, 
  Trash2, 
  Eye, 
  EyeOff, 
  Calendar,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Filter,
  Sparkles
} from "lucide-react";
import { cn, parseDateFromDB } from "@/lib/utils";
import { format } from "date-fns";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { 
  useContasFixas, 
  useCreateContaFixa, 
  useUpdateContaFixa, 
  useDeleteContaFixa,
  useGerarPrevistos,
} from "@/hooks/useContasFixas";
import { supabase } from "@/integrations/supabase/client";
import { 
  CreateContaFixa, 
  UpdateContaFixa, 
  PERIODICIDADES, 
  DIAS_SEMANA,
  STATUS_PREVISTO,
  Periodicidade,
} from "@/types/contas-fixas";
import { ensureUUID, isValidUUID, isConflictError } from "@/lib/uuid";
import { Link } from "react-router-dom";

type ContaFixaFormState = {
  descricao: string;
  natureza: "entrada" | "saida";
  grupo_contas_id: string;
  conta_bancaria_id: string;
  periodicidade: Periodicidade;
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

const naturezaLabels: Record<"entrada" | "saida", string> = {
  entrada: "Contas a Receber",
  saida: "Contas a Pagar",
};

const getCompetenciaFromDate = (dateString?: string) => {
  if (dateString && dateString.length >= 7) {
    return dateString.slice(0, 7);
  }
  return new Date().toISOString().slice(0, 7);
};

export default function ContasFixas() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConta, setEditingConta] = useState<any>(null);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [gruposContas, setGruposContas] = useState<any[]>([]);
  const [contasBancarias, setContasBancarias] = useState<any[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  // Hooks
  const { data: contasFixas, isLoading } = useContasFixas();
  const createConta = useCreateContaFixa();
  const updateConta = useUpdateContaFixa();
  const deleteConta = useDeleteContaFixa();
  const gerarPrevistos = useGerarPrevistos();

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
          if (process.env.NODE_ENV === 'development') {
            console.error("Erro ao buscar empresa_id:", error);
          }
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
            // Se o erro for 409 (Conflict), o perfil já existe, então buscar novamente
            if (isConflictError(insertError)) {
              // Perfil já existe, buscar novamente
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
              if (process.env.NODE_ENV === 'development') {
                console.error("Erro ao criar perfil:", insertError);
              }
              toast.error("Erro ao criar perfil. Entre em contato com o administrador.");
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
        if (process.env.NODE_ENV === 'development') {
          console.error("Erro ao buscar empresa_id:", error);
        }
      }
    };
    fetchEmpresaId();
  }, []);

  // Carregar dados iniciais
  useEffect(() => {
    if (!empresaId || !isValidUUID(empresaId)) return;

    const loadData = async () => {
      try {
        // Carregar grupos de contas (filtrado por empresa_id)
        const { data: grupos, error: gruposError } = await supabase
          .from('grupos_contas')
          .select('id, nome, natureza')
          .eq('empresa_id', empresaId)
          .order('nome');
        
        if (gruposError) throw gruposError;
        setGruposContas(grupos || []);

        // Carregar contas bancárias (filtrado por empresa_id)
        const { data: contas, error: contasError } = await supabase
          .from('contas_bancarias')
          .select('id, descricao, agencia, conta, bancos(nome)')
          .eq('empresa_id', empresaId)
          .order('descricao');
        
        if (contasError) throw contasError;
        setContasBancarias(contas || []);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erro ao carregar dados:', error);
        }
        toast.error('Erro ao carregar dados iniciais');
      }
    };

    loadData();
  }, [empresaId]);

  const [formData, setFormData] = useState<ContaFixaFormState>({ ...initialFormState });

  const resetForm = () => {
    setFormData({ ...initialFormState });
    setEditingConta(null);
  };

  const handleAddConta = (natureza: "entrada" | "saida") => {
    setEditingConta(null);
    setFormData({
      ...initialFormState,
      natureza,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.grupo_contas_id || !formData.conta_bancaria_id) {
      toast.error("Selecione um grupo de contas e uma conta bancária");
      return;
    }

    try {
      const payload: CreateContaFixa = {
        ...formData,
      };

    const competencia = getCompetenciaFromDate(payload.proximo_evento);

      if (editingConta) {
        await updateConta.mutateAsync({
          id: editingConta.id,
          ...payload,
        });
      } else {
        await createConta.mutateAsync(payload);
      }

    if (!gerarPrevistos.isPending) {
      await gerarPrevistos
        .mutateAsync({ competencia })
        .catch((gerarError) => {
          if (process.env.NODE_ENV === "development") {
            console.error("Erro ao regenerar previstos após salvar conta fixa:", gerarError);
          }
        });
    }
      
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao salvar conta fixa:", error);
      }
    }
  };

  const handleEdit = (conta: any) => {
    setEditingConta(conta);
    // Garantir que a data seja parseada corretamente do banco
    const parsedDate = conta.proximo_evento ? parseDateFromDB(conta.proximo_evento) : null;
    const formattedDate = parsedDate ? format(parsedDate, "yyyy-MM-dd") : "";
    
    setFormData({
      descricao: conta.descricao,
      natureza: conta.natureza,
      grupo_contas_id: conta.grupo_contas_id || "",
      conta_bancaria_id: conta.conta_bancaria_id || "",
      periodicidade: conta.periodicidade,
      dia_ref: conta.dia_ref,
      weekday_ref: conta.weekday_ref,
      valor: conta.valor,
      ativo: conta.ativo,
      proximo_evento: formattedDate,
      tolerancia_dias: conta.tolerancia_dias,
      observacoes: conta.observacoes || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Deseja realmente excluir esta conta fixa?")) return;
    
    try {
      await deleteConta.mutateAsync(id);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao excluir conta fixa:", error);
      }
    }
  };

  const handleToggleStatus = async (conta: any) => {
    try {
      await updateConta.mutateAsync({
        id: conta.id,
        ativo: !conta.ativo,
      });

      const competencia = getCompetenciaFromDate(conta.proximo_evento);
      if (!gerarPrevistos.isPending) {
        await gerarPrevistos
          .mutateAsync({ competencia })
          .catch((gerarError) => {
            if (process.env.NODE_ENV === "development") {
              console.error("Erro ao regenerar previstos após alterar status:", gerarError);
            }
          });
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao alterar status:", error);
      }
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  // Filtros
  const filteredContas = contasFixas?.filter((conta) => {
    const matchesSearch = conta.descricao.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filtroStatus === "todos" || 
      (filtroStatus === "ativo" && conta.ativo) || 
      (filtroStatus === "inativo" && !conta.ativo);
    const matchesTipo = filtroTipo === "todos" || conta.natureza === filtroTipo;
    
    return matchesSearch && matchesStatus && matchesTipo;
  }) || [];

  // Estatísticas
  const stats = {
    total: contasFixas?.length || 0,
    ativas: contasFixas?.filter(c => c.ativo).length || 0,
    inativas: contasFixas?.filter(c => !c.ativo).length || 0,
    entradas: contasFixas?.filter(c => c.natureza === 'entrada').length || 0,
    saidas: contasFixas?.filter(c => c.natureza === 'saida').length || 0,
    valorTotal: contasFixas?.reduce((acc, c) => acc + c.valor, 0) || 0,
  };

  return (
    <div className="space-y-6">
        <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border/40 bg-card p-6 shadow-subtle lg:p-8">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <Badge variant="secondary" className="w-fit gap-2 border border-primary/30 bg-primary/10 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Automação inteligente
              </Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">
                  Contas Fixas
                </h1>
                <p className="max-w-xl text-sm text-muted-foreground">
                  Centralize contratos recorrentes, configure previsões e mantenha o fluxo de caixa sob controle com alertas proativos.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 lg:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-2 py-1 text-xs text-muted-foreground">
                  <Filter className="h-3.5 w-3.5" />
                  Visualização
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => handleAddConta("saida")}
                >
                  <Plus className="h-4 w-4" />
                  Contas a Pagar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => handleAddConta("entrada")}
                >
                  <Plus className="h-4 w-4" />
                  Contas a Receber
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Cards de Estatísticas */}
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <Card variant="glass">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Total</span>
                <p className="text-2xl font-semibold text-foreground">{stats.total}</p>
              </div>
              <span className="rounded-full bg-primary/15 p-2 text-primary">
                <DollarSign className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{stats.ativas} ativas</span>
              <span>{stats.inativas} inativas</span>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Contas a Receber</span>
                <p className="text-2xl font-semibold text-success">{stats.entradas}</p>
              </div>
              <span className="rounded-full bg-success/15 p-2 text-success">
                <TrendingUp className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Recebimentos recorrentes gerados automaticamente.
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Contas a Pagar</span>
                <p className="text-2xl font-semibold text-destructive">{stats.saidas}</p>
              </div>
              <span className="rounded-full bg-destructive/15 p-2 text-destructive">
                <TrendingDown className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Obrigações recorrentes com geração automática.
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="space-y-2 min-w-0 flex-1">
                <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">Valor Mensal</span>
                <p className="text-lg sm:text-xl font-semibold text-foreground whitespace-nowrap">{formatCurrency(stats.valorTotal)}</p>
              </div>
              <span className="rounded-full bg-primary/15 p-2 text-primary">
                <DollarSign className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Soma prevista para o período vigente
            </CardContent>
          </Card>
        </section>

        {/* Filtros */}
        <Card variant="muted" className="border border-border/50">
          <CardHeader className="flex flex-col gap-1 pb-4">
            <CardTitle>Filtros inteligentes</CardTitle>
            <CardDescription>Combine buscas e status para encontrar contas rapidamente.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="search">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Buscar por descrição..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 border border-border/60 bg-background/80 backdrop-blur transition focus:border-primary/50 focus:ring-primary/30"
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="status">Status</Label>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="border border-border/60 bg-background/80 backdrop-blur">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="ativo">Ativas</SelectItem>
                    <SelectItem value="inativo">Inativas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="tipo">Exibir</Label>
                <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                  <SelectTrigger className="border border-border/60 bg-background/80 backdrop-blur">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="entrada">Somente Contas a Receber</SelectItem>
                    <SelectItem value="saida">Somente Contas a Pagar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
          </CardContent>
        </Card>

        {/* Lista de Contas Fixas */}
        <Card variant="glass" className="border border-border/40">
          <CardHeader className="flex flex-col gap-1 pb-4">
            <CardTitle>Contas Fixas ({filteredContas.length})</CardTitle>
            <CardDescription>Visão consolidada das recorrências com próximos eventos e status operacionais.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-foreground/5">
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Descrição
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Tipo
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Periodicidade
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Valor
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
                    Próximo Evento
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
                {isLoading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredContas.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Nenhuma conta fixa encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredContas.map((conta) => (
                    <TableRow
                      key={conta.id}
                      className="group border-b border-border/40 transition hover:bg-foreground/5"
                    >
                      <TableCell className="align-top font-medium">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold tracking-tight">{conta.descricao}</div>
                          <div className="text-xs text-muted-foreground">
                            {conta.grupos_contas?.nome} • {conta.contas_bancarias?.descricao}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            conta.natureza === "entrada"
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-destructive/40 bg-destructive/10 text-destructive",
                          )}
                        >
                          {naturezaLabels[conta.natureza as "entrada" | "saida"]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="capitalize">{conta.periodicidade}</span>
                        </div>
                        {conta.periodicidade === 'semanal' && conta.weekday_ref !== null && (
                          <div className="text-xs text-muted-foreground">
                            {DIAS_SEMANA.find(d => d.value === conta.weekday_ref)?.label}
                          </div>
                        )}
                        {conta.periodicidade !== 'semanal' && (
                          <div className="text-xs text-muted-foreground">
                            Dia {conta.dia_ref}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold text-right min-w-[120px] whitespace-nowrap">
                        {formatCurrency(conta.valor)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {formatDate(conta.proximo_evento)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            conta.ativo
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-border/60 bg-foreground/5 text-muted-foreground",
                          )}
                        >
                          {conta.ativo ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(conta)}
                            className="rounded-full bg-foreground/5 hover:bg-foreground/10"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleStatus(conta)}
                            className="rounded-full bg-foreground/5 hover:bg-foreground/10"
                          >
                            {conta.ativo ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(conta.id)}
                            className="rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog de Criação/Edição */}
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingConta ? "Editar Conta Fixa" : "Nova Conta Fixa"}
              </DialogTitle>
              <DialogDescription>
                Configure uma conta recorrente para geração automática de lançamentos
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
                  <Label htmlFor="natureza">Aparecer em *</Label>
                  <Select
                    value={formData.natureza}
                    onValueChange={(value: "entrada" | "saida") => setFormData({ ...formData, natureza: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione se gera em Contas a Pagar ou Receber" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="saida">Contas a Pagar</SelectItem>
                      <SelectItem value="entrada">Contas a Receber</SelectItem>
                    </SelectContent>
                  </Select>
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
                    value={formData.weekday_ref?.toString() || ""}
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
                    value={formData.grupo_contas_id || undefined}
                    onValueChange={(value) => setFormData({ ...formData, grupo_contas_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o grupo" />
                    </SelectTrigger>
                    <SelectContent>
                      {gruposContas.map((grupo) => (
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
                    value={formData.conta_bancaria_id || undefined}
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
                  {createConta.isPending || updateConta.isPending ? 'Salvando...' : 'Salvar'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
  );
}
