import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VerificationStatusBadge } from "@/features/bank-reconciliation/VerificationStatusBadge";
import { parseDateFromDB } from "@/lib/utils";
import type { ConciliacaoItemStatus } from "@/types/bank-reconciliation";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export interface LancamentoDetailsPanelLancamento {
  id: string;
  data: string;
  tipo: "entrada" | "saida";
  valor: number;
  historico: string;
  documento?: string | null;
  observacoes?: string | null;
  contaDescricao?: string | null;
  grupoNome?: string | null;
}

export interface LancamentoDetailsPanelProps {
  lancamento: LancamentoDetailsPanelLancamento;
  itemFinanceiroCode: string | null;
  origemLabel: string;
  origemReferencia?: string | null;
  categoriaLabel: string;
  verificationStatus: ConciliacaoItemStatus;
  hasAiProvenance: boolean;
  isVerified: boolean;
  isMovimentacao: boolean;
  formatCurrency: (value: number) => string;
  onCopyLancamentoCode: (code: string) => void;
  onCopyItemCode: (code: string) => void;
  onEditar: () => void;
  onDuplicar: () => void;
  onAnexos: () => void;
  onConciliacao: () => void;
  onContasFixas: () => void;
  onOperacoes: () => void;
}

const CONCILIACAO_LABEL: Record<ConciliacaoItemStatus, string> = {
  nao_conciliado: "Nao conciliado",
  parcial: "Parcial",
  verificado: "Conciliado",
  divergente: "Divergente",
};

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm font-medium text-foreground">{children}</div>
    </>
  );
}

export function LancamentoDetailsPanel({
  lancamento,
  itemFinanceiroCode,
  origemLabel,
  origemReferencia,
  categoriaLabel,
  verificationStatus,
  hasAiProvenance,
  isVerified,
  isMovimentacao,
  formatCurrency,
  onCopyLancamentoCode,
  onCopyItemCode,
  onEditar,
  onDuplicar,
  onAnexos,
  onConciliacao,
  onContasFixas,
  onOperacoes,
}: LancamentoDetailsPanelProps) {
  const parsedDate = parseDateFromDB(lancamento.data);
  const dataLabel = parsedDate ? parsedDate.toLocaleDateString("pt-BR") : "—";
  const tipoLabel = lancamento.tipo === "entrada" ? "Entrada" : "Saída";
  const conciliacaoLabel = CONCILIACAO_LABEL[verificationStatus] || "Nao conciliado";
  const metadadoTopo = `Lançamento em ${dataLabel} • Origem: ${origemLabel} • ${conciliacaoLabel}`;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">{lancamento.historico || "Lançamento sem histórico"}</h2>
        <div className={lancamento.tipo === "entrada" ? "text-4xl font-semibold text-success" : "text-4xl font-semibold text-destructive"}>
          {formatCurrency(Number(lancamento.valor))}
        </div>
        <p className="text-sm text-muted-foreground">{metadadoTopo}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onEditar} disabled={isVerified}>
          Editar
        </Button>
        <Button size="sm" variant="outline" onClick={onDuplicar}>
          Duplicar
        </Button>
        <Button size="sm" variant="outline" onClick={onAnexos} disabled={isMovimentacao}>
          Anexos
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Mais
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onConciliacao();
              }}
            >
              Conciliação Bancária
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onContasFixas();
              }}
            >
              Contas Fixas
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onOperacoes();
              }}
            >
              Operações
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <section className="space-y-4 border-t border-border/60 pt-5">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Detalhes do lançamento</h3>
          <p className="text-sm text-muted-foreground">Informações principais de classificação, origem e conciliação.</p>
        </div>

        <div className="grid grid-cols-[minmax(120px,170px)_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
          <DetailRow label="Data">{dataLabel}</DetailRow>
          <DetailRow label="Tipo">{tipoLabel}</DetailRow>
          <DetailRow label="Categoria operacional">{categoriaLabel}</DetailRow>
          <DetailRow label="Conta">{lancamento.contaDescricao || "—"}</DetailRow>
          <DetailRow label="Grupo">{lancamento.grupoNome || "—"}</DetailRow>
          <DetailRow label="Conciliação">
            <div className="flex flex-wrap items-center gap-2">
              <VerificationStatusBadge status={verificationStatus} labelMode="operational" />
              {hasAiProvenance ? (
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                  IA
                </Badge>
              ) : null}
            </div>
          </DetailRow>
          <DetailRow label="Origem">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{origemLabel}</Badge>
              {origemReferencia ? (
                <code className="rounded bg-muted px-2 py-1 text-xs">{origemReferencia}</code>
              ) : null}
            </div>
          </DetailRow>
          <DetailRow label="Valor">{formatCurrency(Number(lancamento.valor))}</DetailRow>
          <DetailRow label="Histórico">
            <span className="font-normal leading-relaxed">{lancamento.historico || "—"}</span>
          </DetailRow>
          <DetailRow label="Documento">{lancamento.documento || "—"}</DetailRow>
          <DetailRow label="Observações">
            <span className="font-normal leading-relaxed">{lancamento.observacoes || "—"}</span>
          </DetailRow>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/60 pt-5">
        <h3 className="text-lg font-semibold text-foreground">Identificadores</h3>

        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Código do lançamento</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2.5 py-2 text-xs">
              {String(lancamento.id || "—")}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onCopyLancamentoCode(String(lancamento.id || ""))}
              disabled={!lancamento.id}
            >
              Copiar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Item financeiro</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2.5 py-2 text-xs">
              {itemFinanceiroCode || "—"}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onCopyItemCode(String(itemFinanceiroCode || ""))}
              disabled={!itemFinanceiroCode}
            >
              Copiar
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
