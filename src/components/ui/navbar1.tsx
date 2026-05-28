import { Book, Menu, Sunset, Trees, Zap, User, LogOut } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MenuItem, Navbar1Props } from "./navbar1.types";

const DEFAULT_LOGO = {
  url: "/",
  src: "/assfac-simbolo-dolar-white-64x64.png",
  alt: "ASSFAC",
  title: "ASSFAC",
} as const;

const DEFAULT_AUTH = {
  login: { text: "Entrar", url: "/auth" },
  signup: { text: "Cadastrar", url: "/auth" },
} as const;

const Navbar1 = ({
  logo = DEFAULT_LOGO,
  menu = [],
  mobileExtraLinks = [],
  auth,
}: Navbar1Props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [userName, setUserName] = useState<string>("Usuário");
  const [userEmail, setUserEmail] = useState<string>("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setIsAuthenticated(true);
          setUserName(session.user.email?.split("@")[0] || "Usuário");
          setUserEmail(session.user.email || "");
        } else {
          setIsAuthenticated(false);
          setUserName("Usuário");
          setUserEmail("");
        }
      } catch (error) {
        console.error("Erro ao carregar perfil do usuário:", error);
        setIsAuthenticated(false);
      }
    };

    loadUserProfile();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setIsAuthenticated(true);
        setUserName(session.user.email?.split("@")[0] || "Usuário");
        setUserEmail(session.user.email || "");
      } else {
        setIsAuthenticated(false);
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

  const authConfig = auth || DEFAULT_AUTH;

  const renderMenuItem = useCallback((item: MenuItem, currentPath: string) => {
    const isActive = currentPath === item.url || currentPath.startsWith(item.url + "/");

    if (item.items) {
      return (
        <NavigationMenuItem key={item.title}>
          <NavigationMenuTrigger
            className={cn(
              "h-9 rounded-lg px-3.5 text-sm font-medium transition-all duration-200",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground"
            )}
          >
            {item.title}
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="w-80 p-3">
              {item.items.map((subItem) => (
                <li key={subItem.title}>
                  <Link
                    className="flex select-none gap-4 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                    to={subItem.url}
                  >
                    {subItem.icon}
                    <div>
                      <div className="text-sm font-semibold text-text">
                        {subItem.title}
                      </div>
                      {subItem.description && (
                        <p className="text-sm leading-snug text-muted-foreground">
                          {subItem.description}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      );
    }

    return (
      <Link
        key={item.title}
        to={item.url}
        className={cn(
          "group inline-flex h-9 w-max items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap",
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground"
        )}
      >
        {item.title}
      </Link>
    );
  }, []);

  const renderMobileMenuItem = useCallback((item: MenuItem, currentPath: string) => {
    const isActive = currentPath === item.url || currentPath.startsWith(item.url + "/");

    if (item.items) {
      return (
        <AccordionItem key={item.title} value={item.title} className="border-b-0">
          <AccordionTrigger className={cn("py-0 font-semibold hover:no-underline whitespace-nowrap", isActive && "text-text")}>
            {item.title}
          </AccordionTrigger>
          <AccordionContent className="mt-2">
            {item.items.map((subItem) => (
              <Link
                key={subItem.title}
                to={subItem.url}
                className="flex select-none gap-4 rounded-md p-3 leading-none outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {subItem.icon}
                <div>
                  <div className="text-sm font-semibold text-text">{subItem.title}</div>
                  {subItem.description && (
                    <p className="text-sm leading-snug text-muted-foreground">
                      {subItem.description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </AccordionContent>
        </AccordionItem>
      );
    }

    return (
      <Link 
        key={item.title} 
        to={item.url} 
        className={cn("font-semibold py-2 whitespace-nowrap", isActive && "text-text")}
      >
        {item.title}
      </Link>
    );
  }, []);

  return (
    <section className="py-3 sm:py-4 border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="hidden lg:flex items-center justify-between gap-8">
          <div className="flex-shrink-0 w-32">
            <Link to={logo.url} className="flex items-center gap-2 group/logo">
              <span className="text-lg sm:text-xl font-semibold text-text font-scarface whitespace-nowrap tracking-[0.05em] leading-tight group-hover/logo:opacity-90 transition-opacity">
                {logo.title}
              </span>
            </Link>
          </div>
          <div className="flex-1 flex justify-center min-w-0">
            <NavigationMenu>
              <NavigationMenuList className="flex items-center justify-center gap-1 flex-wrap">
                {menu.map((item) => renderMenuItem(item, location.pathname))}
              </NavigationMenuList>
            </NavigationMenu>
          </div>
          <div className="flex-shrink-0 w-32 flex justify-end">
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center justify-center rounded-full p-1 ring-1 ring-border/40 hover:ring-primary/30 hover:bg-accent/50 transition-all duration-200">
                    <Avatar className="h-8 w-8 sm:h-9 sm:w-9">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {userName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none text-text whitespace-nowrap">{userName}</p>
                      {userEmail && (
                        <p className="text-xs leading-none text-muted-foreground break-all">{userEmail}</p>
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
                    <LogOut className="mr-2 h-4 w-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link to={authConfig.login.url}>{authConfig.login.text}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to={authConfig.signup.url}>{authConfig.signup.text}</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
        <div className="block lg:hidden">
          <div className="flex items-center justify-between gap-4 py-1">
            <Link to={logo.url} className="flex items-center gap-2 flex-shrink-0">
              <span className="text-lg sm:text-xl font-semibold text-text font-scarface whitespace-nowrap leading-tight">{logo.title}</span>
            </Link>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                className="overflow-y-auto"
                description="Acesse as áreas disponíveis da plataforma pelo menu mobile."
              >
                <SheetHeader>
                  <SheetTitle>
                    <Link to={logo.url} className="flex items-center gap-2">
                      <span className="text-xl font-semibold text-text font-scarface whitespace-nowrap leading-tight">
                        {logo.title}
                      </span>
                    </Link>
                  </SheetTitle>
                </SheetHeader>
                <div className="my-6 flex flex-col gap-6">
                  <Accordion
                    type="single"
                    collapsible
                    className="flex w-full flex-col gap-4"
                  >
                    {menu.map((item) => renderMobileMenuItem(item, location.pathname))}
                  </Accordion>
                  {mobileExtraLinks.length > 0 && (
                    <div className="border-t border-border pt-4">
                      <div className="grid grid-cols-2 justify-start">
                        {mobileExtraLinks.map((link, idx) => (
                          <Link
                            key={idx}
                            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            to={link.url}
                          >
                            {link.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    {isAuthenticated ? (
                      <>
                        <div className="flex items-center gap-2 px-4 py-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary text-primary-foreground">
                              {userName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <p className="text-sm font-medium text-text whitespace-nowrap">{userName}</p>
                            {userEmail && (
                              <p className="text-xs text-muted-foreground break-all">{userEmail}</p>
                            )}
                          </div>
                        </div>
                        <Button asChild variant="outline">
                          <Link to="/perfil">
                            <User className="mr-2 h-4 w-4" />
                            Perfil
                          </Link>
                        </Button>
                        <Button onClick={handleLogout} variant="destructive">
                          <LogOut className="mr-2 h-4 w-4" />
                          Sair
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button asChild variant="outline">
                          <Link to={authConfig.login.url}>{authConfig.login.text}</Link>
                        </Button>
                        <Button asChild>
                          <Link to={authConfig.signup.url}>{authConfig.signup.text}</Link>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </section>
  );
};

export { Navbar1 };
