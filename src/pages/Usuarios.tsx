import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { Users, UserPlus, Mail, X, CheckCircle2, Clock } from "lucide-react";

interface Profile {
  id: string;
  email: string;
  nome: string;
  perfil: string;
  is_super_admin: boolean;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  empresa_id: string;
  perfil: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export default function Usuarios() {
  const { isSuperAdmin, loading: loadingSuperAdmin } = useIsSuperAdmin();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePerfil, setInvitePerfil] = useState("Operacional");
  const [empresaId, setEmpresaId] = useState<string>("");

  useEffect(() => {
    if (!loadingSuperAdmin && !isSuperAdmin) {
      return;
    }

    fetchData();
  }, [isSuperAdmin, loadingSuperAdmin]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Buscar perfis de usuários
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      // Buscar convites
      const { data: invitesData, error: invitesError } = await supabase
        .from("invites")
        .select("*")
        .order("created_at", { ascending: false });

      if (invitesError) {
        // Se a tabela não existir ainda, apenas ignorar
        if (process.env.NODE_ENV === 'development') {
          console.error("Erro ao buscar convites:", invitesError);
        }
        setInvites([]);
      } else {
        setInvites(invitesData || []);
      }

      // Buscar empresa_id do usuário atual
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: currentProfile } = await supabase
          .from("profiles")
          .select("empresa_id")
          .eq("id", session.user.id)
          .single();

        if (currentProfile?.empresa_id) {
          setEmpresaId(currentProfile.empresa_id);
        } else {
          // Usar empresa padrão se não tiver empresa_id
          setEmpresaId("00000000-0000-0000-0000-000000000001");
        }
      }
    } catch (error: any) {
      console.error("Erro ao buscar dados:", error);
      toast.error("Erro ao carregar usuários. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail || !inviteEmail.includes("@")) {
      toast.error("Por favor, insira um email válido.");
      return;
    }

    if (!empresaId) {
      toast.error("Erro: empresa_id não encontrado. Entre em contato com o administrador.");
      return;
    }

    try {
      setLoading(true);

      // Verificar se email já está cadastrado
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", inviteEmail)
        .maybeSingle();

      if (existingProfile) {
        toast.error("Este email já está cadastrado.");
        return;
      }

      // Verificar se já existe convite pendente para este email
      const { data: existingInvite } = await supabase
        .from("invites")
        .select("id")
        .eq("email", inviteEmail)
        .eq("status", "pending")
        .maybeSingle();

      if (existingInvite) {
        toast.error("Já existe um convite pendente para este email.");
        return;
      }

      // Obter session do usuário atual
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Sessão expirada. Por favor, faça login novamente.");
        setLoading(false);
        return;
      }

      // Chamar Edge Function para enviar convite automaticamente
      let inviteCreated = false;
      
      try {
        const { data: functionData, error: functionError } = await supabase.functions.invoke('send-invite', {
          body: {
            email: inviteEmail,
            empresa_id: empresaId,
            perfil: invitePerfil,
            invited_by: session.user.id,
          },
        });

        if (functionError) {
          console.error('Edge Function error:', functionError);
          // Fallback: criar link manual se Edge Function falhar
          throw new Error('Edge Function failed, using manual link');
        }

        if (functionData?.error) {
          throw new Error(functionData.error);
        }

        // Sucesso! Email foi enviado automaticamente
        // A Edge Function já cria o registro na tabela invites
        inviteCreated = true;
        toast.success(`Convite enviado com sucesso para ${inviteEmail}! Verifique a caixa de entrada.`);
        
      } catch (functionErr: any) {
        // Fallback: criar link manual se Edge Function não estiver disponível
        console.warn('Edge Function not available, using manual link:', functionErr);
        
        // Criar registro na tabela invites manualmente
        const { error: inviteError } = await supabase
          .from("invites")
          .insert({
            email: inviteEmail,
            empresa_id: empresaId,
            perfil: invitePerfil,
            invited_by: session.user.id,
            status: "pending",
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 dias
          });

        if (inviteError && !inviteError.message.includes('duplicate')) {
          console.warn('Error creating invite record:', inviteError);
        }

        const origin = typeof globalThis !== "undefined" && globalThis.window ? globalThis.window.location.origin : "";
        const inviteLink = `${origin}/accept-invite?email=${encodeURIComponent(inviteEmail)}`;

        toast.success(
          `Convite criado! Envie este link manualmente: ${inviteLink}`,
          { duration: 15000 }
        );

        // Copiar link para clipboard (se possível)
        if (typeof globalThis !== "undefined" && globalThis.navigator?.clipboard) {
          globalThis.navigator.clipboard.writeText(inviteLink).then(() => {
            toast.info("Link copiado para a área de transferência!");
          }).catch(() => {
            // Falha silenciosa se não conseguir copiar
          });
        }
      }

      // Limpar formulário e atualizar dados
      setInviteEmail("");
      setInvitePerfil("Operacional");
      setInviteDialogOpen(false);
      fetchData();
    } catch (error: any) {
      console.error("Erro ao enviar convite:", error);
      toast.error(error.message || "Erro ao enviar convite. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      const { error } = await supabase
        .from("invites")
        .update({ status: "cancelled" })
        .eq("id", inviteId);

      if (error) throw error;

      toast.success("Convite cancelado com sucesso.");
      fetchData();
    } catch (error: any) {
      console.error("Erro ao cancelar convite:", error);
      toast.error("Erro ao cancelar convite. Tente novamente.");
    }
  };

  if (loadingSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Verificando permissões...</p>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Você não tem permissão para acessar esta página.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gerenciamento de Usuários</h1>
          <p className="text-muted-foreground">
            Gerencie usuários e envie convites para novos membros
          </p>
        </div>
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Enviar Convite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar Convite</DialogTitle>
              <DialogDescription>
                Envie um convite por email para um novo usuário se cadastrar no sistema.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="usuario@exemplo.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-perfil">Perfil</Label>
                <Select value={invitePerfil} onValueChange={setInvitePerfil}>
                  <SelectTrigger id="invite-perfil">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Operacional">Operacional</SelectItem>
                    <SelectItem value="Financeiro">Financeiro</SelectItem>
                    <SelectItem value="Admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSendInvite} className="w-full" disabled={loading}>
                {loading ? "Enviando..." : "Enviar Convite"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Usuários Cadastrados
            </CardTitle>
            <CardDescription>Lista de todos os usuários do sistema</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-muted-foreground">Carregando...</div>
            ) : profiles.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                Nenhum usuário cadastrado
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Admin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profiles.map((profile) => (
                      <TableRow key={profile.id}>
                        <TableCell className="min-w-[120px]">{profile.nome}</TableCell>
                        <TableCell className="min-w-[200px] break-all">{profile.email}</TableCell>
                        <TableCell className="min-w-[100px] whitespace-nowrap">{profile.perfil}</TableCell>
                        <TableCell className="min-w-[80px]">
                          {profile.is_super_admin ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Convites Enviados
            </CardTitle>
            <CardDescription>Convites pendentes e aceitos</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-muted-foreground">Carregando...</div>
            ) : invites.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                Nenhum convite enviado
              </div>
            ) : (
              <div className="space-y-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium break-all">{invite.email}</div>
                      <div className="text-sm text-muted-foreground whitespace-nowrap">
                        Perfil: {invite.perfil} • Status: {invite.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {invite.status === "pending" && (
                        <>
                          <Clock className="h-4 w-4 text-yellow-500" />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelInvite(invite.id)}
                          >
                            Cancelar
                          </Button>
                        </>
                      )}
                      {invite.status === "accepted" && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

