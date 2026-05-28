import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isValidUUID, isConflictError } from "@/lib/uuid";
import { 
  Plus, 
  Pencil,
  Trash2, 
  Building2, 
  Search
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { 
  useFornecedores, 
  useCreateFornecedor, 
  useUpdateFornecedor, 
  useDeleteFornecedor
} from "@/hooks/useFornecedores";
import { 
  CreateFornecedor, 
  FornecedorComIndicadores,
  ESTADOS_BRASIL,
  formatCNPJ,
  formatCPF,
  formatCEP,
  formatTelefone
} from "@/types/fornecedores";

export default function Fornecedores() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingFornecedor, setEditingFornecedor] = useState<FornecedorComIndicadores | null>(null);
  const [fornecedorToDelete, setFornecedorToDelete] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [filtroSituacao, setFiltroSituacao] = useState("todos");

  // Hooks
  const { data: fornecedores, isLoading } = useFornecedores();
  
  const createFornecedor = useCreateFornecedor();
  const updateFornecedor = useUpdateFornecedor();
  const deleteFornecedor = useDeleteFornecedor();

  const [formData, setFormData] = useState<CreateFornecedor>({
    nome: "",
    nome_fantasia: "",
    cnpj: "",
    cpf: "",
    inscricao_estadual: "",
    inscricao_municipal: "",
    email: "",
    telefone: "",
    celular: "",
    endereco: "",
    cidade: "",
    estado: "",
    cep: "",
    observacoes: "",
    ativo: true,
    prazo_medio_dias: 30,
    situacao: "ativo",
  });

  useEffect(() => {
    const fetchEmpresaId = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
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
                return;
              }
            }
            
            const { data: newProfile } = await supabase
              .from("profiles")
              .select("empresa_id")
              .eq("id", session.user.id)
              .maybeSingle();
            
            if (newProfile?.empresa_id) {
              const empresaIdValue = ensureUUID(newProfile.empresa_id);
              if (empresaIdValue) {
                setEmpresaId(empresaIdValue);
              }
            }
            return;
          }
          
          if (profile.empresa_id) {
            const empresaIdValue = ensureUUID(profile.empresa_id);
            if (empresaIdValue) {
              setEmpresaId(empresaIdValue);
            }
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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  const resetForm = () => {
    setFormData({
      nome: "",
      nome_fantasia: "",
      cnpj: "",
      cpf: "",
      inscricao_estadual: "",
      inscricao_municipal: "",
      email: "",
      telefone: "",
      celular: "",
      endereco: "",
      cidade: "",
      estado: "",
      cep: "",
      observacoes: "",
      ativo: true,
      prazo_medio_dias: 30,
      situacao: "ativo",
    });
    setEditingFornecedor(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validação básica
    if (!formData.nome || formData.nome.trim() === '') {
      toast.error("Nome/Razão Social é obrigatório");
      return;
    }
    
    try {
      if (editingFornecedor) {
        await updateFornecedor.mutateAsync({
          id: editingFornecedor.id,
          ...formData,
        });
      } else {
        if (!empresaId) {
          toast.error("Erro: Empresa não encontrada. Faça login novamente.");
          return;
        }
        await createFornecedor.mutateAsync({
          ...formData,
          empresa_id: empresaId,
        });
      }
      
      // Só fecha o modal se não houver erro
      setIsDialogOpen(false);
      resetForm();
    } catch (error: any) {
      // O erro já é tratado pelo hook (onError), mas vamos garantir que seja exibido
      const errorMessage = error?.message || error?.error_description || error?.error?.message || "Erro desconhecido ao salvar fornecedor";
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao salvar fornecedor:", error);
      }
      // Não fechar o modal em caso de erro para que o usuário possa corrigir
      // O toast já foi exibido pelo hook onError
    }
  };

  const handleEdit = async (fornecedor: FornecedorComIndicadores) => {
    setEditingFornecedor(fornecedor);
    
    // Buscar dados completos do fornecedor (incluindo observacoes) diretamente do banco
    // Isso garante que temos todos os campos, especialmente observacoes
    try {
      const { data: fornecedorCompleto, error } = await supabase
        .from('fornecedores')
        .select('*')
        .eq('id', fornecedor.id)
        .single();
      
      if (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erro ao buscar fornecedor completo:', error);
        }
        toast.error('Erro ao carregar dados do fornecedor');
        return;
      }
      
      // Extrair dados do endereco JSONB se existir
      let enderecoTexto = "";
      let cidade = "";
      let estado = "";
      let cep = "";
      
      if (fornecedorCompleto.endereco && typeof fornecedorCompleto.endereco === 'object') {
        enderecoTexto = (fornecedorCompleto.endereco as any).texto || "";
        cidade = (fornecedorCompleto.endereco as any).cidade || "";
        estado = (fornecedorCompleto.endereco as any).estado || "";
        cep = (fornecedorCompleto.endereco as any).cep || "";
      }
      
      // IMPORTANTE: Garantir que observacoes seja sempre uma string (mesmo que vazia)
      // Não usar || "" aqui porque pode sobrescrever valores válidos
      const observacoesValue = fornecedorCompleto.observacoes != null 
        ? String(fornecedorCompleto.observacoes) 
        : "";
      
      if (process.env.NODE_ENV === 'development') {
        console.log('Carregando fornecedor para edição:', {
          id: fornecedorCompleto.id,
          observacoes: observacoesValue,
          observacoesOriginal: fornecedorCompleto.observacoes,
          tipoObservacoes: typeof fornecedorCompleto.observacoes
        });
      }
      
      setFormData({
        nome: fornecedorCompleto.razao_social || "",
        nome_fantasia: fornecedorCompleto.nome_fantasia || "",
        cnpj: fornecedorCompleto.cnpj || "",
        cpf: "",
        inscricao_estadual: fornecedorCompleto.inscricao_estadual || "",
        inscricao_municipal: "",
        email: fornecedorCompleto.email || "",
        telefone: fornecedorCompleto.telefone || "",
        celular: "",
        endereco: enderecoTexto,
        cidade: cidade,
        estado: estado,
        cep: cep,
        observacoes: observacoesValue,
        ativo: fornecedorCompleto.status ?? true,
        prazo_medio_dias: fornecedorCompleto.prazo_medio_dias || 30,
        situacao: fornecedorCompleto.situacao || "ativo",
      });
      setIsDialogOpen(true);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao carregar fornecedor:', error);
      }
      toast.error('Erro ao carregar dados do fornecedor');
    }
  };

  const handleDelete = async () => {
    if (!fornecedorToDelete) return;
    
    try {
      await deleteFornecedor.mutateAsync(fornecedorToDelete);
      setIsDeleteDialogOpen(false);
      setFornecedorToDelete(null);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao excluir fornecedor:", error);
      }
    }
  };

  const openDeleteDialog = (id: string) => {
    setFornecedorToDelete(id);
    setIsDeleteDialogOpen(true);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  // Filtros
  const filteredFornecedores = fornecedores?.filter((fornecedor) => {
    const matchesSearch = 
      fornecedor.razao_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fornecedor.nome_fantasia?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fornecedor.cnpj?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesSituacao = filtroSituacao === "todos" || fornecedor.situacao === filtroSituacao;
    
    return matchesSearch && matchesSituacao;
  }) || [];

  // Cálculos para cards
  const totalFornecedores = fornecedores?.length || 0;
  const fornecedoresAtivos = fornecedores?.filter(f => f.status).length || 0;

  const getSituacaoBadge = (situacao: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; color?: string }> = {
      ativo: { variant: "default", label: "Ativo", color: "text-success" },
      em_analise: { variant: "outline", label: "Em Análise", color: "text-warning" },
      bloqueado: { variant: "secondary", label: "Bloqueado", color: "text-muted-foreground" },
      inadimplente: { variant: "destructive", label: "Inadimplente", color: "text-destructive" },
    };
    return variants[situacao] || { variant: "secondary" as const, label: situacao };
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fornecedores</h1>
          <p className="text-muted-foreground">
            Gestão de fornecedores e operações
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} variant="default">
                <Plus className="mr-2 h-4 w-4" />
                Novo Fornecedor
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingFornecedor ? "Editar Fornecedor" : "Novo Fornecedor"}
              </DialogTitle>
              <DialogDescription>
                {editingFornecedor 
                  ? "Atualize as informações do fornecedor" 
                  : "Preencha os dados para criar um novo fornecedor"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label htmlFor="nome">Nome/Razão Social *</Label>
                  <Input
                    id="nome"
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    placeholder="Nome completo ou razão social"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="nome_fantasia">Nome Fantasia</Label>
                  <Input
                    id="nome_fantasia"
                    value={formData.nome_fantasia}
                    onChange={(e) => setFormData({ ...formData, nome_fantasia: e.target.value })}
                    placeholder="Nome fantasia (opcional)"
                  />
                </div>

                <div>
                  <Label htmlFor="cnpj">CNPJ</Label>
                  <Input
                    id="cnpj"
                    value={formData.cnpj}
                    onChange={(e) => setFormData({ ...formData, cnpj: formatCNPJ(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                  />
                </div>

                <div>
                  <Label htmlFor="cpf">CPF</Label>
                  <Input
                    id="cpf"
                    value={formData.cpf || ""}
                    onChange={(e) => setFormData({ ...formData, cpf: formatCPF(e.target.value) })}
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>

                <div>
                  <Label htmlFor="situacao">Situação</Label>
                  <Select
                    value={formData.situacao || "ativo"}
                    onValueChange={(value) => setFormData({ ...formData, situacao: value as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="em_analise">Em Análise</SelectItem>
                      <SelectItem value="bloqueado">Bloqueado</SelectItem>
                      <SelectItem value="inadimplente">Inadimplente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email || ""}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div>
                  <Label htmlFor="telefone">Telefone</Label>
                  <Input
                    id="telefone"
                    value={formData.telefone || ""}
                    onChange={(e) => setFormData({ ...formData, telefone: formatTelefone(e.target.value) })}
                    placeholder="(00) 0000-0000"
                  />
                </div>

                <div>
                  <Label htmlFor="cidade">Cidade</Label>
                  <Input
                    id="cidade"
                    value={formData.cidade || ""}
                    onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                    placeholder="Cidade"
                  />
                </div>

                <div>
                  <Label htmlFor="estado">Estado</Label>
                  <Select
                    value={formData.estado || ""}
                    onValueChange={(value) => setFormData({ ...formData, estado: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o estado" />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADOS_BRASIL.map((estado) => (
                        <SelectItem key={estado.value} value={estado.value}>
                          {estado.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2">
                  <Label htmlFor="observacoes">Observações</Label>
                  <Textarea
                    id="observacoes"
                    value={formData.observacoes ?? ""}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Observações adicionais..."
                    rows={3}
                  />
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <Switch
                    id="ativo"
                    checked={formData.ativo}
                    onCheckedChange={(checked) => setFormData({ ...formData, ativo: checked })}
                  />
                  <Label htmlFor="ativo" className="cursor-pointer">
                    Fornecedor Ativo
                  </Label>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createFornecedor.isPending || updateFornecedor.isPending}>
                  {createFornecedor.isPending || updateFornecedor.isPending ? 'Salvando...' : (editingFornecedor ? 'Atualizar' : 'Criar')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Cards de Indicadores */}
      <div className="grid gap-4 md:grid-cols-1">
        <Card className="animate-slide-up">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Fornecedores</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalFornecedores}</div>
            <p className="text-xs text-muted-foreground">
              {fornecedoresAtivos} ativos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="search">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Buscar por nome ou CNPJ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            
            <div>
              <Label htmlFor="situacao">Situação</Label>
              <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="em_analise">Em Análise</SelectItem>
                  <SelectItem value="bloqueado">Bloqueado</SelectItem>
                  <SelectItem value="inadimplente">Inadimplente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela de Fornecedores */}
      <Card>
        <CardHeader>
          <CardTitle>Fornecedores Cadastrados</CardTitle>
          <CardDescription>
            Visualize e gerencie todos os seus fornecedores
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-muted-foreground">Carregando...</div>
            </div>
          ) : filteredFornecedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-6 mb-4">
                <Building2 className="h-12 w-12 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Nenhum fornecedor cadastrado
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Comece adicionando seu primeiro fornecedor
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Criar Primeiro Fornecedor
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFornecedores.map((fornecedor) => {
                  const situacaoBadge = getSituacaoBadge(fornecedor.situacao);
                  
                  return (
                    <TableRow key={fornecedor.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium">
                        <div>
                          <div>{fornecedor.razao_social}</div>
                          {fornecedor.nome_fantasia && (
                            <div className="text-sm text-muted-foreground">
                              {fornecedor.nome_fantasia}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{fornecedor.cnpj || '-'}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={situacaoBadge.variant}>
                          {situacaoBadge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => handleEdit(fornecedor)}
                            disabled={deleteFornecedor.isPending || updateFornecedor.isPending}
                            aria-label="Editar fornecedor"
                            title="Editar fornecedor"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => openDeleteDialog(fornecedor.id)}
                            disabled={deleteFornecedor.isPending || updateFornecedor.isPending}
                            aria-label="Excluir fornecedor"
                            title="Excluir fornecedor"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      {/* Dialog de Confirmação de Exclusão */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fornecedor</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Confirme se deseja remover o fornecedor selecionado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setFornecedorToDelete(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
