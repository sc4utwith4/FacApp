import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import type { TituloCobranca, TituloCobrancaInsert, StatusTitulo } from "@/types/cobranca-bancaria";
import { formatCurrency, normalizeDateForDB } from "@/lib/utils";
import { TituloForm } from "./TituloForm";

export function TitulosList() {
  const navigate = useNavigate();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTitulo, setEditingTitulo] = useState<TituloCobranca | null>(null);
  const [viewingTitulo, setViewingTitulo] = useState<TituloCobranca | null>(null);
  const queryClient = useQueryClient();

  // Query para listar títulos
  const { data: titulos, isLoading } = useQuery<TituloCobranca[]>({
    queryKey: ["cobranca-titulos"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { data, error } = await supabase
        .from("titulos_cobranca")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Mutation para deletar título
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("titulos_cobranca")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulos"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-dashboard"] });
      toast.success("Título excluído com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao excluir título: ${error.message}`);
    },
  });

  const handleEdit = (titulo: TituloCobranca) => {
    setEditingTitulo(titulo);
    setIsDialogOpen(true);
  };

  const handleView = (titulo: TituloCobranca) => {
    navigate(`/financeiro/cobranca-bancaria/titulo/${titulo.id}`);
  };

  const handleDelete = (titulo: TituloCobranca) => {
    if (confirm(`Tem certeza que deseja excluir o título ${titulo.identificador_interno || titulo.nosso_numero}?`)) {
      deleteMutation.mutate(titulo.id);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingTitulo(null);
    setViewingTitulo(null);
  };

  const getStatusBadge = (status: StatusTitulo) => {
    const variants: Record<StatusTitulo, "default" | "secondary" | "destructive" | "outline"> = {
      ABERTO: "default",
      LIQUIDADO: "secondary",
      BAIXADO: "outline",
      DEVOLVIDO: "destructive",
      PROTESTO_INSTRUIDO: "outline",
      EM_CARTORIO: "outline",
      ACORDO_DESCONTO: "secondary",
      DIVERGENCIA: "destructive",
    };

    return <Badge variant={variants[status]}>{status}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Títulos de Cobrança</h2>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Título
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
      ) : titulos && titulos.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identificador</TableHead>
                <TableHead>Sacado</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {titulos.map((titulo) => (
                <TableRow key={titulo.id}>
                  <TableCell className="font-medium">
                    {titulo.identificador_interno || titulo.nosso_numero || "Sem ID"}
                  </TableCell>
                  <TableCell>{titulo.sacado_nome || "-"}</TableCell>
                  <TableCell>
                    {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>{formatCurrency(titulo.valor_nominal)}</TableCell>
                  <TableCell>{getStatusBadge(titulo.status_atual)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleView(titulo)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(titulo)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(titulo)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          Nenhum título cadastrado ainda
        </div>
      )}

      {/* Dialog de criação/edição */}
      <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTitulo ? "Editar Título" : "Novo Título"}
            </DialogTitle>
            <DialogDescription>
              {editingTitulo
                ? "Edite as informações do título de cobrança"
                : "Preencha os dados do novo título de cobrança"}
            </DialogDescription>
          </DialogHeader>
          <TituloForm
            titulo={editingTitulo}
            onSuccess={() => {
              handleCloseDialog();
              queryClient.invalidateQueries({ queryKey: ["cobranca-titulos"] });
              queryClient.invalidateQueries({ queryKey: ["cobranca-dashboard"] });
            }}
            onCancel={handleCloseDialog}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog de visualização */}
      {viewingTitulo && (
        <Dialog open={!!viewingTitulo} onOpenChange={() => setViewingTitulo(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detalhes do Título</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Identificador Interno</Label>
                  <p className="text-sm">{viewingTitulo.identificador_interno || "-"}</p>
                </div>
                <div>
                  <Label>Nosso Número</Label>
                  <p className="text-sm">{viewingTitulo.nosso_numero || "-"}</p>
                </div>
                <div>
                  <Label>Sacado</Label>
                  <p className="text-sm">{viewingTitulo.sacado_nome || "-"}</p>
                </div>
                <div>
                  <Label>Documento</Label>
                  <p className="text-sm">{viewingTitulo.sacado_documento || "-"}</p>
                </div>
                <div>
                  <Label>Valor Nominal</Label>
                  <p className="text-sm font-semibold">
                    {formatCurrency(viewingTitulo.valor_nominal)}
                  </p>
                </div>
                <div>
                  <Label>Vencimento</Label>
                  <p className="text-sm">
                    {new Date(viewingTitulo.vencimento).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div>
                  <Label>Status</Label>
                  <p className="text-sm">{getStatusBadge(viewingTitulo.status_atual)}</p>
                </div>
                <div>
                  <Label>Registrado no Banco</Label>
                  <p className="text-sm">{viewingTitulo.registrado_banco ? "Sim" : "Não"}</p>
                </div>
              </div>
              {viewingTitulo.tags && viewingTitulo.tags.length > 0 && (
                <div>
                  <Label>Tags</Label>
                  <div className="flex gap-2 mt-1">
                    {viewingTitulo.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewingTitulo(null)}>
                Fechar
              </Button>
              <Button onClick={() => {
                setViewingTitulo(null);
                handleEdit(viewingTitulo);
              }}>
                Editar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

