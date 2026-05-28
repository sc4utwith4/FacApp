import type { ReactNode } from 'react';

interface BankReconciliationWorkspaceProps {
  title: string;
  description?: string;
  toolbar?: ReactNode;
  dailyPanel?: ReactNode;
  children: ReactNode;
}

export function BankReconciliationWorkspace({
  title,
  description,
  toolbar,
  dailyPanel,
  children,
}: BankReconciliationWorkspaceProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
        </div>
        {toolbar ? <div className="flex flex-wrap gap-2">{toolbar}</div> : null}
      </div>

      {dailyPanel}

      {children}
    </div>
  );
}
