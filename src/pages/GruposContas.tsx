import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Edit, Trash2, TrendingUp, TrendingDown, CornerDownRight } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ensureUUID, isValidUUID, isConflictError } from "@/lib/uuid";

interface GrupoConta {
  id: string;
  nome: string;
  natureza: string;
  created_at: string;
  grupo_pai_id: string | null;
  subgrupos?: GrupoConta[];
}

export default function GruposContas() {
  const [grupos, setGrupos] = useState<GrupoConta[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState<GrupoConta | null>(null);
  const [grupoToDelete, setGrupoToDelete] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("escrito_imob");
  
  const [formData, setFormData] = useState({
    nome: "",
    grupo_pai_id: "" as string | null,
  });

  useEffect(() => {
    fetchEmpresaId();
  }, []);

  useEffect(() => {
    if (empresaId) {
      fetchGrupos();
    }
  }, [empresaId]);

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
      
      // Se perfil não existe, criar automaticamente
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
        
        // Após criar, buscar novamente
        const { data: newProfile } = await supabase
          .from("profiles")
          .select("empresa_id")
          .eq("id", session.user.id)
          .maybeSingle();
        
        if (newProfile?.empresa_id) {
          const empresaIdValue = ensureUUID(newProfile.empresa_id);
          if (empresaIdValue) {
            setEmpresaId(empresaIdValue);
            return;
          }
        }
        return;
      }
      
      // Se perfil existe, validar empresa_id
      if (profile.empresa_id) {
        const empresaIdValue = ensureUUID(profile.empresa_id);
        if (!empresaIdValue) {
          if (process.env.NODE_ENV === 'development') {
            console.error('empresa_id não é UUID válido:', profile.empresa_id, typeof profile.empresa_id);
          }
          toast.error("Erro: empresa_id inválido no perfil. Contate o administrador.");
          return;
        }
        setEmpresaId(empresaIdValue);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro ao buscar empresa_id:", error);
      }
    }
  };

  const fetchGrupos = async () => {
    if (!empresaId) return;
    
    if (!isValidUUID(empresaId)) {
      if (process.env.NODE_ENV === 'development') {
        console.error('empresaId inválido para grupos:', empresaId, typeof empresaId);
      }
      toast.error("Erro: empresa_id inválido. Recarregue a página.");
      return;
    }
    
    try {
    const { data, error } = await supabase
      .from("grupos_contas")
      .select("*")
        .eq("empresa_id", empresaId)
      .order("nome");
    
    if (error) {
        console.error("Erro ao carregar grupos de contas:", error);
      toast.error("Erro ao carregar grupos de contas");
      return;
    }
    
    // Aplicar organização hierárquica
    const gruposOrganizados = buildHierarchy(data || []);
    setGrupos(gruposOrganizados);
    } catch (error) {
      console.error("Erro ao carregar grupos de contas:", error);
      toast.error("Erro ao carregar grupos de contas");
    }
  };

  // Função para organizar grupos em hierarquia (lista plana com indentação)
  const buildHierarchy = (grupos: GrupoConta[]): GrupoConta[] => {
    // Separar grupos pais (sem grupo_pai_id) e subgrupos
    const gruposPais = grupos.filter(g => !g.grupo_pai_id);
    const subgrupos = grupos.filter(g => g.grupo_pai_id);
    
    // Função recursiva para obter todos os descendentes de um grupo
    const getDescendants = (grupoId: string): string[] => {
      const directChildren = subgrupos.filter(s => s.grupo_pai_id === grupoId).map(s => s.id);
      const allDescendants = [...directChildren];
      directChildren.forEach(childId => {
        allDescendants.push(...getDescendants(childId));
      });
      return allDescendants;
    };
    
    // Ordenar grupos pais e inserir subgrupos logo após seus pais
    const resultado: GrupoConta[] = [];
    
    gruposPais.forEach(pai => {
      resultado.push(pai);
      // Adicionar subgrupos diretos deste pai
      const filhosDiretos = subgrupos.filter(s => s.grupo_pai_id === pai.id);
      filhosDiretos.forEach(filho => {
        resultado.push(filho);
        // Adicionar subgrupos recursivamente
        const adicionarSubgrupos = (grupo: GrupoConta) => {
          const netos = subgrupos.filter(s => s.grupo_pai_id === grupo.id);
          netos.forEach(neto => {
            resultado.push(neto);
            adicionarSubgrupos(neto);
          });
        };
        adicionarSubgrupos(filho);
      });
    });
    
    // Adicionar subgrupos órfãos (caso existam)
    const gruposAdicionados = new Set(resultado.map(g => g.id));
    subgrupos.forEach(subgrupo => {
      if (!gruposAdicionados.has(subgrupo.id)) {
        resultado.push(subgrupo);
      }
    });
    
    return resultado;
  };

  // Função para obter grupos disponíveis como pai (mesma natureza, excluindo o próprio grupo e seus descendentes)
  const getAvailableParentGroups = (grupoAtual?: GrupoConta | null): GrupoConta[] => {
    const getNaturezaByTab = (tab: string): string => {
      if (tab === "escrito_imob") return "escrito_imob";
      if (tab === "aplic") return "aplic";
      return "saida";
    };
    const naturezaAtual = grupoAtual?.natureza || getNaturezaByTab(activeTab);
    const gruposMesmaNatureza = grupos.filter(g => g.natureza === naturezaAtual);
    
    if (!grupoAtual) {
      // Ao criar, retornar apenas grupos pais (sem grupo_pai_id)
      return gruposMesmaNatureza.filter(g => !g.grupo_pai_id);
    }
    
    // Ao editar, excluir o próprio grupo e seus descendentes
    const getDescendants = (grupoId: string): string[] => {
      const directChildren = grupos.filter(g => g.grupo_pai_id === grupoId).map(g => g.id);
      const allDescendants = [...directChildren];
      directChildren.forEach(childId => {
        allDescendants.push(...getDescendants(childId));
      });
      return allDescendants;
    };
    
    const idsParaExcluir = new Set([grupoAtual.id, ...getDescendants(grupoAtual.id)]);
    return gruposMesmaNatureza.filter(g => !idsParaExcluir.has(g.id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaId) {
      toast.error("Empresa não encontrada. Aguarde o carregamento ou faça login novamente.");
      return;
    }

    try {
      // Validar e preparar grupo_pai_id
      let grupoPaiIdValue: string | null = null;
      if (formData.grupo_pai_id && formData.grupo_pai_id !== "") {
        if (!isValidUUID(formData.grupo_pai_id)) {
          toast.error("Grupo pai inválido. Selecione um grupo válido.");
          return;
        }
        grupoPaiIdValue = formData.grupo_pai_id;
      }

      if (editingGrupo) {
        const { error } = await supabase
          .from("grupos_contas")
          .update({
            nome: formData.nome,
            grupo_pai_id: grupoPaiIdValue,
          })
          .eq("id", editingGrupo.id);

        if (error) throw error;
        toast.success("Grupo atualizado com sucesso!");
      } else {
        if (!empresaId) {
          toast.error("Empresa não encontrada. Faça login novamente.");
          return;
        }

        if (!isValidUUID(empresaId)) {
          if (process.env.NODE_ENV === 'development') {
            console.error('empresaId inválido para insert grupo:', empresaId, typeof empresaId);
          }
          toast.error("Erro: empresa_id inválido. Recarregue a página.");
          return;
        }

        const getNaturezaByTab = (tab: string): string => {
          if (tab === "escrito_imob") return "escrito_imob";
          if (tab === "aplic") return "aplic";
          return "saida";
        };

        const natureza = getNaturezaByTab(activeTab);
        
        const { error } = await supabase
          .from("grupos_contas")
          .insert({
            empresa_id: empresaId,
            nome: formData.nome,
            natureza: natureza,
            grupo_pai_id: grupoPaiIdValue,
          });

        if (error) {
          console.error("Erro ao criar grupo:", error);
          console.error("Dados tentados:", {
            empresa_id: empresaId,
            nome: formData.nome,
            natureza: natureza,
            grupo_pai_id: grupoPaiIdValue,
            activeTab: activeTab
          });
          
          // Mensagem de erro mais específica
          if (error.code === '23514') {
            toast.error(`Erro: Natureza "${natureza}" não é permitida. Verifique a configuração do banco de dados.`);
          } else if (error.message.includes('check constraint')) {
            toast.error(`Erro: Valor de natureza "${natureza}" não é válido.`);
          } else {
            toast.error(`Erro ao criar grupo: ${error.message}`);
          }
          throw error;
        }
        toast.success("Grupo criado com sucesso!");
      }

      setIsDialogOpen(false);
      setFormData({ nome: "", grupo_pai_id: null });
      setEditingGrupo(null);
      fetchGrupos();
    } catch (error) {
      console.error("Erro ao salvar grupo:", error);
      toast.error("Erro ao salvar grupo");
    }
  };

  const handleEdit = (grupo: GrupoConta) => {
    setEditingGrupo(grupo);
    setFormData({ 
      nome: grupo.nome,
      grupo_pai_id: grupo.grupo_pai_id || null,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!grupoToDelete) return;

    try {
      // Verificar se há subgrupos
      const { data: subgrupos, error: subgruposError } = await supabase
        .from("grupos_contas")
        .select("id, nome")
        .eq("grupo_pai_id", grupoToDelete);

      if (subgruposError) {
        if (process.env.NODE_ENV === 'development') {
          console.error("Erro ao verificar subgrupos:", subgruposError);
        }
      }

      // Se houver subgrupos, avisar sobre exclusão em cascata
      if (subgrupos && subgrupos.length > 0) {
        const nomesSubgrupos = subgrupos.map(s => s.nome).join(", ");
        if (process.env.NODE_ENV === 'development') {
          console.log(`Excluindo grupo com ${subgrupos.length} subgrupo(s): ${nomesSubgrupos}`);
        }
      }

      const { error } = await supabase
        .from("grupos_contas")
        .delete()
        .eq("id", grupoToDelete);

      if (error) throw error;

      const mensagem = subgrupos && subgrupos.length > 0
        ? `Grupo e ${subgrupos.length} subgrupo(s) excluído(s) com sucesso!`
        : "Grupo excluído com sucesso!";
      toast.success(mensagem);
      fetchGrupos();
    } catch (error) {
      console.error("Erro ao excluir grupo:", error);
      toast.error("Erro ao excluir grupo. Verifique se não há lançamentos associados.");
    } finally {
      setIsDeleteDialogOpen(false);
      setGrupoToDelete(null);
    }
  };

  const openDeleteDialog = (grupoId: string) => {
    setGrupoToDelete(grupoId);
    setIsDeleteDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingGrupo(null);
    setFormData({ nome: "", grupo_pai_id: null });
    setIsDialogOpen(true);
  };

  const gruposEscritoImob = grupos.filter(g => g.natureza === "escrito_imob");
  const gruposAplic = grupos.filter(g => g.natureza === "aplic");
  const gruposDespesa = grupos.filter(g => g.natureza === "saida" || g.natureza === "Despesa");

  // Função auxiliar para obter o nome do grupo pai
  const getGrupoPaiNome = (grupoPaiId: string | null): string | null => {
    if (!grupoPaiId) return null;
    const grupoPai = grupos.find(g => g.id === grupoPaiId);
    return grupoPai?.nome || null;
  };

  const renderGruposTable = (gruposList: GrupoConta[]) => {
    // Reorganizar hierarquia para esta lista específica
    const gruposHierarquicos = buildHierarchy(gruposList);
    
    return (
      <Card className="animate-fade-in">
        <CardContent className="p-0">
          {gruposList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-6 mb-4">
                {activeTab === "despesa" ? (
                  <TrendingDown className="h-12 w-12 text-muted-foreground" />
                ) : (
                  <TrendingUp className="h-12 w-12 text-muted-foreground" />
                )}
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Nenhum grupo de {activeTab === "escrito_imob" ? "Imob" : activeTab === "aplic" ? "Aplic" : "despesa"} cadastrado
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Comece criando seu primeiro grupo de contas
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Criar Primeiro Grupo
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Natureza</TableHead>
                  <TableHead>Grupo Pai</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gruposHierarquicos.map((grupo) => {
                  const isSubgrupo = !!grupo.grupo_pai_id;
                  const grupoPaiNome = getGrupoPaiNome(grupo.grupo_pai_id);
                  
                  return (
                    <TableRow 
                      key={grupo.id} 
                      className={`hover:bg-muted/50 transition-colors ${isSubgrupo ? 'bg-muted/20' : ''}`}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {isSubgrupo && (
                            <CornerDownRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className={isSubgrupo ? 'pl-2' : ''}>{grupo.nome}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={(grupo.natureza === "escrito_imob" || grupo.natureza === "aplic" || grupo.natureza === "entrada" || grupo.natureza === "Receita") ? "default" : "destructive"}>
                          {grupo.natureza === "escrito_imob" ? "Imob" : grupo.natureza === "aplic" ? "Aplic" : grupo.natureza === "entrada" ? "Receita" : grupo.natureza === "saida" ? "Despesa" : grupo.natureza}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {grupoPaiNome ? (
                          <Badge variant="outline" className="text-xs">
                            Subgrupo de: {grupoPaiNome}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(grupo)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(grupo.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Grupos de Contas</h1>
            <p className="text-muted-foreground">
              Gerencie os grupos de Imob, Aplic e Despesas
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Novo Grupo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingGrupo ? "Editar Grupo" : "Novo Grupo de Contas"}
                </DialogTitle>
                <DialogDescription>
                  {editingGrupo 
                    ? "Altere os dados do grupo de contas"
                    : "Crie um novo grupo de contas para organizar Imob, Aplic ou Despesas"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="nome">Nome do Grupo</Label>
                  <Input
                    id="nome"
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    placeholder="Ex: Vendas, Salários, Fornecedores..."
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="grupo_pai">Grupo Pai</Label>
                  <Select
                    value={formData.grupo_pai_id || "__none__"}
                    onValueChange={(value) => setFormData({ ...formData, grupo_pai_id: value === "__none__" ? null : value })}
                  >
                    <SelectTrigger id="grupo_pai">
                      <SelectValue placeholder="Selecione um grupo pai" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Grupo Principal</SelectItem>
                      {getAvailableParentGroups(editingGrupo).map((grupo) => (
                        <SelectItem key={grupo.id} value={grupo.id}>
                          {grupo.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {getAvailableParentGroups(editingGrupo).length === 0 && !editingGrupo && (
                    <div className="mt-2 p-3 border border-dashed rounded-md bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">
                        Nenhum grupo {activeTab === "escrito_imob" ? "de Imob" : activeTab === "aplic" ? "de Aplic" : "de despesa"} disponível para ser grupo pai.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setIsDialogOpen(false);
                          // Abrir modal para criar grupo pai primeiro
                          setTimeout(() => {
                            setFormData({ nome: "", grupo_pai_id: null });
                            setIsDialogOpen(true);
                          }, 100);
                        }}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Criar Grupo Principal Primeiro
                      </Button>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground mt-2">
                    {editingGrupo 
                      ? "Selecione um grupo pai para tornar este grupo um subgrupo. Escolha 'Grupo Principal' para criar um grupo de primeiro nível."
                      : "Opcional: selecione um grupo pai para criar um subgrupo. Deixe como 'Grupo Principal' para criar um grupo de primeiro nível."}
                  </p>
                </div>
                {!editingGrupo && (
                  <div>
                    <Label>Natureza</Label>
                    <div className="flex gap-2 mt-2">
                      <Badge 
                        variant={activeTab === "escrito_imob" ? "default" : "outline"}
                        className="cursor-pointer px-4 py-2"
                      >
                        Imob
                      </Badge>
                      <Badge 
                        variant={activeTab === "aplic" ? "default" : "outline"}
                        className="cursor-pointer px-4 py-2"
                      >
                        Aplic
                      </Badge>
                      <Badge 
                        variant={activeTab === "despesa" ? "destructive" : "outline"}
                        className="cursor-pointer px-4 py-2"
                      >
                        Despesa
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      Tipo selecionado na aba ativa: {activeTab === "escrito_imob" ? "Imob" : activeTab === "aplic" ? "Aplic" : "Despesa"}
                    </p>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit">
                    {editingGrupo ? "Atualizar" : "Criar"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Gerenciar Grupos</CardTitle>
            <CardDescription>
              Organize seus grupos de Imob, Aplic e Despesas em grupos personalizados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="escrito_imob" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Imob ({gruposEscritoImob.length})
                </TabsTrigger>
                <TabsTrigger value="aplic" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Aplic ({gruposAplic.length})
                </TabsTrigger>
                <TabsTrigger value="despesa" className="gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Despesas ({gruposDespesa.length})
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="escrito_imob" className="mt-6">
                {renderGruposTable(gruposEscritoImob)}
              </TabsContent>
              
              <TabsContent value="aplic" className="mt-6">
                {renderGruposTable(gruposAplic)}
              </TabsContent>
              
              <TabsContent value="despesa" className="mt-6">
                {renderGruposTable(gruposDespesa)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir este grupo? Esta ação não pode ser desfeita.
                {grupoToDelete && (() => {
                  const grupo = grupos.find(g => g.id === grupoToDelete);
                  const temSubgrupos = grupos.some(g => g.grupo_pai_id === grupoToDelete);
                  if (temSubgrupos) {
                    return " ATENÇÃO: Este grupo possui subgrupos que serão excluídos em cascata junto com ele.";
                  }
                  return " Grupos com lançamentos associados não podem ser excluídos.";
                })()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}
