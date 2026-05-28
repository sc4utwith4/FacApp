import { RefreshCcw, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { DailyReconciliationSummary } from '@/types/bank-reconciliation';

interface ContaOption {
  id: string;
  descricao: string;
}

interface DailyClosePanelProps {
  contaBancariaId: string;
  dataReferencia: string;
  contas: ContaOption[];
  summary: DailyReconciliationSummary | null;
  fechamentoStatus: 'open' | 'closed' | 'reopened' | null;
  onContaChange: (value: string) => void;
  onDataChange: (value: string) => void;
  onRefresh: () => void;
  onCloseDay: () => void;
  onReopenDay: () => void;
  loading?: boolean;
  closePending?: boolean;
  reopenPending?: boolean;
}

const numberOrZero = (value: number | undefined | null): number => {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
};

export function DailyClosePanel({
  contaBancariaId,
  dataReferencia,
  contas,
  summary,
  fechamentoStatus,
  onContaChange,
  onDataChange,
  onRefresh,
  onCloseDay,
  onReopenDay,
  loading,
  closePending,
  reopenPending,
}: DailyClosePanelProps) {
  const pendenciasCriticas = numberOrZero(summary?.pendencias_criticas_total);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Fechamento Diario</CardTitle>
            <CardDescription>
              Confere itens financeiros e extrato do dia por conta bancaria antes do fechamento.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={fechamentoStatus === 'closed' ? 'default' : 'secondary'}>
              {fechamentoStatus === 'closed'
                ? 'Dia fechado'
                : fechamentoStatus === 'reopened'
                ? 'Dia reaberto'
                : 'Dia aberto'}
            </Badge>
            <Badge variant={pendenciasCriticas > 0 ? 'destructive' : 'outline'}>
              Pendencias criticas: {pendenciasCriticas}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Conta Bancaria</Label>
            <Select value={contaBancariaId || '__none__'} onValueChange={(value) => onContaChange(value === '__none__' ? '' : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Selecione</SelectItem>
                {contas.map((conta) => (
                  <SelectItem key={conta.id} value={conta.id}>
                    {conta.descricao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Data de referencia</Label>
            <Input type="date" value={dataReferencia} onChange={(event) => onDataChange(event.target.value)} />
          </div>

          <div className="flex items-end gap-2">
            <Button variant="outline" className="w-full" onClick={onRefresh} disabled={!contaBancariaId || !dataReferencia || loading}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Itens" value={numberOrZero(summary?.total_itens)} />
          <Metric label="Verificados" value={numberOrZero(summary?.itens_verificados)} />
          <Metric label="Parciais" value={numberOrZero(summary?.itens_parciais)} />
          <Metric label="Nao conciliados" value={numberOrZero(summary?.itens_nao_conciliados)} />
          <Metric label="Divergentes" value={numberOrZero(summary?.itens_divergentes)} />
          <Metric label="Extrato no dia" value={numberOrZero(summary?.total_extrato_transacoes)} />
          <Metric label="Pendencias extrato" value={numberOrZero(summary?.extrato_pendencias_criticas)} />
          <Metric label="Pendencias item" value={numberOrZero(summary?.item_pendencias_criticas)} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onCloseDay}
            disabled={!contaBancariaId || !dataReferencia || pendenciasCriticas > 0 || closePending || loading}
          >
            <Lock className="mr-2 h-4 w-4" />
            Fechar dia
          </Button>
          <Button
            variant="outline"
            onClick={onReopenDay}
            disabled={!contaBancariaId || !dataReferencia || reopenPending || loading}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reabrir dia
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
