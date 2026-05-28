import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { CheckCircle2, XCircle, Filter, Search, Eye } from "lucide-react";
import { toast } from "sonner";
import type { FilaOcorrencia } from "@/types/cobranca-bancaria";
import { formatCurrency, normalizeDateForDB } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

export default function FilaOcorrencias() {
  const [filters, setFilters] = useState({
    resolvido: "pendentes" as "todos" | "pendentes" | "resolvidos",
    status_motivo: "todos",
    search: "",
  });
  const [viewingOcorrencia, setViewingOcorrencia] = useState<FilaOcorrencia | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Query para listar ocorrências
  const { data: ocorrencias, isLoading } = useQuery<FilaOcorrencia[]>({
    queryKey: ["cobranca-fila-ocorrencias", filters],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      let query = supabase
        .from("fila_ocorrencias")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .order("data_ocorrencia", { ascending: false })
        .order("created_at", { ascending: false });

      if (filters.resolvido === "pendentes") {
        query = query.eq("resolvido", false);
      } else if (filters.resolvido === "resolvidos") {
        query = query.eq("resolvido", true);
      }

      if (filters.status_motivo !== "todos") {
        query = query.eq("status_motivo", filters.status_motivo);
      }

      if (filters.search) {
        query = query.or(
          `identificador.ilike.%${filters.search}%,acao.ilike.%${filters.search}%,observacoes.ilike.%${filters.search}%`
        );
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
  });

  // Mutation para resolver ocorrência
  const resolveMutation = useMutation({
    mutationFn: async (ocorrenciaId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { error } = await supabase
        .from("fila_ocorrencias")
        .update({
          resolvido: true,
          resolvido_por: user.id,
          resolvido_em: new Date().toISOString(),
        })
        .eq("id", ocorrenciaId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-fila-ocorrencias"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-ocorrencias-pendentes"] });
      toast.success("Ocorrência resolvida com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao resolver ocorrência: ${error.message}`);
    },
  });

  // Mutation para criar ocorrência
  const createMutation = useMutation({
    mutationFn: async (data: Partial<FilaOcorrencia>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const { error } = await supabase.from("fila_ocorrencias").insert({
        ...data,
        empresa_id: profile.empresa_id,
        data_ocorrencia: normalizeDateForDB(data.data_ocorrencia || new Date().toISOString().split("T")[0]),
        resolvido: false,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-fila-ocorrencias"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-ocorrencias-pendentes"] });
      toast.success("Ocorrência criada com sucesso");
    },
    onError: (error) => {
      toast.error(`Erro ao criar ocorrência: ${error.message}`);
    },
  });

  const statusMotivos = [
    "BAIXADO-bc",
    "PROTESDADO",
    "duplicidade",
    "irregularidade",
    "cobrar as custas",
    "desconto concedido",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fila de Ocorrências</h1>
        <p className="text-muted-foreground">
          Gerencie ocorrências e exceções que requerem atenção manual
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={filters.resolvido}
                onValueChange={(value) =>
                  setFilters({ ...filters, resolvido: value as any })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendentes">Pendentes</SelectItem>
                  <SelectItem value="resolvidos">Resolvidos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status/Motivo</Label>
              <Select
                value={filters.status_motivo}
                onValueChange={(value) =>
                  setFilters({ ...filters, status_motivo: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {statusMotivos.map((motivo) => (
                    <SelectItem key={motivo} value={motivo}>
                      {motivo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por identificador, ação ou observações..."
                  value={filters.search}
                  onChange={(e) =>
                    setFilters({ ...filters, search: e.target.value })
                  }
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Ocorrências */}
      <Card>
        <CardHeader>
          <CardTitle>
            Ocorrências ({ocorrencias?.length || 0})
          </CardTitle>
          <CardDescription>
            {filters.resolvido === "pendentes" && "Apenas pendentes"}
            {filters.resolvido === "resolvidos" && "Apenas resolvidas"}
            {filters.resolvido === "todos" && "Todas as ocorrências"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : ocorrencias && ocorrencias.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Identificador</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Status/Motivo</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ocorrencias.map((ocorrencia) => (
                    <TableRow key={ocorrencia.id}>
                      <TableCell>
                        {new Date(ocorrencia.data_ocorrencia).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="font-medium">
                        {ocorrencia.identificador || "-"}
                      </TableCell>
                      <TableCell>{ocorrencia.acao || "-"}</TableCell>
                      <TableCell>
                        {ocorrencia.status_motivo ? (
                          <Badge variant="outline">{ocorrencia.status_motivo}</Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {ocorrencia.valor ? formatCurrency(ocorrencia.valor) : "-"}
                      </TableCell>
                      <TableCell>
                        {ocorrencia.tags && ocorrencia.tags.length > 0 ? (
                          <div className="flex gap-1">
                            {ocorrencia.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                            {ocorrencia.tags.length > 2 && (
                              <Badge variant="secondary" className="text-xs">
                                +{ocorrencia.tags.length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {ocorrencia.resolvido ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Resolvido
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setViewingOcorrencia(ocorrencia)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!ocorrencia.resolvido && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resolveMutation.mutate(ocorrencia.id)}
                              disabled={resolveMutation.isPending}
                            >
                              Resolver
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma ocorrência encontrada
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de visualização */}
      {viewingOcorrencia && (
        <Dialog open={!!viewingOcorrencia} onOpenChange={() => setViewingOcorrencia(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detalhes da Ocorrência</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Data</Label>
                  <p className="text-sm">
                    {new Date(viewingOcorrencia.data_ocorrencia).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div>
                  <Label>Identificador</Label>
                  <p className="text-sm">{viewingOcorrencia.identificador || "-"}</p>
                </div>
                <div>
                  <Label>Ação</Label>
                  <p className="text-sm">{viewingOcorrencia.acao || "-"}</p>
                </div>
                <div>
                  <Label>Status/Motivo</Label>
                  <p className="text-sm">{viewingOcorrencia.status_motivo || "-"}</p>
                </div>
                <div>
                  <Label>Valor</Label>
                  <p className="text-sm font-semibold">
                    {viewingOcorrencia.valor ? formatCurrency(viewingOcorrencia.valor) : "-"}
                  </p>
                </div>
                <div>
                  <Label>Status</Label>
                  <p className="text-sm">
                    {viewingOcorrencia.resolvido ? (
                      <Badge variant="secondary">Resolvido</Badge>
                    ) : (
                      <Badge variant="destructive">Pendente</Badge>
                    )}
                  </p>
                </div>
              </div>
              {viewingOcorrencia.observacoes && (
                <div>
                  <Label>Observações</Label>
                  <p className="text-sm whitespace-pre-wrap">{viewingOcorrencia.observacoes}</p>
                </div>
              )}
              {viewingOcorrencia.tags && viewingOcorrencia.tags.length > 0 && (
                <div>
                  <Label>Tags</Label>
                  <div className="flex gap-2 mt-1">
                    {viewingOcorrencia.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewingOcorrencia(null)}>
                Fechar
              </Button>
              {!viewingOcorrencia.resolvido && (
                <Button
                  onClick={() => {
                    resolveMutation.mutate(viewingOcorrencia.id);
                    setViewingOcorrencia(null);
                  }}
                  disabled={resolveMutation.isPending}
                >
                  Resolver
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

