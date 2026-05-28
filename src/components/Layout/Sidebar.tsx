import { useEffect, useState } from "react";
import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  DollarSign,
  FileText,
  LogOut,
  Layers,
  CreditCard,
  Calendar,
  Users,
  Building2,
  ChevronRight,
  ChevronDown,
  Bot,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarMenuAction,
} from "@/components/ui/sidebar";

type MenuItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  submenu?: Array<{
    label: string;
    path: string;
  }>;
};

const menuItems: MenuItem[] = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    path: "/",
    submenu: [
      { label: "Dashboard Avançado", path: "/" },
      { label: "Despesas", path: "/financeiro/pagos" },
      { label: "Receitas", path: "/financeiro/recebidos" },
    ],
  },
  {
    icon: DollarSign,
    label: "Financeiro",
    path: "/financeiro",
    submenu: [
      { label: "Lançamentos", path: "/financeiro/lancamentos" },
      { label: "Operações", path: "/operacoes" },
      { label: "Operações com IA", path: "/operacoes/ia" },
      { label: "Contas a Pagar", path: "/financeiro/contas-a-pagar" },
      { label: "Contas a Receber", path: "/financeiro/contas-a-receber" },
      { label: "Conciliação Bancária", path: "/financeiro/conciliacao-bancaria" },
      { label: "Controle de Cobrança", path: "/financeiro/cobranca-bancaria" },
      { label: "Relatórios Banco", path: "/financeiro/cobranca-bancaria/relatorios-banco" },
    ],
  },
  { icon: Layers, label: "Grupos de Contas", path: "/grupos-contas" },
  { icon: CreditCard, label: "Contas e Estoque", path: "/contas-estoque" },
  { icon: Building2, label: "Fornecedores", path: "/fornecedores" },
  { icon: Bot, label: "Assfac IA", path: "/ai-copilot" },
];

// Item de menu apenas para super admin
const adminMenuItems: { icon: typeof Users; label: string; path: string }[] = [];

export function Sidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const { isSuperAdmin, loading: loadingSuperAdmin } = useIsSuperAdmin();
  const [openSubmenus, setOpenSubmenus] = useState<string[]>([]);
  const [closedSubmenus, setClosedSubmenus] = useState<string[]>([]);

  useEffect(() => {
    menuItems.forEach((item) => {
      if (!item.submenu) return;
      const hasActiveChild = item.submenu.some((subItem) => pathname.startsWith(subItem.path));
      if (hasActiveChild && !closedSubmenus.includes(item.path)) {
        setOpenSubmenus((prev) => (prev.includes(item.path) ? prev : [...prev, item.path]));
      }
    });
  }, [pathname, closedSubmenus]);

  const toggleSubmenu = (path: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setOpenSubmenus((prev) => {
      const isCurrentlyOpen = prev.includes(path);
      if (isCurrentlyOpen) {
        // Fechando: remover de openSubmenus e adicionar a closedSubmenus
        setClosedSubmenus((closed) => [...closed.filter((p) => p !== path), path]);
        return prev.filter((item) => item !== path);
      } else {
        // Abrindo: adicionar a openSubmenus e remover de closedSubmenus
        setClosedSubmenus((closed) => closed.filter((p) => p !== path));
        return [...prev, path];
      }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <>
      <SidebarHeader>
        <div className="flex flex-col items-center text-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.35em] text-sidebar-foreground/70">Plataforma</span>
          <span className="text-4xl font-bold tracking-[0.15em] text-primary font-scarface leading-tight">ASSFAC</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const submenuItems = item.submenu ?? [];
                const hasSubmenu = submenuItems.length > 0;
                const hasActiveChild = submenuItems.some((subItem) => pathname.startsWith(subItem.path));
                const isActive = hasSubmenu ? hasActiveChild : pathname === item.path;
                const isExplicitlyClosed = closedSubmenus.includes(item.path);
                const isSubmenuOpen = hasSubmenu && !isExplicitlyClosed && (openSubmenus.includes(item.path) || hasActiveChild);
                const isRelatorios = item.path === "/relatorios";

                return (
                  <React.Fragment key={item.path}>
                    <SidebarMenuItem>
                      {hasSubmenu ? (
                        <>
                          <SidebarMenuButton
                            isActive={isActive}
                            data-state={isSubmenuOpen ? "open" : "closed"}
                            onClick={(e) => {
                              toggleSubmenu(item.path, e);
                            }}
                            className="cursor-pointer"
                            style={{ pointerEvents: 'auto' }}
                            type="button"
                          >
                            <Icon className="text-primary" />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                          <SidebarMenuAction
                            type="button"
                            onClick={(e) => {
                              toggleSubmenu(item.path, e);
                            }}
                            aria-label={isSubmenuOpen ? "Fechar submenu" : "Abrir submenu"}
                            aria-expanded={isSubmenuOpen}
                            className="cursor-pointer z-10"
                            style={{ pointerEvents: 'auto' }}
                          >
                            {isSubmenuOpen ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </SidebarMenuAction>
                        </>
                      ) : (
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                      >
                        <Link to={item.path}>
                          <Icon className="text-primary" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      )}
                      {hasSubmenu && isSubmenuOpen && (
                        <SidebarMenuSub>
                          {submenuItems.map((subItem) => {
                            const isSubActive = pathname.startsWith(subItem.path);
                            return (
                              <SidebarMenuSubItem key={subItem.path}>
                                <SidebarMenuSubButton asChild isActive={isSubActive}>
                                  <Link to={subItem.path}>{subItem.label}</Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                    {/* Renderizar menu admin logo após "Relatórios Avançados" */}
                    {isRelatorios && !loadingSuperAdmin && isSuperAdmin && adminMenuItems.map((adminItem) => {
                      const AdminIcon = adminItem.icon;
                      const isAdminActive = pathname === adminItem.path;

                      return (
                        <SidebarMenuItem key={adminItem.path}>
                          <SidebarMenuButton
                            asChild
                            isActive={isAdminActive}
                            tooltip={adminItem.label}
                          >
                            <Link to={adminItem.path}>
                              <AdminIcon className="text-primary" />
                              <span>{adminItem.label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="Sair">
              <LogOut className="text-primary" />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
