import { ReactNode } from "react";
import { AppShell } from "./app-shell";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <AppShell>
      {children}
    </AppShell>
  );
}
