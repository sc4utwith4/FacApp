import * as React from "react";
import { cn } from "@/lib/utils";
import { Navbar1 } from "@/components/ui/navbar1";
import { useNavbarMenu } from "@/hooks/useNavbarMenu";

interface AppShellProps {
  children: React.ReactNode;
  sidebarItems?: Array<{
    title: string;
    icon: React.ReactNode;
    href: string;
    badge?: string;
    submenu?: Array<{
      label: string;
      path: string;
    }>;
  }>;
  headerActions?: React.ReactNode;
  className?: string;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  sidebarItems,
  headerActions,
  className,
}) => {
  const { menu } = useNavbarMenu();

  return (
    <div className="flex min-h-screen flex-col bg-background-secondary">
      <Navbar1 
        menu={menu}
        logo={{
          url: "/",
          src: "/assfac-simbolo-dolar-white-64x64.png",
          alt: "ASSFAC",
          title: "ASSFAC",
        }}
      />
      <main className={cn("flex-1 overflow-y-auto bg-background px-4 py-6 sm:px-6 lg:px-8", className)}>
        <div className="mx-auto max-w-7xl w-full min-w-0">
          {children}
        </div>
      </main>
    </div>
  );
};
