import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Building2, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function AuthConfirm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const confirmEmail = async () => {
      const token_hash = searchParams.get("token_hash");
      const type = searchParams.get("type") as "email" | "recovery" | "invite" | "magiclink" | null;

      if (!token_hash || !type) {
        setStatus("error");
        setErrorMessage("Link de confirmação inválido ou incompleto.");
        return;
      }

      try {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type,
        });

        if (error) {
          throw error;
        }

        setStatus("success");
        toast.success("Email confirmado com sucesso!");

        // Redirecionar para login após 2 segundos
        setTimeout(() => {
          navigate("/auth");
        }, 2000);
      } catch (error: any) {
        console.error("Erro ao confirmar email:", error);
        setStatus("error");
        
        let message = "Erro ao confirmar email. ";
        if (error.message) {
          if (error.message.includes("expired") || error.message.includes("invalid")) {
            message += "O link expirou ou é inválido. Solicite um novo link de confirmação.";
          } else {
            message += error.message;
          }
        } else {
          message += "Tente novamente ou solicite um novo link.";
        }
        
        setErrorMessage(message);
        toast.error(message);
      }
    };

    confirmEmail();
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary">
            <Building2 className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">ASSFAC</CardTitle>
          <CardDescription>Confirmando seu email</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-center text-muted-foreground">
                Confirmando seu email...
              </p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-center text-lg font-semibold text-green-700 dark:text-green-400">
                Email confirmado com sucesso!
              </p>
              <p className="text-center text-sm text-muted-foreground">
                Você será redirecionado para a página de login em instantes...
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <XCircle className="h-12 w-12 text-red-500" />
              <p className="text-center text-lg font-semibold text-red-700 dark:text-red-400">
                Erro ao confirmar email
              </p>
              <p className="text-center text-sm text-muted-foreground">
                {errorMessage}
              </p>
              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => navigate("/auth")}
                  className="w-full"
                >
                  Voltar para Login
                </Button>
                <Button
                  onClick={() => {
                    const email = searchParams.get("email");
                    if (email) {
                      navigate(`/auth?email=${encodeURIComponent(email)}&resend=true`);
                    } else {
                      navigate("/auth");
                    }
                  }}
                  className="w-full"
                >
                  Solicitar Novo Link
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

