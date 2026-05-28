import { Badge } from '@/components/ui/badge';
import type { ConciliacaoItemStatus, LancamentoConciliationBadgeStatus } from '@/types/bank-reconciliation';

interface VerificationStatusBadgeProps {
  status?: ConciliacaoItemStatus | null;
  className?: string;
  labelMode?: 'technical' | 'operational';
}

const STATUS_LABEL: Record<ConciliacaoItemStatus, string> = {
  nao_conciliado: 'Nao conciliado',
  parcial: 'Parcial',
  verificado: 'Verificado',
  divergente: 'Divergente',
};

const STATUS_VARIANT: Record<
  ConciliacaoItemStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  nao_conciliado: 'outline',
  parcial: 'secondary',
  verificado: 'default',
  divergente: 'destructive',
};

export function VerificationStatusBadge({
  status = 'nao_conciliado',
  className,
  labelMode = 'technical',
}: VerificationStatusBadgeProps) {
  const resolvedLabel =
    labelMode === 'operational' && status === 'verificado'
      ? 'Conciliado'
      : STATUS_LABEL[status];

  const variantStatus: LancamentoConciliationBadgeStatus | null =
    labelMode === 'operational'
      ? status === 'verificado'
        ? 'conciliado'
        : status === 'parcial'
          ? 'parcial'
          : status === 'nao_conciliado'
            ? 'nao_conciliado'
            : null
      : null;

  return (
    <Badge
      variant={variantStatus === 'conciliado' ? 'default' : STATUS_VARIANT[status]}
      className={className}
    >
      {resolvedLabel}
    </Badge>
  );
}
