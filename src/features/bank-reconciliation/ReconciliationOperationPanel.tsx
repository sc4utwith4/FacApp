'use client';

import { Loader2, RefreshCcw, Sparkles, UploadCloud, Wand2 } from 'lucide-react';
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

interface ContaOption {
  id: string;
  descricao: string;
}

type UploadType = 'ofx_generic';

interface SelectedImportInfo {
  id: string;
  parse_status: string;
  original_filename?: string | null;
  error_message?: string | null;
  created_at?: string | null;
}

export interface ReconciliationOperationPanelProps {
  contas: ContaOption[];
  selectedContaId: string;
  onContaChange: (value: string) => void;

  uploadType: UploadType;
  onUploadTypeChange: (value: UploadType) => void;

  selectedFile: File | null;
  onSelectedFileChange: (file: File | null) => void;

  selectedImport: SelectedImportInfo | null;
  canRunImportActions: boolean;
  importBlockMessage: string;

  onUpload: () => void;
  onReprocess: () => void;
  onRunMatching: () => void;
  onTriggerAi: () => void;
  onRefreshSummary: () => void;

  uploadPending?: boolean;
  reprocessPending?: boolean;
  matchPending?: boolean;
  triggerPending?: boolean;
  refreshSummaryPending?: boolean;

  className?: string;
}

const PARSE_STATUS_LABEL: Record<string, string> = {
  received: 'Recebido',
  processing: 'Processando',
  parsed: 'Processado',
  duplicate: 'Duplicado',
  failed: 'Falhou',
};

const PARSE_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  received: 'secondary',
  processing: 'outline',
  parsed: 'default',
  duplicate: 'secondary',
  failed: 'destructive',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
};

export function ReconciliationOperationPanel({
  contas,
  selectedContaId,
  onContaChange,
  uploadType,
  onUploadTypeChange,
  selectedFile,
  onSelectedFileChange,
  selectedImport,
  canRunImportActions,
  importBlockMessage,
  onUpload,
  onReprocess,
  onRunMatching,
  onTriggerAi,
  onRefreshSummary,
  uploadPending = false,
  reprocessPending = false,
  matchPending = false,
  triggerPending = false,
  refreshSummaryPending = false,
  className,
}: ReconciliationOperationPanelProps) {
  const hasImport = Boolean(selectedImport?.id);
  const importStatus = selectedImport?.parse_status || null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Operação do Dia</CardTitle>
        <CardDescription>
          Upload, reprocessamento e execução da conciliação canônica sem sair do chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Conta bancária</Label>
            <Select value={selectedContaId || '__none__'} onValueChange={(value) => onContaChange(value === '__none__' ? '' : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
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

          <div className="space-y-1.5">
            <Label>Tipo de arquivo</Label>
            <Select
              value={uploadType}
              onValueChange={(value) => {
                if (value === 'ofx_generic') {
                  onUploadTypeChange(value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ofx_generic">OFX Genérico</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Arquivo</Label>
            <Input
              type="file"
              accept=".ofx,text/plain,application/ofx,application/x-ofx"
              onChange={(event) => onSelectedFileChange(event.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onUpload} disabled={!selectedContaId || !selectedFile || uploadPending} className="gap-1.5">
            {uploadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Enviar e processar
          </Button>

          <Button variant="outline" onClick={onReprocess} disabled={!hasImport || reprocessPending} className="gap-1.5">
            {reprocessPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Reprocessar
          </Button>

          <Button variant="outline" onClick={onRunMatching} disabled={!canRunImportActions || matchPending} className="gap-1.5">
            {matchPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Conciliar (alias legado)
          </Button>

          <Button variant="outline" onClick={onTriggerAi} disabled={!canRunImportActions || triggerPending} className="gap-1.5">
            {triggerPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Conciliar (alias legado)
          </Button>

          <Button variant="outline" onClick={onRefreshSummary} disabled={!selectedContaId || refreshSummaryPending} className="gap-1.5">
            {refreshSummaryPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Atualizar resumo
          </Button>
        </div>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {!hasImport ? (
            <p className="text-muted-foreground">Nenhuma importação selecionada.</p>
          ) : (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Importação:</span>
                <span className="font-medium">{selectedImport?.original_filename || selectedImport?.id}</span>
                <Badge variant={PARSE_STATUS_VARIANT[importStatus || 'received'] || 'secondary'}>
                  {PARSE_STATUS_LABEL[importStatus || 'received'] || importStatus || '—'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Criado em: {formatDateTime(selectedImport?.created_at || null)}</p>
              {importStatus !== 'parsed' ? (
                <p className="text-xs text-amber-700">{importBlockMessage}</p>
              ) : null}
              {selectedImport?.error_message ? (
                <p className="text-xs text-destructive">Detalhe parse: {selectedImport.error_message}</p>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
