import { useMemo } from "react";
import {
  LayoutDashboard,
  DollarSign,
  Layers,
  CreditCard,
  Building2,
  Warehouse,
  FileText,
  TrendingUp,
  TrendingDown,
  Bot,
  Receipt,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";
import { useIsSuperAdmin } from "./useIsSuperAdmin";
import type { MenuItem as NavbarMenuItem } from "@/components/ui/navbar1.types";

type SidebarMenuItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
  submenu?: Array<{
    label: string;
    path: string;
  }>;
};

const sidebarMenuItems: SidebarMenuItem[] = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    path: "/",
    submenu: [
      { label: "Dashboard Avançado", path: "/" },
      { label: "Despesas", path: "/financeiro/pagos" },
      { label: "Receitas", path: "/financeiro/recebidos" },
      { label: "Assfac IA", path: "/ai-copilot" },
    ],
  },
  {
    icon: DollarSign,
    label: "Financeiro",
    path: "/financeiro",
    submenu: [
      { label: "Lançamentos", path: "/financeiro/lancamentos" },
      { label: "Operações com IA", path: "/operacoes/ia" },
      { label: "Operações", path: "/operacoes" },
      { label: "Contas a Pagar", path: "/financeiro/contas-a-pagar" },
      { label: "Contas a Receber", path: "/financeiro/contas-a-receber" },
      { label: "Conciliação Bancária", path: "/financeiro/conciliacao-bancaria" },
      { label: "Controle de Cobrança", path: "/financeiro/cobranca-bancaria" },
    ],
  },
  { icon: Layers, label: "Grupos de Contas", path: "/grupos-contas" },
  { icon: CreditCard, label: "Contas e Estoque", path: "/contas-estoque" },
  { icon: Building2, label: "Fornecedores", path: "/fornecedores" },
];

const adminMenuItems: SidebarMenuItem[] = [];

// Mapeamento de paths para descrições
const pathDescriptions: Record<string, string> = {
  "/": "Visão geral completa do sistema",
  "/financeiro/pagos": "Análise de despesas e pagamentos",
  "/financeiro/recebidos": "Análise de receitas e recebimentos",
  "/ai-copilot": "Assistente de IA para suporte e análises",
  "/financeiro/contas-a-pagar": "Gestão de contas a pagar",
  "/financeiro/contas-a-receber": "Gestão de contas a receber",
  "/financeiro/lancamentos": "Lançamentos financeiros",
  "/operacoes/ia": "Revisão e criação em lote a partir de imports DISECURIT (SOI/SPPRO)",
  "/financeiro/conciliacao-bancaria": "Importação de extratos e conciliação de lançamentos",
  "/financeiro/cobranca-bancaria": "Controle de cobrança bancária e conciliação",
  "/grupos-contas": "Organização de grupos de contas",
  "/contas-estoque": "Contas bancárias e estoque",
  "/fornecedores": "Cadastro e gestão de fornecedores",
  "/operacoes": "Operações de estoque",
};

// Mapeamento de paths para ícones específicos de submenu
const submenuIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  "/": LayoutDashboard,
  "/financeiro/pagos": TrendingDown,
  "/financeiro/recebidos": TrendingUp,
  "/ai-copilot": Bot,
  "/financeiro/contas-a-pagar": DollarSign,
  "/financeiro/contas-a-receber": DollarSign,
  "/financeiro/lancamentos": FileText,
  "/operacoes/ia": Sparkles,
  "/financeiro/conciliacao-bancaria": ClipboardCheck,
  "/financeiro/cobranca-bancaria": Receipt,
  "/grupos-contas": Layers,
  "/contas-estoque": CreditCard,
  "/fornecedores": Building2,
  "/operacoes": Warehouse,
};

const convertMenuItem = (item: SidebarMenuItem): NavbarMenuItem => {
  const Icon = item.icon;
  
  if (item.submenu && item.submenu.length > 0) {
    return {
      title: item.label,
      url: item.path,
      items: item.submenu.map((subItem) => {
        const SubIcon = submenuIconMap[subItem.path] || item.icon;
        return {
          title: subItem.label,
          url: subItem.path,
          description: pathDescriptions[subItem.path] || "",
          icon: <SubIcon className="size-5 shrink-0" />,
        };
      }),
    };
  }

  return {
    title: item.label,
    url: item.path,
    description: pathDescriptions[item.path] || "",
    icon: <Icon className="size-5 shrink-0" />,
  };
};

export function useNavbarMenu() {
  const { isSuperAdmin, loading } = useIsSuperAdmin();

  const menu = useMemo(() => {
    const baseMenu = sidebarMenuItems.map(convertMenuItem);
    
    if (!loading && isSuperAdmin) {
      const adminMenu = adminMenuItems.map(convertMenuItem);
      baseMenu.push(...adminMenu);
    }

    return baseMenu;
  }, [isSuperAdmin, loading]);

  return { menu, loading };
}
