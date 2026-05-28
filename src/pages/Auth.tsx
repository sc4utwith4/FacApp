import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    // Verificar se já está autenticado
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/");
      }
    };
    checkSession();

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        navigate("/");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validações básicas
      if (!email || !email.includes('@')) {
        toast.error("Por favor, insira um email válido.");
        setLoading(false);
        return;
      }

      if (!password) {
        toast.error("Por favor, insira sua senha.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        toast.success("Login realizado com sucesso!");
        navigate("/");
      }
    } catch (error: any) {
      // Log detalhado do erro para diagnóstico
      if (process.env.NODE_ENV === 'development') {
        console.error("Erro no login:", error);
        console.error("Detalhes do erro:", {
          message: error.message,
          status: error.status,
          name: error.name,
          stack: error.stack,
        });
      }
      
      // Mensagens de erro mais específicas
      let errorMessage = "Erro ao fazer login. Verifique suas credenciais.";
      
      // Tratar erro 422 especificamente
      if (error.status === 422 || error.message?.includes("422")) {
        errorMessage = "Erro ao fazer login. Verifique se suas credenciais estão corretas ou se o email signups está habilitado. Se o problema persistir, entre em contato com o administrador.";
      } else if (error.status === 400 || error.message?.includes("400")) {
        errorMessage = "Erro ao fazer login. Verifique se suas credenciais estão corretas ou se o usuário existe. Se o problema persistir, entre em contato com o administrador.";
      } else if (error.message) {
        if (error.message.includes("Invalid login credentials")) {
          errorMessage = "Email ou senha incorretos. Verifique suas credenciais.";
        } else if (error.message.includes("Email not confirmed")) {
          errorMessage = "Por favor, confirme seu email antes de fazer login. Verifique sua caixa de entrada.";
        } else if (error.message.includes("Too many requests")) {
          errorMessage = "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
        } else if (error.message.includes("Invalid Refresh Token") || error.message.includes("Refresh Token Not Found")) {
          errorMessage = "Sua sessão local expirou e foi limpa. Faça login novamente.";
        } else if (error.message.includes("token") || error.message.includes("JWT") || error.message.includes("expired")) {
          errorMessage = "Erro de autenticação. Faça login novamente. Se persistir, limpe o cache do navegador e tente de novo.";
        } else {
          errorMessage = error.message;
        }
      }
      
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };


  return (
    <section className="bg-muted bg-background h-screen">
      <div className="flex h-full items-center justify-center p-4">
        <div className="border-muted bg-background flex w-full max-w-sm flex-col items-center gap-y-8 rounded-md border px-6 py-12 shadow-md">
          <div className="flex flex-col items-center gap-y-2">
            {/* Logo - mesma da sidebar */}
            <div className="flex flex-col items-center text-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground/70">Plataforma</span>
              <span className="text-4xl font-bold tracking-[0.15em] text-primary font-scarface leading-tight">ASSFAC</span>
            </div>
          </div>

          <form onSubmit={handleLogin} className="flex w-full flex-col gap-8">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                  <Input
                    type="email"
                  placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  disabled={loading}
                  />
                </div>
              <div className="flex flex-col gap-2">
                  <Input
                    type="password"
                  placeholder="Senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  disabled={loading}
                  />
                </div>
              <div className="flex flex-col gap-4">
                <Button type="submit" className="mt-2 w-full" disabled={loading}>
                    {loading ? "Entrando..." : "Entrar"}
                  </Button>
              </div>
                  </div>
          </form>

          <div className="text-muted-foreground flex flex-col items-center gap-2 text-sm text-center">
            <p>Cadastro é apenas via convite do administrador.</p>
            <p>Entre em contato com o administrador para receber um convite.</p>
          </div>
        </div>
    </div>
    </section>
  );
}
