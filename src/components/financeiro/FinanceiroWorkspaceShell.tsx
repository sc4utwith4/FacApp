import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type FinanceiroWorkspaceShellProps = {
  /** Conteúdo da coluna principal (header + área rolável internos ao caller). */
  children: ReactNode;
  /** Painel lateral (ex.: copiloto). Abaixo do breakpoint xl fica oculto — use Sheet no caller. */
  sidebar?: ReactNode;
  className?: string;
};

/**
 * Layout compartilhado entre telas financeiras no estilo da conciliação bancária:
 * grid principal + coluna fixa 320px no desktop.
 */
export function FinanceiroWorkspaceShell({
  children,
  sidebar,
  className,
}: FinanceiroWorkspaceShellProps) {
  const hasSidebar = Boolean(sidebar);

  return (
    <div className={cn('flex min-h-[calc(100vh-7rem)] flex-col', className)}>
      <div className="flex min-h-0 w-full flex-1 overflow-hidden p-4">
        <div
          className={cn(
            'grid min-h-0 w-full gap-4',
            hasSidebar && 'xl:grid-cols-[minmax(0,1fr)_320px]'
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            {children}
          </div>
          {hasSidebar ? (
            <div className="hidden min-h-0 overflow-hidden rounded-2xl border border-border bg-background shadow-sm xl:flex xl:flex-col">
              {sidebar}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
