import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [inviteValid, setInviteValid] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nome, setNome] = useState("");

  useEffect(() => {
    const validateInvite = async () => {
      const inviteEmail = searchParams.get("email");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (!inviteEmail) {
        setValidating(false);
        setInviteValid(false);
        return;
      }

      setEmail(inviteEmail);

      // Verificar se existe convite pendente válido para este email
      try {
        const { data: invite, error } = await supabase
          .from("invites")
          .select("id, email, status, expires_at, token")
          .eq("email", inviteEmail)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (error || !invite) {
          setInviteValid(false);
          setValidating(false);
          return;
        }

        // VALIDAÇÃO CRÍTICA: token_hash é obrigatório
        if (!tokenHash || type !== "invite") {
          setInviteValid(false);
          setValidating(false);
          return;
        }

        // Verificar se token corresponde (se houver token no convite)
        if (invite.token && invite.token !== tokenHash) {
          setInviteValid(false);
          setValidating(false);
          return;
        }

        // Verificar token via Supabase Auth
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "invite",
        });

        if (verifyError) {
          setInviteValid(false);
          setValidating(false);
          return;
        }

        setInviteValid(true);
      } catch (error) {
        console.error("Erro ao validar convite:", error);
        setInviteValid(false);
      } finally {
        setValidating(false);
      }
    };

    validateInvite();
  }, [searchParams]);

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validações
      if (!nome || nome.trim().length < 2) {
        toast.error("Por favor, insira seu nome completo.");
        setLoading(false);
        return;
      }

      if (!password || password.length < 8) {
        toast.error("A senha deve ter pelo menos 8 caracteres.");
        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        toast.error("As senhas não coincidem.");
        setLoading(false);
        return;
      }

      // Verificar se já existe usuário com este email
      const { data: existingUser } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (existingUser) {
        toast.error("Este email já está cadastrado. Faça login ou recupere sua senha.");
        navigate("/auth");
        return;
      }

      // Buscar token_hash da URL - OBRIGATÓRIO
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      // VALIDAÇÃO CRÍTICA: token_hash é obrigatório
      if (!tokenHash || type !== "invite") {
        throw new Error("Link de convite inválido. Cadastro apenas via convite. Entre em contato com o administrador.");
      }

      // Revalidar convite ANTES de criar usuário (buscar por email e token)
      const { data: invite, error: inviteError } = await supabase
        .from("invites")
        .select("id, email, status, expires_at, token")
        .eq("email", email)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (inviteError || !invite) {
        throw new Error("Convite não encontrado, expirado ou já utilizado. Solicite um novo convite.");
      }

      // Verificar se token corresponde (se houver token no convite)
      if (invite.token && invite.token !== tokenHash) {
        throw new Error("Token de convite inválido. Use o link recebido por email.");
      }

      let userId: string | null = null;

      // Usar verifyOtp para criar usuário (token_hash é obrigatório)
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as "invite",
      });

      if (verifyError) {
        // Se o erro for relacionado a convite inválido, mostrar mensagem clara
        if (verifyError.message.includes("expired") || verifyError.message.includes("invalid")) {
          throw new Error("Convite expirado ou inválido. Solicite um novo convite.");
        }
        throw verifyError;
      }

      if (!verifyData.user) {
        throw new Error("Erro ao criar usuário. Tente novamente.");
      }

      userId = verifyData.user.id;

      // Definir senha para o usuário
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
        data: {
          nome: nome,
        },
      });

      if (updateError) {
        throw updateError;
      }

      // Atualizar perfil com nome (trigger já criou perfil com empresa_id e perfil corretos)
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({ nome: nome })
        .eq("id", userId);

      if (updateProfileError) {
        console.warn("Erro ao atualizar nome do perfil:", updateProfileError);
      }

      // Marcar convite como aceito usando PK do convite (não apenas email)
      // Isso evita race conditions e garante que apenas um convite seja consumido
      const { error: updateInviteError } = await supabase
        .from("invites")
        .update({ 
          status: "accepted",
          used_at: new Date().toISOString(),
          used_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq("id", invite.id) // Usar PK do convite
        .eq("status", "pending"); // Garantir que ainda está pendente

      if (updateInviteError) {
        console.warn("Erro ao atualizar status do convite:", updateInviteError);
      }

      toast.success("Cadastro realizado com sucesso! Você já pode fazer login.");
      navigate("/auth");
    } catch (error: any) {
      console.error("Erro ao aceitar convite:", error);
      
      let errorMessage = "Erro ao completar cadastro. Tente novamente.";
      
      if (error.message) {
        if (error.message.includes("already registered")) {
          errorMessage = "Este email já está cadastrado. Faça login ou recupere sua senha.";
        } else if (error.message.includes("expired") || error.message.includes("invalid")) {
          errorMessage = "O convite expirou ou é inválido. Solicite um novo convite.";
        } else {
          errorMessage = error.message;
        }
      }
      
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary">
              <Building2 className="h-8 w-8 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold">ASSFAC</CardTitle>
            <CardDescription>Validando convite...</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-center text-muted-foreground">
                Verificando convite...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inviteValid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl font-bold">Convite Inválido</CardTitle>
            <CardDescription>
              O convite não foi encontrado ou já expirou
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              Este convite não existe, já foi utilizado ou expirou.
              Entre em contato com o administrador para receber um novo convite.
            </p>
            <Button onClick={() => navigate("/auth")} className="w-full">
              Voltar para Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary">
            <Building2 className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">ASSFAC</CardTitle>
          <CardDescription>Complete seu cadastro</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAcceptInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome Completo</Label>
              <Input
                id="nome"
                type="text"
                placeholder="Seu nome completo"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Este email foi convidado pelo administrador
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo de 8 caracteres
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar Senha</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando conta...
                </>
              ) : (
                "Completar Cadastro"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}


