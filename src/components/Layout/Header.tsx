import { Bell, User, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useSidebar } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface HeaderProps {
  readonly actions?: React.ReactNode;
}

export function Header({ actions }: HeaderProps) {
  const navigate = useNavigate();
  const [userName, setUserName] = useState<string>("Usuário");
  const [userEmail, setUserEmail] = useState<string>("");

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        // Buscar sessão atual
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          // Usar apenas email do auth, sem query ao Supabase
            setUserName(session.user.email?.split("@")[0] || "Usuário");
            setUserEmail(session.user.email || "");
        }
      } catch (error) {
        console.error("Erro ao carregar perfil do usuário:", error);
      }
    };

    loadUserProfile();

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // Usar apenas email do auth
        setUserName(session.user.email?.split("@")[0] || "Usuário");
        setUserEmail(session.user.email || "");
      } else {
        setUserName("Usuário");
        setUserEmail("");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const { toggleSidebar } = useSidebar();

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={cn(
      "sticky top-0 z-50 w-full border-b transition-all",
      scrolled 
        ? "bg-background/95 supports-[backdrop-filter]:bg-background/50 border-border backdrop-blur-lg"
        : "border-transparent"
    )}>
      <nav className="mx-auto flex h-16 sm:h-20 md:h-24 w-full max-w-[1920px] items-center justify-between px-3 sm:px-4 md:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md text-primary transition-colors hover:bg-accent",
              "hidden md:flex"
            )}
            aria-label="Toggle Sidebar"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] uppercase tracking-[0.4em] text-muted-foreground/70">Painel de Controle</span>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Sistema Financeiro
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {actions}
          
          <Button variant="ghost" size="icon" className="relative rounded-full bg-foreground/5 hover:bg-foreground/10">
            <Bell className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 rounded-full bg-foreground/5 px-2 py-1 hover:bg-foreground/10">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {userName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden md:inline-block">{userName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{userName}</p>
                  {userEmail && (
                    <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/perfil")}>
                <User className="mr-2 h-4 w-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </header>
  );
}
