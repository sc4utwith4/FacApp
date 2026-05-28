import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, Filter, MessageSquareText, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { FinanceiroWorkspaceShell } from '@/components/financeiro/FinanceiroWorkspaceShell';
import {
  OperacoesIaCopilotPanel,
  type OperacoesIaCopilotMessage,
  type OperacoesIaUploadQueueItem,
} from '@/features/operacoes-ia/OperacoesIaCopilotPanel';
import { supabase } from '@/integrations/supabase/client';
import { useDisecuritImport, normalizeCnpjValue } from '@/hooks/useDisecuritImport';
import { useFornecedoresSelect } from '@/hooks/useFornecedores';
import { useEstoquesSelect } from '@/hooks/useEstoque';
import type { DisecuritProgram } from '@/types/disecurit-import';
import type {
  OperationIaBatchConfirmResponse,
  OperationIaBatchPreviewResponse,
  OperationIaContaBancariaOption,
  OperationIaDraftItem,
  OperationIaExtractionDiagnostic,
  OperationIaHistoryData,
  OperationIaHistoryResponse,
  OperationIaRawSnapshotField,
  OperationIaSpproFormula,
  OperationIaSoiFormula,
  OperacoesIaChatMessagesApiResponse,
  OperacoesIaChatSessionsApiResponse,
} from '@/types/operacoes-ia';

type WorkspaceState = 'no_context' | 'loading' | 'error' | 'empty' | 'ready';
type RowFilter = 'all' | 'ready' | 'review' | 'error' | 'created' | 'failed' | 'ignored';
type SessionImportEligibilityReason =
  | 'linked'
  | 'missing'
  | 'received'
  | 'processing'
  | 'failed'
  | 'duplicate'
  | 'other';

type EditableDraftItem = OperationIaDraftItem & {
  decision: 'confirm' | 'ignore';
  ignore_reason: string;
  force_create: boolean;
  force_create_reason: string;
  runtime_status: 'created' | 'ignored' | 'failed' | null;
  runtime_message: string | null;
};

type QueuedUploadFile = {
  id: string;
  file: File;
  signature: string;
  status: OperacoesIaUploadQueueItem['status'];
  errorMessage: string | null;
  importFileId: string | null;
};

type SessionImportEligibility = {
  id: string;
  label: string;
  parseStatus: string;
  linkedOperacaoId: number | null;
  eligible: boolean;
  reason: SessionImportEligibilityReason | null;
};

const isTruthyEnvValue = (value: string): boolean =>
  ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());

const resolveDuplicateTestModeClientDefault = (): boolean => {
  const enabled = isTruthyEnvValue(String(import.meta.env.VITE_OPERACOES_IA_ALLOW_DUPLICATE_TEST || ''));
  if (!enabled) return false;

  const vercelEnv = String(import.meta.env.VITE_VERCEL_ENV || '').trim().toLowerCase();
  if (vercelEnv && vercelEnv !== 'production') return true;
  if (vercelEnv === 'production') {
    return isTruthyEnvValue(
      String(import.meta.env.VITE_OPERACOES_IA_ALLOW_DUPLICATE_TEST_PROD_OVERRIDE || '')
    );
  }

  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return isTruthyEnvValue(
      String(import.meta.env.VITE_OPERACOES_IA_ALLOW_DUPLICATE_TEST_PROD_OVERRIDE || '')
    );
  }

  return true;
};

const resolveConflictOverrideDuplicateTestClientDefault = (): boolean =>
  isTruthyEnvValue(String(import.meta.env.VITE_OPERACOES_IA_ALLOW_CONFLICT_OVERRIDE_DUPLICATE_TEST || ''));

const statusBadgeVariant = (status: string) => {
  if (status === 'created' || status === 'ready') return 'success';
  if (status === 'review') return 'warning';
  if (status === 'failed' || status === 'error') return 'destructive';
  if (status === 'ignored') return 'secondary';
  return 'outline';
};

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const toDateInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildDuplicateAutoForceReason = (importFileId: string): string =>
  `auto_force_create_duplicate_test:${String(importFileId || 'unknown')}`;

const buildDuplicateAutoIgnoreReason = (importFileId: string): string =>
  `auto_ignore_duplicate_prod:${String(importFileId || 'unknown')}`;

const createUploadSignature = (file: File): string =>
  `${file.name}::${file.size}::${file.lastModified}`;

const createUploadId = (): string => `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const parseStatusLabel = (status: string): string => {
  if (status === 'received') return 'Recebido';
  if (status === 'processing') return 'Processando';
  if (status === 'parsed') return 'Parseado';
  if (status === 'parse_partial') return 'Parse parcial';
  if (status === 'failed') return 'Falhou';
  if (status === 'duplicate') return 'Duplicado';
  return status || 'desconhecido';
};

const CONFLICT_FIELD_TO_ITEM_KEY: Record<string, keyof EditableDraftItem> = {
  face_value: 'face_titulos',
  purchase_value: 'valor_compra',
  net_value: 'valor_compra',
  expenses: 'despesas',
  recompra: 'recompra',
  ad_valorem: 'ad_valorem',
  iss: 'iss',
  iof: 'iof',
  iof_additional: 'iof_adicional',
  amort_debits: 'amortizacao_debitos',
  amort_credits: 'amortizacao_creditos',
};

const formatDiagnosticFieldLabel = (fieldName: string): string => {
  if (fieldName === 'face_value') return 'Face dos títulos';
  if (fieldName === 'purchase_value') return 'Valor de compra';
  if (fieldName === 'net_value') return 'Líquido';
  if (fieldName === 'expenses') return 'Despesas';
  if (fieldName === 'ad_valorem') return 'Ad-Valorem';
  if (fieldName === 'iss') return 'ISS';
  if (fieldName === 'iof') return 'IOF';
  if (fieldName === 'iof_additional') return 'IOF adicional';
  if (fieldName === 'recompra') return 'Recompra';
  if (fieldName === 'amort_debits') return 'Amortização débitos';
  if (fieldName === 'amort_credits') return 'Amortização créditos';
  if (fieldName === 'sppro_quantidade_titulos') return 'Quantidade de Títulos';
  if (fieldName === 'sppro_valor_face') return '(+ ) Valor de Face dos Títulos';
  if (fieldName === 'sppro_valor_compra') return '(- ) Valor de Compra';
  if (fieldName === 'sppro_ad_valorem') return '(- ) Valor de Ad-valorem';
  if (fieldName === 'sppro_iss') return '(- ) Valor de ISS';
  if (fieldName === 'sppro_despesas') return '(- ) Valor de Despesas';
  if (fieldName === 'sppro_iof') return '(- ) Valor de IOF';
  if (fieldName === 'sppro_iof_adicional') return '(- ) Valor de IOF Adicional';
  if (fieldName === 'sppro_recompra') return '(- ) Valor de Recompra';
  if (fieldName === 'sppro_liquido_operacao') return '(= ) Valor Líquido da Operação';
  if (fieldName === 'soi_valor_original') return '(+ ) Valor Original';
  if (fieldName === 'soi_valor_desagio') return '(- ) Valor de Deságio';
  if (fieldName === 'soi_valor_desagio_antecipacao') return '(- ) Valor de Deságio Antecipação';
  if (fieldName === 'soi_despesas') return '(* ) Despesas';
  if (fieldName === 'soi_regresso') return '(- ) Regresso';
  if (fieldName === 'soi_amortiza_debitos') return '(- ) Amortiza débitos';
  if (fieldName === 'soi_amortiza_creditos') return '(+ ) Amortiza créditos';
  if (fieldName === 'soi_creditos_gerados') return '(- ) Créditos gerados';
  if (fieldName === 'soi_liquido_liberado') return '(= ) Líquido Liberado';
  return fieldName;
};

const ensureSoiFormula = (item: EditableDraftItem): OperationIaSoiFormula => ({
  valor_original: toNumber(item.soi_formula?.valor_original) ?? toNumber(item.face_titulos),
  valor_desagio: toNumber(item.soi_formula?.valor_desagio) ?? toNumber(item.valor_compra),
  valor_desagio_antecipacao: toNumber(item.soi_formula?.valor_desagio_antecipacao) ?? 0,
  despesas: toNumber(item.soi_formula?.despesas) ?? 0,
  regresso: toNumber(item.soi_formula?.regresso) ?? toNumber(item.recompra) ?? 0,
  amortiza_debitos: toNumber(item.soi_formula?.amortiza_debitos) ?? 0,
  amortiza_creditos: toNumber(item.soi_formula?.amortiza_creditos) ?? toNumber(item.amortizacao_creditos) ?? 0,
  creditos_gerados: toNumber(item.soi_formula?.creditos_gerados) ?? toNumber(item.amortizacao_debitos) ?? 0,
  liquido_liberado: toNumber(item.soi_formula?.liquido_liberado),
});

const ensureSpproFormula = (item: EditableDraftItem): OperationIaSpproFormula => ({
  quantidade_titulos: toNumber(item.sppro_formula?.quantidade_titulos),
  valor_face: toNumber(item.sppro_formula?.valor_face) ?? toNumber(item.face_titulos),
  valor_compra: toNumber(item.sppro_formula?.valor_compra) ?? toNumber(item.valor_compra),
  ad_valorem: toNumber(item.sppro_formula?.ad_valorem) ?? toNumber(item.ad_valorem) ?? 0,
  iss: toNumber(item.sppro_formula?.iss) ?? toNumber(item.iss) ?? 0,
  despesas: toNumber(item.sppro_formula?.despesas) ?? toNumber(item.despesas) ?? 0,
  iof: toNumber(item.sppro_formula?.iof) ?? toNumber(item.iof) ?? 0,
  iof_adicional: toNumber(item.sppro_formula?.iof_adicional) ?? toNumber(item.iof_adicional) ?? 0,
  recompra: toNumber(item.sppro_formula?.recompra) ?? toNumber(item.recompra) ?? 0,
  liquido_operacao: toNumber(item.sppro_formula?.liquido_operacao) ?? toNumber(item.valor_compra),
});

const isMonetaryRawField = (key: string): boolean =>
  [
    'face_titulos',
    'valor_compra',
    'despesas',
    'ad_valorem',
    'iss',
    'iof',
    'iof_adicional',
    'amortizacao_debitos',
    'amortizacao_creditos',
    'sppro_valor_face',
    'sppro_valor_compra',
    'sppro_ad_valorem',
    'sppro_iss',
    'sppro_despesas',
    'sppro_iof',
    'sppro_iof_adicional',
    'sppro_recompra',
    'sppro_liquido_operacao',
    'soi_valor_original',
    'soi_valor_desagio',
    'soi_valor_desagio_antecipacao',
    'soi_despesas',
    'soi_regresso',
    'soi_amortiza_debitos',
    'soi_amortiza_creditos',
    'soi_creditos_gerados',
    'soi_liquido_liberado',
  ].includes(key);

const formatRawSnapshotValue = (field: OperationIaRawSnapshotField): string => {
  if (field.normalized_value === null || field.normalized_value === undefined || field.normalized_value === '') {
    return '—';
  }
  if (typeof field.normalized_value === 'number') {
    if (isMonetaryRawField(field.key)) return formatCurrency(field.normalized_value);
    return String(field.normalized_value);
  }
  return String(field.normalized_value);
};

const formatTimelineEventType = (eventType: unknown): string | null => {
  const value = String(eventType || '').trim();
  if (!value) return null;
  if (value === 'extraction_conflict_detected') return 'Conflito detectado';
  if (value === 'manual_field_corrected') return 'Campo corrigido';
  if (value === 'confirm_blocked_conflict') return 'Confirmação bloqueada';
  if (value === 'confirm_created_success') return 'Confirmação concluída';
  return value;
};

const resolveHybridTolerance = (...values: Array<number | null | undefined>): number => {
  const base = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((max, current) => Math.max(max, Math.abs(current)), 0);
  return Math.max(0.5, base * 0.002);
};

const isDiagnosticConflictResolved = (item: EditableDraftItem, diagnostic: OperationIaExtractionDiagnostic): boolean => {
  if (!diagnostic.conflict_flag) return true;
  const mappedField =
    diagnostic.field_name === 'net_value' && item.program === 'SOI'
      ? null
      : CONFLICT_FIELD_TO_ITEM_KEY[diagnostic.field_name];
  if (diagnostic.field_name === 'net_value' && item.program === 'SPPRO') {
    const currentValue = toNumber(ensureSpproFormula(item).liquido_operacao);
    const extractedValue = toNumber(diagnostic.resolved_value);
    if (currentValue === null || extractedValue === null) return false;
    const tolerance = resolveHybridTolerance(currentValue, extractedValue);
    return Math.abs(currentValue - extractedValue) > tolerance;
  }
  if (diagnostic.field_name === 'net_value' && item.program === 'SOI') {
    const currentValue = toNumber(ensureSoiFormula(item).liquido_liberado);
    const extractedValue = toNumber(diagnostic.resolved_value);
    if (currentValue === null || extractedValue === null) return false;
    const tolerance = resolveHybridTolerance(currentValue, extractedValue);
    return Math.abs(currentValue - extractedValue) > tolerance;
  }
  if (!mappedField) return false;
  const currentValue = toNumber(item[mappedField] as unknown);
  const extractedValue = toNumber(diagnostic.resolved_value);
  if (currentValue === null && extractedValue === null) return false;
  if (currentValue === null || extractedValue === null) return true;
  const tolerance = resolveHybridTolerance(currentValue, extractedValue);
  return Math.abs(currentValue - extractedValue) > tolerance;
};

const buildValidationIssues = (
  item: EditableDraftItem,
  options?: { duplicateTestModeEnabled?: boolean; conflictOverrideDuplicateTestEnabled?: boolean }
): string[] => {
  const issues: string[] = [];
  const duplicateAllowed = Boolean(options?.duplicateTestModeEnabled && item.parse_status === 'duplicate');
  const duplicateIgnoredInProduction = Boolean(
    item.parse_status === 'duplicate' && !options?.duplicateTestModeEnabled && item.decision === 'ignore'
  );
  const conflictOverrideAllowedInItem = Boolean(
    options?.conflictOverrideDuplicateTestEnabled && duplicateAllowed && item.force_create
  );

  if (
    !duplicateAllowed &&
    !duplicateIgnoredInProduction &&
    item.parse_status !== 'parsed' &&
    item.parse_status !== 'parse_partial'
  ) {
    issues.push(`Import em status ${item.parse_status}.`);
  }
  if (item.linked_operacao_id) {
    issues.push(`Import já vinculado à operação #${item.linked_operacao_id}.`);
  }

  const shouldValidateConfirmPath = item.decision !== 'ignore';
  if (shouldValidateConfirmPath) {
    if (!item.program) issues.push('Programa é obrigatório.');
    if (!item.estoque_id) issues.push('Estoque é obrigatório.');
    if (!item.fornecedor_id) issues.push('Fornecedor é obrigatório.');
    if (!item.conta_bancaria_id) issues.push('Conta bancária é obrigatória.');
    if (!item.data_operacao) issues.push('Data da operação é obrigatória.');
    if (!item.face_titulos || item.face_titulos <= 0) issues.push('Face dos títulos deve ser maior que zero.');
    if (!item.valor_compra || item.valor_compra <= 0) {
      issues.push(
        item.program === 'SOI'
          ? 'Valor de Deságio deve ser maior que zero.'
          : 'Valor compra/líquido deve ser maior que zero.'
      );
    }

    if (item.program === 'SOI') {
      const soiFormula = ensureSoiFormula(item);
      if (!soiFormula.liquido_liberado || soiFormula.liquido_liberado <= 0) {
        issues.push('Líquido Liberado deve ser maior que zero.');
      }

      const formulaValues = [
        { label: 'Valor Original', value: soiFormula.valor_original },
        { label: 'Valor de Deságio', value: soiFormula.valor_desagio },
        { label: 'Valor de Deságio Antecipação', value: soiFormula.valor_desagio_antecipacao },
        { label: 'Despesas', value: soiFormula.despesas },
        { label: 'Regresso', value: soiFormula.regresso },
        { label: 'Amortiza débitos', value: soiFormula.amortiza_debitos },
        { label: 'Amortiza créditos', value: soiFormula.amortiza_creditos },
        { label: 'Créditos gerados', value: soiFormula.creditos_gerados },
        { label: 'Líquido Liberado', value: soiFormula.liquido_liberado },
      ];
      formulaValues.forEach((field) => {
        if (field.value !== null && field.value < 0) {
          issues.push(`${field.label} não pode ser negativo.`);
        }
      });

      if (
        soiFormula.valor_original !== null &&
        soiFormula.valor_desagio !== null &&
        soiFormula.liquido_liberado !== null
      ) {
        const computedLiquido =
          soiFormula.valor_original -
          soiFormula.valor_desagio +
          (0 - (soiFormula.valor_desagio_antecipacao || 0)) -
          (soiFormula.despesas || 0) -
          (soiFormula.regresso || 0) -
          (soiFormula.amortiza_debitos || 0) +
          (soiFormula.amortiza_creditos || 0) -
          (soiFormula.creditos_gerados || 0);
        const tolerance = resolveHybridTolerance(computedLiquido, soiFormula.liquido_liberado);
        if (Math.abs(computedLiquido - soiFormula.liquido_liberado) > tolerance && !conflictOverrideAllowedInItem) {
          issues.push('Fórmula SOI inconsistente: revise os campos antes de confirmar.');
        }
      }
    }

    if (item.program === 'SPPRO') {
      const spproFormula = ensureSpproFormula(item);
      if (!spproFormula.liquido_operacao || spproFormula.liquido_operacao <= 0) {
        issues.push('Valor Líquido da Operação deve ser maior que zero.');
      }

      const formulaValues = [
        { label: 'Quantidade de Títulos', value: spproFormula.quantidade_titulos, allowNull: true },
        { label: 'Valor de Face dos Títulos', value: spproFormula.valor_face, allowNull: false },
        { label: 'Valor de Compra', value: spproFormula.valor_compra, allowNull: false },
        { label: 'Valor de Ad-valorem', value: spproFormula.ad_valorem, allowNull: false },
        { label: 'Valor de ISS', value: spproFormula.iss, allowNull: false },
        { label: 'Valor de Despesas', value: spproFormula.despesas, allowNull: false },
        { label: 'Valor de IOF', value: spproFormula.iof, allowNull: false },
        { label: 'Valor de IOF Adicional', value: spproFormula.iof_adicional, allowNull: false },
        { label: 'Valor de Recompra', value: spproFormula.recompra, allowNull: false },
        { label: 'Valor Líquido da Operação', value: spproFormula.liquido_operacao, allowNull: false },
      ];
      formulaValues.forEach((field) => {
        if (!field.allowNull && field.value === null) return;
        if (field.value !== null && field.value < 0) {
          issues.push(`${field.label} não pode ser negativo.`);
        }
      });

      if (
        spproFormula.valor_face !== null &&
        spproFormula.valor_compra !== null &&
        spproFormula.liquido_operacao !== null
      ) {
        const computedLiquido =
          spproFormula.valor_face -
          spproFormula.valor_compra -
          (spproFormula.ad_valorem || 0) -
          (spproFormula.iss || 0) -
          (spproFormula.despesas || 0) -
          (spproFormula.iof || 0) -
          (spproFormula.iof_adicional || 0) -
          (spproFormula.recompra || 0);
        const tolerance = resolveHybridTolerance(computedLiquido, spproFormula.liquido_operacao);
        if (Math.abs(computedLiquido - spproFormula.liquido_operacao) > tolerance && !conflictOverrideAllowedInItem) {
          issues.push('Fórmula SPPRO inconsistente: revise os campos antes de confirmar.');
        }
      }
    }

    const pushIfNegative = (value: number | null, label: string) => {
      if (value !== null && value < 0) issues.push(`${label} não pode ser negativo.`);
    };

    pushIfNegative(item.despesas, 'Despesas');
    pushIfNegative(item.recompra, 'Recompra');
    pushIfNegative(item.amortizacao_debitos, 'Amortização de débitos');
    pushIfNegative(item.amortizacao_creditos, 'Amortização de créditos');

    if (item.program === 'SPPRO') {
      pushIfNegative(item.ad_valorem, 'Ad-Valorem');
      pushIfNegative(item.iss, 'ISS');
      pushIfNegative(item.iof, 'IOF');
      pushIfNegative(item.iof_adicional, 'IOF adicional');
    }
  }

  if (item.decision === 'ignore' && !String(item.ignore_reason || '').trim()) {
    issues.push('Ignorar exige justificativa.');
  }

  if (shouldValidateConfirmPath && !duplicateAllowed && item.force_create && !String(item.force_create_reason || '').trim()) {
    issues.push('Force create exige justificativa.');
  }
  if (shouldValidateConfirmPath && duplicateAllowed && !item.force_create) {
    issues.push('Em modo teste, ative force_create para confirmar duplicados.');
  }
  if (
    shouldValidateConfirmPath &&
    duplicateAllowed &&
    item.duplicate_hydration_status === 'missing' &&
    !conflictOverrideAllowedInItem
  ) {
    issues.push(
      'Import duplicado sem origem confiável para hidratação. Reimporte/reprocesse o arquivo original antes de confirmar.'
    );
  }

  const unresolvedCriticalConflicts = (item.extraction_diagnostics || []).filter(
    (diagnostic) => diagnostic.critical && diagnostic.conflict_flag && !isDiagnosticConflictResolved(item, diagnostic)
  );
  if (shouldValidateConfirmPath && unresolvedCriticalConflicts.length > 0 && !conflictOverrideAllowedInItem) {
    const labels = unresolvedCriticalConflicts
      .map((diagnostic) => formatDiagnosticFieldLabel(diagnostic.field_name))
      .join(', ');
    issues.push(`Conflito crítico de extração não resolvido (${labels}).`);
  }

  return issues;
};

const deriveStatus = (
  item: EditableDraftItem,
  issues: string[],
  options?: { duplicateTestModeEnabled?: boolean }
): EditableDraftItem['status'] => {
  if (item.decision === 'ignore') return 'ignored';
  if (item.parse_status === 'duplicate') return options?.duplicateTestModeEnabled ? 'review' : 'error';
  if (!issues.length) return 'ready';
  if (issues.some((issue) => issue.includes('já vinculado') || issue.includes('Import em status'))) return 'error';
  return 'review';
};

const duplicateHydrationMethodLabel = (method?: EditableDraftItem['duplicate_hydration_resolution_method']): string => {
  if (method === 'self_payload') return 'self_payload';
  if (method === 'auto_reparse') return 'auto_reparse';
  if (method === 'operation_number') return 'operation_number';
  if (method === 'audit') return 'audit';
  if (method === 'hash') return 'hash';
  return 'fallback';
};

function OperacoesIaSelectedItemDiagnostics({
  item,
  duplicateTestModeEnabled,
}: {
  item: EditableDraftItem;
  duplicateTestModeEnabled: boolean;
}) {
  const itemIssues = item.issues || [];

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusBadgeVariant(item.runtime_status || item.status)}>
          {item.runtime_status || item.status}
        </Badge>
        {item.fornecedor_match_method === 'cnpj' || item.fornecedor_match_method === 'name_fuzzy' ? (
          <Badge variant="outline">
            Auto fornecedor {Math.round((item.fornecedor_match_confidence || 0) * 100)}%
          </Badge>
        ) : null}
        {item.has_critical_conflict ? <Badge variant="warning">Conflito de extração</Badge> : null}
        {item.parse_status === 'duplicate' ? (
          <Badge variant="warning">
            {duplicateTestModeEnabled ? 'Duplicado (modo teste)' : 'Duplicado (auto-ignore produção)'}
          </Badge>
        ) : null}
        {duplicateTestModeEnabled &&
        item.parse_status === 'duplicate' &&
        item.duplicate_hydration_status === 'hydrated' ? (
          <Badge variant="outline">
            Hidratado via {duplicateHydrationMethodLabel(item.duplicate_hydration_resolution_method)}
          </Badge>
        ) : null}
        {duplicateTestModeEnabled && item.parse_status === 'duplicate' && item.duplicate_hydration_status === 'missing' ? (
          <Badge variant="destructive">Origem ausente</Badge>
        ) : null}
      </div>

      {item.runtime_message ? (
        <div className="rounded-md border border-muted/60 bg-muted/30 p-2 text-muted-foreground">{item.runtime_message}</div>
      ) : null}

      {itemIssues.length > 0 ? (
        <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700">
          {itemIssues.map((issue) => (
            <div key={`${item.id}-${issue}`} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{issue}</span>
            </div>
          ))}
        </div>
      ) : item.decision === 'ignore' ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-300/50 bg-slate-100/40 p-2 text-slate-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Item configurado para ignorar na confirmação.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Item pronto para confirmação.
        </div>
      )}

      {item.extraction_diagnostics?.length ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Diagnóstico de extração</p>
          <div className="mt-1 space-y-1 text-muted-foreground">
            {item.extraction_diagnostics.map((diagnostic) => (
              <div
                key={`${item.id}-${diagnostic.field_name}`}
                className={cn(
                  'rounded border px-2 py-1',
                  diagnostic.conflict_flag
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
                )}
              >
                <p className="font-medium">
                  {formatDiagnosticFieldLabel(diagnostic.field_name)} · {diagnostic.source_method.toUpperCase()}
                </p>
                <p>
                  Extraído: {formatCurrency(diagnostic.resolved_value)}{' '}
                  {diagnostic.compared_value !== null ? <>· Comparado: {formatCurrency(diagnostic.compared_value)}</> : null}
                  {diagnostic.difference !== null && diagnostic.tolerance !== null ? (
                    <> · Dif: {formatCurrency(diagnostic.difference)} (tol {formatCurrency(diagnostic.tolerance)})</>
                  ) : null}
                </p>
                {diagnostic.reason ? <p>{diagnostic.reason}</p> : null}
                {diagnostic.candidates?.length ? (
                  <div className="mt-1 rounded border border-border/50 bg-background/70 px-2 py-1 text-[11px]">
                    <p className="font-medium">Candidatos considerados</p>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                      {diagnostic.candidates.slice(0, 4).map((candidate, index) => (
                        <li key={`${item.id}-${diagnostic.field_name}-candidate-${index}`}>
                          {formatCurrency(candidate.value)} · {candidate.source_method.toUpperCase()}
                          {candidate.confidence !== null ? ` · conf ${(candidate.confidence * 100).toFixed(0)}%` : ''}
                          {candidate.raw_value ? ` · raw ${candidate.raw_value}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {item.history_timeline?.length ? (
        <div className="rounded-md border border-border/60 bg-background p-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Histórico do item</p>
          <div className="mt-1 space-y-1 text-muted-foreground">
            {item.history_timeline.slice(0, 6).map((event) => (
              <div key={event.id} className="rounded border border-border/50 px-2 py-1">
                <p className="font-medium">
                  {formatDiagnosticFieldLabel(event.field_name)} · {event.status} · {event.source_method}
                </p>
                {formatTimelineEventType(event.metadata?.event_type) ? (
                  <p className="text-[11px] text-muted-foreground">
                    Evento: {formatTimelineEventType(event.metadata?.event_type)}
                  </p>
                ) : null}
                <p>
                  {event.raw_value ? `anterior: ${event.raw_value} · ` : ''}
                  atual: {event.normalized_value !== null ? formatCurrency(event.normalized_value) : '—'}
                </p>
                <p>{new Date(event.created_at).toLocaleString('pt-BR')}</p>
              </div>
            ))}
            {item.history_timeline.length > 6 ? (
              <p className="text-[11px]">…{item.history_timeline.length - 6} evento(s) adicionais.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {item.raw_pdf_snapshot?.length ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Campos do PDF (raw, somente leitura)
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {item.raw_pdf_snapshot.map((field) => (
              <div
                key={`${item.id}-raw-${field.key}`}
                className={cn(
                  'rounded border px-2 py-1 text-xs',
                  field.conflict_flag
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                    : 'border-border/60 bg-background text-muted-foreground'
                )}
              >
                <p className="font-medium text-foreground">{field.label}</p>
                <p>valor: {formatRawSnapshotValue(field)}</p>
                {field.raw_value ? <p>raw: {field.raw_value}</p> : null}
                <p>
                  origem: {field.source_method.toUpperCase()}
                  {field.confidence !== null ? ` · conf ${(field.confidence * 100).toFixed(0)}%` : ''}
                </p>
                {field.reason ? <p>{field.reason}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}


const getFilteredItems = (items: EditableDraftItem[], filter: RowFilter): EditableDraftItem[] => {
  if (filter === 'all') return items;
  if (filter === 'created') return items.filter((item) => item.runtime_status === 'created');
  if (filter === 'failed') return items.filter((item) => item.runtime_status === 'failed');
  if (filter === 'ignored') {
    return items.filter((item) => item.runtime_status === 'ignored' || item.decision === 'ignore');
  }
  return items.filter((item) => item.status === filter);
};

const summarizeOperacoesIaResponseBody = (raw: string, maxLen = 160): string => {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(vazio)';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
};

const appendMigrationHintIfNeeded = (message: string): string => {
  if (/relation|does not exist|operacoes_ia_chat|schema cache/i.test(message)) {
    return `${message} Se o projeto usa Supabase, aplique a migração que cria operacoes_ia_chat_sessions e operacoes_ia_chat_messages.`;
  }
  return message;
};

async function callOperacoesIaApi<TResponse>(
  path: string,
  body: unknown,
  options?: { method?: 'GET' | 'POST' | 'DELETE' }
): Promise<TResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const method = options?.method || 'POST';
  const sendJsonBody = (method === 'POST' || method === 'PUT' || method === 'PATCH') && body !== undefined && body !== null;
  const response = await fetch(path, {
    method,
    headers: {
      ...(sendJsonBody ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
    ...(sendJsonBody ? { body: JSON.stringify(body) } : {}),
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text().catch(() => '');
  const trimmed = rawText.trim();

  let payload: unknown = null;
  const looksJson =
    contentType.includes('application/json') ||
    contentType.includes('application/problem+json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');

  if (trimmed && looksJson) {
    try {
      payload = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error(
        appendMigrationHintIfNeeded(
          `Resposta não é JSON válido em ${path} (HTTP ${response.status}). Trecho: ${summarizeOperacoesIaResponseBody(trimmed)} Possível HTML de 404 (SPA ou rota /api ausente no servidor local).`
        )
      );
    }
  }

  if (!response.ok) {
    let message =
      (payload && typeof (payload as { message?: string }).message === 'string'
        ? (payload as { message: string }).message
        : null) ||
      (payload && typeof (payload as { error?: string }).error === 'string'
        ? (payload as { error: string }).error
        : null) ||
      (trimmed && !looksJson
        ? `Falha em ${path} (HTTP ${response.status}). Resposta não é JSON (possível proxy/API desatualizada): ${summarizeOperacoesIaResponseBody(trimmed)}`
        : null) ||
      `Falha na chamada ${path} (HTTP ${response.status}).`;

    message = appendMigrationHintIfNeeded(message);
    throw new Error(message);
  }

  if (payload === null && trimmed && !looksJson) {
    throw new Error(
      `Resposta inesperada em ${path} (HTTP ${response.status}): esperado JSON, recebido ${contentType || 'sem Content-Type'}. Trecho: ${summarizeOperacoesIaResponseBody(trimmed)}`
    );
  }

  if (payload === null && !trimmed) {
    throw new Error(`Resposta vazia em ${path} (HTTP ${response.status}).`);
  }

  return payload as TResponse;
}

export default function OperacoesIaIndex() {
  const disecuritImport = useDisecuritImport({ includeLinked: true });
  const { data: fornecedores = [] } = useFornecedoresSelect();
  const { data: estoques = [] } = useEstoquesSelect();

  const [uploadQueue, setUploadQueue] = useState<QueuedUploadFile[]>([]);
  const [isUploadingQueue, setIsUploadingQueue] = useState(false);
  const [programHint, setProgramHint] = useState<'' | DisecuritProgram>('');
  const [operationHint, setOperationHint] = useState('');
  const [cnpjHint, setCnpjHint] = useState('');

  const [sessionImportIds, setSessionImportIds] = useState<string[]>([]);
  const [dataReferenciaLote, setDataReferenciaLote] = useState('');
  const [preview, setPreview] = useState<OperationIaBatchPreviewResponse | null>(null);
  const [contasBancariasWorkspace, setContasBancariasWorkspace] = useState<OperationIaContaBancariaOption[]>([]);
  const [defaultContaBancariaId, setDefaultContaBancariaId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [items, setItems] = useState<EditableDraftItem[]>([]);
  const [baselineByItemId, setBaselineByItemId] = useState<Record<string, EditableDraftItem>>({});
  const [duplicateTestModeEnabled, setDuplicateTestModeEnabled] = useState<boolean>(
    resolveDuplicateTestModeClientDefault()
  );
  const [conflictOverrideDuplicateTestEnabled, setConflictOverrideDuplicateTestEnabled] = useState<boolean>(
    resolveConflictOverrideDuplicateTestClientDefault()
  );
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [reprocessingImportId, setReprocessingImportId] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<OperationIaBatchConfirmResponse | null>(null);
  const [activeFilter, setActiveFilter] = useState<RowFilter>('all');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [historyData, setHistoryData] = useState<OperationIaHistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [operacoesIaChatSessions, setOperacoesIaChatSessions] = useState<
    OperacoesIaChatSessionsApiResponse['data']
  >([]);
  const [operacoesIaChatSessionsLoading, setOperacoesIaChatSessionsLoading] = useState(false);
  const [copilotChatSessionId, setCopilotChatSessionId] = useState<string | null>(null);
  const [copilotThreadKey, setCopilotThreadKey] = useState('init');
  const [copilotSeedMessages, setCopilotSeedMessages] = useState<OperacoesIaCopilotMessage[] | null>(null);

  const imports = disecuritImport.importsQuery.data;
  const importsList = useMemo(() => imports || [], [imports]);

  const sessionImportsForCopilot = useMemo(() => {
    const byId = new Map(importsList.map((row) => [row.id, row]));
    return sessionImportIds.map((id) => {
      const row = byId.get(id);
      return {
        id,
        label: row?.original_filename || row?.operation_number || `${id.slice(0, 8)}…`,
        parse_status: row?.parse_status || 'received',
        linked_operacao_id: row?.linked_operacao_id ?? null,
      };
    });
  }, [sessionImportIds, importsList]);

  const uploadQueueForCopilot = useMemo<OperacoesIaUploadQueueItem[]>(
    () =>
      uploadQueue.map((item) => ({
        id: item.id,
        name: item.file.name,
        status: item.status,
        error_message: item.errorMessage,
        import_file_id: item.importFileId,
      })),
    [uploadQueue]
  );

  const sessionImportEligibility = useMemo<SessionImportEligibility[]>(() => {
    const byId = new Map(importsList.map((row) => [row.id, row]));

    return sessionImportIds.map((importId) => {
      const row = byId.get(importId);
      const label = row?.original_filename || row?.operation_number || `${importId.slice(0, 8)}…`;
      const parseStatus = row?.parse_status || 'missing';
      const linkedOperacaoId = row?.linked_operacao_id ?? null;

      if (!row) {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: false,
          reason: 'missing',
        };
      }

      if (linkedOperacaoId) {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: false,
          reason: 'linked',
        };
      }

      if (parseStatus === 'parsed' || parseStatus === 'parse_partial') {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: true,
          reason: null,
        };
      }

      if (parseStatus === 'received') {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: false,
          reason: 'received',
        };
      }

      if (parseStatus === 'processing') {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: false,
          reason: 'processing',
        };
      }

      if (parseStatus === 'failed') {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: false,
          reason: 'failed',
        };
      }

      if (parseStatus === 'duplicate') {
        return {
          id: importId,
          label,
          parseStatus,
          linkedOperacaoId,
          eligible: true,
          reason: null,
        };
      }

      return {
        id: importId,
        label,
        parseStatus,
        linkedOperacaoId,
        eligible: false,
        reason: 'other',
      };
    });
  }, [importsList, sessionImportIds]);

  const eligibleImportIds = useMemo(
    () => sessionImportEligibility.filter((item) => item.eligible).map((item) => item.id),
    [sessionImportEligibility]
  );

  const ineligibleImportGroups = useMemo(() => {
    const groups: Record<SessionImportEligibilityReason, SessionImportEligibility[]> = {
      linked: [],
      missing: [],
      received: [],
      processing: [],
      failed: [],
      duplicate: [],
      other: [],
    };

    for (const item of sessionImportEligibility) {
      if (!item.reason) continue;
      groups[item.reason].push(item);
    }

    return groups;
  }, [sessionImportEligibility]);

  useEffect(() => {
    if (!items.length) {
      setActiveItemId(null);
      return;
    }
    setActiveItemId((current) =>
      current && items.some((item) => item.id === current) ? current : items[0].id
    );
  }, [items]);

  const workspaceState: WorkspaceState = useMemo(() => {
    if (isLoadingPreview) return 'loading';
    if (previewError) return 'error';
    if (!preview) return 'no_context';
    if (!preview.items.length) return 'empty';
    return 'ready';
  }, [isLoadingPreview, previewError, preview]);

  const filteredItems = useMemo(() => getFilteredItems(items, activeFilter), [items, activeFilter]);

  const counts = useMemo(() => {
    const ready = items.filter((item) => item.status === 'ready').length;
    const review = items.filter((item) => item.status === 'review').length;
    const error = items.filter((item) => item.status === 'error').length;
    const created = items.filter((item) => item.runtime_status === 'created').length;
    const failed = items.filter((item) => item.runtime_status === 'failed').length;
    const ignored = items.filter((item) => item.runtime_status === 'ignored' || item.decision === 'ignore').length;
    return { ready, review, error, created, failed, ignored };
  }, [items]);

  const isValidIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  const revalidateItemSnapshot = useCallback((item: EditableDraftItem): EditableDraftItem => {
    const issues = buildValidationIssues(item, {
      duplicateTestModeEnabled,
      conflictOverrideDuplicateTestEnabled,
    });
    return {
      ...item,
      issues,
      status: deriveStatus(item, issues, { duplicateTestModeEnabled }),
    };
  }, [duplicateTestModeEnabled, conflictOverrideDuplicateTestEnabled]);

  const handleNovaSessao = () => {
    setSessionImportIds([]);
    setUploadQueue([]);
    setPreview(null);
    setContasBancariasWorkspace([]);
    setDefaultContaBancariaId(null);
    setItems([]);
    setBaselineByItemId({});
    setPreviewError(null);
    setConfirmResult(null);
    setActiveFilter('all');
    setEditingItemId(null);
    setActiveItemId(null);
    setOperationHint('');
    setCnpjHint('');
    setCopilotChatSessionId(null);
    setCopilotThreadKey(`ws-${Date.now()}`);
    setCopilotSeedMessages(null);
    toast.message('Nova sessão iniciada. Anexe os PDFs no copiloto e gere o preview no card principal.');
  };

  const handleAddFiles = useCallback((files: File[]) => {
    if (!files.length) return;

    setUploadQueue((current) => {
      const existingSignatures = new Set(current.map((item) => item.signature));
      const incoming: QueuedUploadFile[] = [];
      let ignoredDuplicates = 0;

      for (const file of files) {
        const signature = createUploadSignature(file);
        if (existingSignatures.has(signature)) {
          ignoredDuplicates += 1;
          continue;
        }
        existingSignatures.add(signature);
        incoming.push({
          id: createUploadId(),
          file,
          signature,
          status: 'queued',
          errorMessage: null,
          importFileId: null,
        });
      }

      if (!incoming.length) {
        toast.message('Esses arquivos já estão na fila.');
        return current;
      }

      const next = [...current, ...incoming];
      if (ignoredDuplicates > 0) {
        toast.message(
          `${incoming.length} arquivo(s) adicionado(s) na fila. ${ignoredDuplicates} duplicado(s) ignorado(s).`
        );
      } else {
        toast.success(`${incoming.length} arquivo(s) adicionado(s) na fila.`);
      }
      return next;
    });
  }, []);

  const uploadQueueItems = useCallback(
    async (targetItemIds: string[]) => {
      if (!targetItemIds.length) return;
      if (isUploadingQueue) return;

      if (!programHint) {
        toast.error('Selecione o programa SPPRO/SOI para enviar a fila.');
        return;
      }

      if (!dataReferenciaLote || !isValidIsoDate(dataReferenciaLote)) {
        toast.error('Informe a data do lote (obrigatória para envio).');
        return;
      }

      const targetSet = new Set(targetItemIds);
      const queueSnapshot = uploadQueue.filter((item) => targetSet.has(item.id));
      if (!queueSnapshot.length) {
        toast.error('Arquivo da fila não encontrado.');
        return;
      }

      setIsUploadingQueue(true);

      let successCount = 0;
      let failureCount = 0;

      for (const queueItem of queueSnapshot) {
        setUploadQueue((current) =>
          current.map((item) =>
            item.id === queueItem.id
              ? { ...item, status: 'uploading', errorMessage: null }
              : item
          )
        );

        try {
          const result = await disecuritImport.uploadImportMutation.mutateAsync({
            file: queueItem.file,
            hints: {
              operation_number: operationHint.trim() || undefined,
              client_cnpj: normalizeCnpjValue(cnpjHint) || undefined,
              program_hint: programHint,
              reference_date: dataReferenciaLote,
            },
          });

          const createdImportId = result?.importRow?.id ?? null;
          if (createdImportId) {
            setSessionImportIds((current) => Array.from(new Set([...current, createdImportId])));
          }

          setUploadQueue((current) =>
            current.map((item) =>
              item.id === queueItem.id
                ? {
                    ...item,
                    status: 'success',
                    errorMessage: null,
                    importFileId: createdImportId,
                  }
                : item
            )
          );
          successCount += 1;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erro ao enviar PDF.';
          setUploadQueue((current) =>
            current.map((item) =>
              item.id === queueItem.id
                ? {
                    ...item,
                    status: 'error',
                    errorMessage,
                  }
                : item
            )
          );
          failureCount += 1;
        }
      }

      setIsUploadingQueue(false);

      if (successCount && failureCount) {
        toast.warning(`Fila enviada parcialmente: ${successCount} sucesso(s), ${failureCount} falha(s).`);
      } else if (successCount) {
        toast.success(`Fila enviada com sucesso (${successCount} arquivo(s)).`);
      } else {
        toast.error('Não foi possível enviar os arquivos selecionados.');
      }

      if (successCount > 0) {
        setOperationHint('');
        setCnpjHint('');
      }
    },
    [
      cnpjHint,
      dataReferenciaLote,
      disecuritImport.uploadImportMutation,
      isUploadingQueue,
      operationHint,
      programHint,
      uploadQueue,
    ]
  );

  const handleUploadQueued = useCallback(async () => {
    const targetIds = uploadQueue
      .filter((item) => item.status === 'queued' || item.status === 'error')
      .map((item) => item.id);

    if (!targetIds.length) {
      toast.message('Não há arquivos pendentes/falhos na fila.');
      return;
    }

    await uploadQueueItems(targetIds);
  }, [uploadQueue, uploadQueueItems]);

  const handleRetryUpload = useCallback(
    async (itemId: string) => {
      const target = uploadQueue.find((item) => item.id === itemId);
      if (!target) {
        toast.error('Item da fila não encontrado para reenviar.');
        return;
      }

      setUploadQueue((current) =>
        current.map((item) =>
          item.id === itemId
            ? { ...item, status: 'queued', errorMessage: null }
            : item
        )
      );

      await uploadQueueItems([itemId]);
    },
    [uploadQueue, uploadQueueItems]
  );

  const handleRemoveUpload = useCallback((itemId: string) => {
    setUploadQueue((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const handleClearCompletedUploads = useCallback(() => {
    setUploadQueue((current) => current.filter((item) => item.status !== 'success'));
  }, []);

  const handleGeneratePreview = async () => {
    if (!sessionImportIds.length) {
      toast.error('Envie ao menos um PDF nesta sessão (copiloto) para gerar o preview.');
      return;
    }

    if (!eligibleImportIds.length) {
      setPreview(null);
      setItems([]);
      setPreviewError(
        'Nenhum import elegível para preview. Aguarde parse (parsed/parse_partial) e remova arquivos com falha/duplicidade/vínculo.'
      );
      toast.error('Sem imports elegíveis para preview.');
      return;
    }

    setIsLoadingPreview(true);
    setPreviewError(null);
    setConfirmResult(null);

    try {
      const response = await callOperacoesIaApi<OperationIaBatchPreviewResponse>(
        '/api/operacoes-ia/preview',
        {
          import_file_ids: eligibleImportIds,
          reference_date: isValidIsoDate(dataReferenciaLote) ? dataReferenciaLote : null,
        }
      );
      const duplicateModeFromResponse =
        typeof response.meta?.duplicate_test_mode_enabled === 'boolean'
          ? response.meta.duplicate_test_mode_enabled
          : duplicateTestModeEnabled;
      const conflictOverrideModeFromResponse =
        typeof response.meta?.conflict_override_duplicate_test_enabled === 'boolean'
          ? response.meta.conflict_override_duplicate_test_enabled
          : conflictOverrideDuplicateTestEnabled;
      if (typeof response.meta?.duplicate_test_mode_enabled === 'boolean') {
        setDuplicateTestModeEnabled(response.meta.duplicate_test_mode_enabled);
      }
      if (typeof response.meta?.conflict_override_duplicate_test_enabled === 'boolean') {
        setConflictOverrideDuplicateTestEnabled(response.meta.conflict_override_duplicate_test_enabled);
      }
      setPreview(response);
      setContasBancariasWorkspace(response.contas_bancarias || []);
      setDefaultContaBancariaId(response.default_conta_bancaria_id || null);
      const mappedItems = response.items.map((item) => {
        const autoIgnoreDuplicateInProduction = item.parse_status === 'duplicate' && !duplicateModeFromResponse;
        const baseItem: EditableDraftItem = {
          ...item,
          data_operacao: toDateInput(item.data_operacao),
          conta_bancaria_id: item.conta_bancaria_id || response.default_conta_bancaria_id || null,
          iof_adicional: item.iof_adicional ?? 0,
          recompra: item.recompra ?? 0,
          decision: autoIgnoreDuplicateInProduction ? 'ignore' : 'confirm',
          ignore_reason: autoIgnoreDuplicateInProduction ? buildDuplicateAutoIgnoreReason(item.import_file_id) : '',
          force_create: item.parse_status === 'duplicate' && duplicateModeFromResponse,
          force_create_reason:
            item.parse_status === 'duplicate' && duplicateModeFromResponse
              ? buildDuplicateAutoForceReason(item.import_file_id)
              : '',
          runtime_status: null,
          runtime_message: null,
        };

        const enrichedItem =
          baseItem.program === 'SOI'
            ? (() => {
                const soiFormula = ensureSoiFormula(baseItem);
                return {
                  ...baseItem,
                  soi_formula: soiFormula,
                  face_titulos: soiFormula.valor_original,
                  valor_compra: soiFormula.valor_desagio,
                  despesas: (soiFormula.despesas ?? 0) + (soiFormula.valor_desagio_antecipacao ?? 0),
                  recompra: soiFormula.regresso ?? 0,
                  amortizacao_debitos: (soiFormula.amortiza_debitos ?? 0) + (soiFormula.creditos_gerados ?? 0),
                  amortizacao_creditos: soiFormula.amortiza_creditos,
                };
              })()
            : baseItem.program === 'SPPRO'
              ? (() => {
                  const spproFormula = ensureSpproFormula(baseItem);
                  return {
                    ...baseItem,
                    sppro_formula: spproFormula,
                    face_titulos: spproFormula.valor_face,
                    valor_compra: spproFormula.valor_compra,
                    ad_valorem: spproFormula.ad_valorem,
                    iss: spproFormula.iss,
                    despesas: spproFormula.despesas,
                    iof: spproFormula.iof,
                    iof_adicional: spproFormula.iof_adicional,
                    recompra: spproFormula.recompra,
                  };
                })()
              : baseItem;

        const issues = buildValidationIssues(enrichedItem, {
          duplicateTestModeEnabled: duplicateModeFromResponse,
          conflictOverrideDuplicateTestEnabled: conflictOverrideModeFromResponse,
        });

        return {
          ...enrichedItem,
          issues,
          status: deriveStatus(enrichedItem, issues, { duplicateTestModeEnabled: duplicateModeFromResponse }),
        };
      });
      setItems(mappedItems);
      setBaselineByItemId(
        Object.fromEntries(
          mappedItems.map((item) => [
            item.id,
            {
              ...item,
              extraction_diagnostics: [...(item.extraction_diagnostics || [])],
              history_timeline: [...(item.history_timeline || [])],
            },
          ])
        )
      );
      setActiveFilter('all');
      setEditingItemId(null);
      if (eligibleImportIds.length !== sessionImportIds.length) {
        toast.warning(
          `Preview gerado apenas com elegíveis (${eligibleImportIds.length}/${sessionImportIds.length}). Revise os itens bloqueados no card Montar lote.`
        );
      }
      toast.success(`Preview gerado com ${response.summary.total} item(ns).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao gerar preview.';
      setPreviewError(message);
      toast.error(message);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleReprocessMissingOrigin = async (item: EditableDraftItem) => {
    if (!item.import_file_id) {
      toast.error('Import inválido para reprocessar.');
      return;
    }

    setReprocessingImportId(item.import_file_id);
    try {
      await disecuritImport.reprocessImportMutation.mutateAsync({
        importFileId: item.import_file_id,
        reason: 'Recuperação guiada de origem para duplicado no Operações com IA.',
        programHint: (item.program as DisecuritProgram | null) || (programHint || undefined),
      });
      await disecuritImport.importsQuery.refetch();
      await handleGeneratePreview();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao reprocessar import para recuperação de origem.';
      toast.error(message);
    } finally {
      setReprocessingImportId(null);
    }
  };

  const updateItem = (itemId: string, updater: (item: EditableDraftItem) => EditableDraftItem) => {
    setItems((current) => current.map((item) => (item.id === itemId ? updater(item) : item)));
  };

  const updateSoiFormulaField = (
    itemId: string,
    field: keyof OperationIaSoiFormula,
    value: number | null
  ) => {
    updateItem(itemId, (current) => {
      const currentFormula = ensureSoiFormula(current);
      const nextFormula: OperationIaSoiFormula = {
        ...currentFormula,
        [field]: value,
      };

      return {
        ...current,
        soi_formula: nextFormula,
        face_titulos: nextFormula.valor_original,
        valor_compra: nextFormula.valor_desagio,
        despesas: (nextFormula.despesas ?? 0) + (nextFormula.valor_desagio_antecipacao ?? 0),
        recompra: nextFormula.regresso ?? 0,
        amortizacao_debitos: (nextFormula.amortiza_debitos ?? 0) + (nextFormula.creditos_gerados ?? 0),
        amortizacao_creditos: nextFormula.amortiza_creditos ?? 0,
      };
    });
  };

  const updateSpproFormulaField = (
    itemId: string,
    field: keyof OperationIaSpproFormula,
    value: number | null
  ) => {
    updateItem(itemId, (current) => {
      const currentFormula = ensureSpproFormula(current);
      const nextFormula: OperationIaSpproFormula = {
        ...currentFormula,
        [field]: value,
      };

      return {
        ...current,
        sppro_formula: nextFormula,
        face_titulos: nextFormula.valor_face,
        valor_compra: nextFormula.valor_compra,
        ad_valorem: nextFormula.ad_valorem ?? 0,
        iss: nextFormula.iss ?? 0,
        despesas: nextFormula.despesas ?? 0,
        iof: nextFormula.iof ?? 0,
        iof_adicional: nextFormula.iof_adicional ?? 0,
        recompra: nextFormula.recompra ?? 0,
      };
    });
  };

  const handleRevalidateItem = (itemId: string) => {
    updateItem(itemId, revalidateItemSnapshot);
    toast.success('Item revalidado com as regras atuais.');
  };

  const handleToggleIgnore = (item: EditableDraftItem) => {
    if (item.decision === 'ignore') {
      updateItem(item.id, (current) => ({
        ...current,
        decision: 'confirm',
      }));
      return;
    }

    const reason = window.prompt('Informe a justificativa para ignorar este item:', item.ignore_reason || '');
    if (reason === null) return;

    if (!reason.trim()) {
      toast.error('Justificativa obrigatória para ignorar item.');
      return;
    }

    updateItem(item.id, (current) => ({
      ...current,
      decision: 'ignore',
      ignore_reason: reason.trim(),
    }));
  };

  const handleSaveEdit = async (itemId: string) => {
    const currentItem = items.find((item) => item.id === itemId);
    if (!currentItem) return;

    const updatedItem = revalidateItemSnapshot(currentItem);
    setItems((current) => current.map((item) => (item.id === itemId ? updatedItem : item)));
    setEditingItemId(null);

    const baseline = baselineByItemId[itemId];
    if (!baseline) {
      setBaselineByItemId((current) => ({ ...current, [itemId]: updatedItem }));
      toast.success('Alterações salvas.');
      return;
    }

    const fieldsToTrack: Array<{
      fieldName: string;
      getter: (item: EditableDraftItem) => unknown;
    }> = [
      { fieldName: 'face_titulos', getter: (item) => item.face_titulos },
      { fieldName: 'valor_compra', getter: (item) => item.valor_compra },
      { fieldName: 'despesas', getter: (item) => item.despesas },
      { fieldName: 'recompra', getter: (item) => item.recompra },
      { fieldName: 'ad_valorem', getter: (item) => item.ad_valorem },
      { fieldName: 'iss', getter: (item) => item.iss },
      { fieldName: 'iof', getter: (item) => item.iof },
      { fieldName: 'iof_adicional', getter: (item) => item.iof_adicional },
      { fieldName: 'amortizacao_debitos', getter: (item) => item.amortizacao_debitos },
      { fieldName: 'amortizacao_creditos', getter: (item) => item.amortizacao_creditos },
      { fieldName: 'soi_valor_original', getter: (item) => item.soi_formula?.valor_original ?? null },
      { fieldName: 'soi_valor_desagio', getter: (item) => item.soi_formula?.valor_desagio ?? null },
      { fieldName: 'soi_valor_desagio_antecipacao', getter: (item) => item.soi_formula?.valor_desagio_antecipacao ?? null },
      { fieldName: 'soi_despesas', getter: (item) => item.soi_formula?.despesas ?? null },
      { fieldName: 'soi_regresso', getter: (item) => item.soi_formula?.regresso ?? null },
      { fieldName: 'soi_amortiza_debitos', getter: (item) => item.soi_formula?.amortiza_debitos ?? null },
      { fieldName: 'soi_amortiza_creditos', getter: (item) => item.soi_formula?.amortiza_creditos ?? null },
      { fieldName: 'soi_creditos_gerados', getter: (item) => item.soi_formula?.creditos_gerados ?? null },
      { fieldName: 'soi_liquido_liberado', getter: (item) => item.soi_formula?.liquido_liberado ?? null },
      { fieldName: 'sppro_quantidade_titulos', getter: (item) => item.sppro_formula?.quantidade_titulos ?? null },
      { fieldName: 'sppro_valor_face', getter: (item) => item.sppro_formula?.valor_face ?? null },
      { fieldName: 'sppro_valor_compra', getter: (item) => item.sppro_formula?.valor_compra ?? null },
      { fieldName: 'sppro_ad_valorem', getter: (item) => item.sppro_formula?.ad_valorem ?? null },
      { fieldName: 'sppro_iss', getter: (item) => item.sppro_formula?.iss ?? null },
      { fieldName: 'sppro_despesas', getter: (item) => item.sppro_formula?.despesas ?? null },
      { fieldName: 'sppro_iof', getter: (item) => item.sppro_formula?.iof ?? null },
      { fieldName: 'sppro_iof_adicional', getter: (item) => item.sppro_formula?.iof_adicional ?? null },
      { fieldName: 'sppro_recompra', getter: (item) => item.sppro_formula?.recompra ?? null },
      { fieldName: 'sppro_liquido_operacao', getter: (item) => item.sppro_formula?.liquido_operacao ?? null },
      { fieldName: 'documento', getter: (item) => item.documento },
      { fieldName: 'data_operacao', getter: (item) => item.data_operacao },
    ];

    const events = fieldsToTrack
      .map((field) => {
        const previousValue = field.getter(baseline);
        const newValue = field.getter(updatedItem);
        const previousNumeric = toNumber(previousValue as unknown);
        const newNumeric = toNumber(newValue as unknown);
        const changedByNumber =
          previousNumeric !== null || newNumeric !== null
            ? previousNumeric === null ||
              newNumeric === null ||
              Math.abs(previousNumeric - newNumeric) > 0.005
            : false;
        const changedByText =
          String(previousValue ?? '').trim() !== String(newValue ?? '').trim();
        if (!changedByNumber && !changedByText) return null;
        return {
          import_file_id: updatedItem.import_file_id,
          item_id: updatedItem.id,
          field_name: field.fieldName,
          previous_value: previousValue ?? null,
          new_value: newValue ?? null,
          reason: 'save',
        };
      })
      .filter((event): event is NonNullable<typeof event> => Boolean(event));

    if (events.length > 0) {
      try {
        await callOperacoesIaApi<{ ok: boolean; inserted: number }>(
          '/api/operacoes-ia/history-event',
          { events }
        );
      } catch (error) {
        toast.warning(error instanceof Error ? error.message : 'Falha ao registrar histórico da edição.');
      }
    }

    setBaselineByItemId((current) => ({ ...current, [itemId]: updatedItem }));
    toast.success('Alterações salvas.');
  };

  const handleConfirmBatch = async () => {
    if (!items.length) {
      toast.error('Nenhum item carregado para confirmar.');
      return;
    }

    setIsConfirming(true);

    try {
      const response = await callOperacoesIaApi<OperationIaBatchConfirmResponse>(
        '/api/operacoes-ia/confirm',
        {
          items: items.map((item) => ({
            item_id: item.id,
            import_file_id: item.import_file_id,
            decision: item.decision,
            ignore_reason: item.ignore_reason || null,
            force_create: item.force_create,
            force_create_reason: item.force_create_reason || null,
            payload: {
              program: item.program,
              estoque_id: item.estoque_id,
              fornecedor_id: item.fornecedor_id,
              fornecedor_match_method: item.fornecedor_match_method,
              conta_bancaria_id: item.conta_bancaria_id,
              data_operacao: item.data_operacao,
              documento: item.documento,
              historico: item.historico,
              face_titulos: item.face_titulos,
              valor_compra: item.valor_compra,
              despesas: item.despesas,
              recompra: item.recompra,
              ad_valorem: item.ad_valorem,
              iss: item.iss,
              iof: item.iof,
              iof_adicional: item.iof_adicional,
              amortizacao_debitos: item.amortizacao_debitos,
              amortizacao_creditos: item.amortizacao_creditos,
              soi_formula: item.program === 'SOI' ? ensureSoiFormula(item) : null,
              sppro_formula: item.program === 'SPPRO' ? ensureSpproFormula(item) : null,
            },
          })),
        }
      );

      setConfirmResult(response);

      const resultByItemId = new Map(response.results.map((result) => [result.item_id, result]));
      setItems((current) =>
        current.map((item) => {
          const result = resultByItemId.get(item.id);
          if (!result) return item;

          if (result.status === 'created') {
            return {
              ...item,
              status: 'created',
              runtime_status: 'created',
              runtime_message: result.message || null,
            };
          }

          if (result.status === 'ignored') {
            return {
              ...item,
              status: 'ignored',
              runtime_status: 'ignored',
              runtime_message: result.message || null,
            };
          }

          const failureMessage = result.message || 'Falha ao processar item.';
          return {
            ...item,
            status: 'failed',
            runtime_status: 'failed',
            runtime_message: failureMessage,
            issues: Array.from(new Set([...(item.issues || []), failureMessage])),
          };
        })
      );

      if (response.summary.failed > 0) {
        setActiveFilter('failed');
      }

      toast.success(
        `Lote finalizado: ${response.summary.created} criado(s), ${response.summary.ignored} ignorado(s), ${response.summary.failed} falha(s).`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar lote.');
    } finally {
      setIsConfirming(false);
    }
  };

  const summaryCard = confirmResult?.summary;

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) ?? null,
    [items, activeItemId]
  );

  const handleStartNewCopilotChat = useCallback(() => {
    setCopilotChatSessionId(null);
    setCopilotThreadKey(`new-${Date.now()}`);
    setCopilotSeedMessages(null);
    setProgramHint('');
    setDataReferenciaLote('');
    setOperationHint('');
    setCnpjHint('');
  }, []);

  const loadOperacoesIaChatSessions = useCallback(async () => {
    setOperacoesIaChatSessionsLoading(true);
    try {
      const res = await callOperacoesIaApi<OperacoesIaChatSessionsApiResponse>(
        '/api/operacoes-ia/chat/sessions?limit=50',
        null,
        { method: 'GET' }
      );
      setOperacoesIaChatSessions(res.data || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao listar conversas.';
      toast.error(message);
    } finally {
      setOperacoesIaChatSessionsLoading(false);
    }
  }, []);

  const handleLoadOperacoesIaChatSession = useCallback(async (sessionId: string) => {
    try {
      const res = await callOperacoesIaApi<OperacoesIaChatMessagesApiResponse>(
        `/api/operacoes-ia/chat/messages?session_id=${encodeURIComponent(sessionId)}`,
        null,
        { method: 'GET' }
      );
      const sess = res.data.session;
      setCopilotChatSessionId(sess.id);
      const ph = sess.program_hint;
      if (ph === 'SPPRO' || ph === 'SOI') setProgramHint(ph);
      else setProgramHint('');
      setDataReferenciaLote(sess.reference_date ? String(sess.reference_date).slice(0, 10) : '');
      setOperationHint(sess.operation_hint || '');
      setCnpjHint(sess.cnpj_hint || '');
      const mapped: OperacoesIaCopilotMessage[] = (res.data.messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      }));
      setCopilotSeedMessages(mapped);
      setCopilotThreadKey(sess.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao carregar conversa.';
      toast.error(message);
    }
  }, []);

  const handleDeleteOperacoesIaChatSession = useCallback(
    async (sessionId: string) => {
      try {
        await callOperacoesIaApi(
          `/api/operacoes-ia/chat/sessions?session_id=${encodeURIComponent(sessionId)}`,
          null,
          { method: 'DELETE' }
        );
        setOperacoesIaChatSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (copilotChatSessionId === sessionId) {
          handleStartNewCopilotChat();
        }
        toast.success('Conversa removida do histórico.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao excluir conversa.';
        toast.error(message);
      }
    },
    [copilotChatSessionId, handleStartNewCopilotChat]
  );

  const handleCopilotSend = useCallback(
    async (text: string, context: Record<string, unknown>) => {
      const payload = await callOperacoesIaApi<{
        ok: boolean;
        reply: string;
        session_id?: string;
        suggested_actions?: unknown[];
      }>('/api/operacoes-ia/message', {
        message: text,
        session_id: copilotChatSessionId,
        context: {
          ...context,
          session_import_ids: sessionImportIds,
          reference_date: dataReferenciaLote || null,
          operation_hint: operationHint || null,
          cnpj_hint: cnpjHint || null,
        },
      });
      if (payload.session_id) setCopilotChatSessionId(payload.session_id);
      return { reply: payload.reply, session_id: payload.session_id ?? null };
    },
    [copilotChatSessionId, cnpjHint, dataReferenciaLote, operationHint, sessionImportIds]
  );

  const loadHistory = useCallback(async (forceRefresh = false) => {
    if (historyLoading) return;
    if (!forceRefresh && historyData) return;

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const payload = await callOperacoesIaApi<OperationIaHistoryResponse>(
        '/api/operacoes-ia/history?limit=200',
        null,
        { method: 'GET' }
      );
      setHistoryData(payload.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao carregar histórico diário.';
      setHistoryError(message);
      toast.error(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyData, historyLoading]);

  const handleOpenHistoryMenu = useCallback(() => {
    void loadHistory(false);
  }, [loadHistory]);

  const handleRefreshHistory = useCallback(() => {
    void loadHistory(true);
  }, [loadHistory]);

  const copilotPanel = (
    <OperacoesIaCopilotPanel
      className="h-full min-h-0 flex-1"
      batchId={preview?.batch_id ?? null}
      activeItem={
        activeItem
          ? {
              id: activeItem.id,
              import_file_id: activeItem.import_file_id,
              original_filename: activeItem.original_filename,
              program: activeItem.program,
              status: activeItem.runtime_status || activeItem.status,
              face_titulos: activeItem.face_titulos,
              valor_compra: activeItem.valor_compra,
              documento: activeItem.documento,
              data_operacao: activeItem.data_operacao,
            }
          : null
      }
      counts={{
        total: items.length,
        ready: counts.ready,
        review: counts.review,
        error: counts.error,
        created: counts.created,
        failed: counts.failed,
        ignored: counts.ignored,
      }}
      lastSummary={confirmResult?.summary ?? null}
      onSendApi={handleCopilotSend}
      programHint={programHint}
      onProgramHintChange={setProgramHint}
      dataReferenciaLote={dataReferenciaLote}
      onDataReferenciaLoteChange={setDataReferenciaLote}
      operationHint={operationHint}
      onOperationHintChange={setOperationHint}
      cnpjHint={cnpjHint}
      onCnpjHintChange={setCnpjHint}
      uploadQueue={uploadQueueForCopilot}
      onAddFiles={handleAddFiles}
      onUploadQueued={() => void handleUploadQueued()}
      onRetryUpload={(itemId) => void handleRetryUpload(itemId)}
      onRemoveUpload={handleRemoveUpload}
      onClearCompleted={handleClearCompletedUploads}
      uploadPending={isUploadingQueue}
      sessionImports={sessionImportsForCopilot}
      historyData={historyData}
      historyLoading={historyLoading}
      historyError={historyError}
      onOpenHistoryMenu={handleOpenHistoryMenu}
      onRefreshHistory={handleRefreshHistory}
      copilotThreadKey={copilotThreadKey}
      copilotSeedMessages={copilotSeedMessages}
      chatSessions={operacoesIaChatSessions}
      chatSessionsLoading={operacoesIaChatSessionsLoading}
      onOpenChatSessionsMenu={loadOperacoesIaChatSessions}
      onLoadChatSession={handleLoadOperacoesIaChatSession}
      onDeleteChatSession={handleDeleteOperacoesIaChatSession}
      onStartNewChatConversation={handleStartNewCopilotChat}
      selectedItemDetailContent={
        activeItem ? (
          <OperacoesIaSelectedItemDiagnostics
            item={activeItem}
            duplicateTestModeEnabled={duplicateTestModeEnabled}
          />
        ) : null
      }
    />
  );

  return (
    <>
      <FinanceiroWorkspaceShell sidebar={copilotPanel}>
        <div className="shrink-0 border-b border-border/70 px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">Operações com IA</h1>
                {preview?.batch_id ? (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {preview.batch_id}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>PDFs na sessão {sessionImportIds.length}</span>
                <span>Prontos {counts.ready}</span>
                <span>Revisão {counts.review}</span>
                <span>Erros {counts.error}</span>
                <span>Pós-lote: criados {counts.created}</span>
                <span>falhas {counts.failed}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 xl:hidden"
                onClick={() => setChatDrawerOpen(true)}
              >
                <MessageSquareText className="h-4 w-4" />
                Copiloto
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmBatch}
                disabled={isConfirming || !items.length || workspaceState !== 'ready'}
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirmando…
                  </>
                ) : (
                  'Confirmar lote'
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 p-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Montar lote</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anexe os PDFs no copiloto (aba Entrada). Aqui você monta o preview só com os arquivos desta sessão.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleNovaSessao}>
                  <RotateCcw className="h-4 w-4" />
                  Nova sessão
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleGeneratePreview()}
                  disabled={isLoadingPreview || eligibleImportIds.length === 0}
                >
                  {isLoadingPreview ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Gerando preview…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Gerar preview do lote
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
                <span>
                  Programa (copiloto):{' '}
                  <strong className="text-foreground">{programHint || '—'}</strong>
                </span>
                <span>
                  Data do lote:{' '}
                  <strong className="text-foreground">
                    {dataReferenciaLote && isValidIsoDate(dataReferenciaLote)
                      ? dataReferenciaLote
                      : '—'}
                  </strong>
                </span>
                <span>
                  PDFs na sessão: <strong className="text-foreground">{sessionImportIds.length}</strong>
                </span>
                <span>
                  Elegíveis p/ preview:{' '}
                  <strong className="text-foreground">{eligibleImportIds.length}</strong>
                </span>
              </div>
              {sessionImportIds.length > 0 ? (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Gate de preview</p>
                  <p className="mt-1">
                    Apenas imports com status <strong>parsed</strong> ou <strong>parse_partial</strong> e sem vínculo
                    prévio entram no preview.
                  </p>
                  {duplicateTestModeEnabled ? (
                    <p className="mt-1 text-amber-700">
                      Duplicado liberado apenas para teste, confirmação exige <strong>force_create</strong> com
                      justificativa.
                    </p>
                  ) : (
                    <p className="mt-1 text-muted-foreground">
                      Duplicados entram no preview e serão <strong>ignorados automaticamente</strong> na confirmação em
                      produção.
                    </p>
                  )}
                  {sessionImportIds.length !== eligibleImportIds.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {ineligibleImportGroups.processing.length > 0 ? (
                        <li>
                          {ineligibleImportGroups.processing.length} em <strong>processamento</strong>.
                        </li>
                      ) : null}
                      {ineligibleImportGroups.received.length > 0 ? (
                        <li>
                          {ineligibleImportGroups.received.length} em <strong>recebido</strong> (aguardando parse).
                        </li>
                      ) : null}
                      {ineligibleImportGroups.failed.length > 0 ? (
                        <li>
                          {ineligibleImportGroups.failed.length} com <strong>falha de parse</strong>.
                        </li>
                      ) : null}
                      {ineligibleImportGroups.duplicate.length > 0 ? (
                        <li>
                          {ineligibleImportGroups.duplicate.length} marcados como <strong>duplicados</strong>.
                        </li>
                      ) : null}
                      {ineligibleImportGroups.linked.length > 0 ? (
                        <li>
                          {ineligibleImportGroups.linked.length} já <strong>vinculados a operação</strong>.
                        </li>
                      ) : null}
                      {ineligibleImportGroups.missing.length > 0 ? (
                        <li>
                          {ineligibleImportGroups.missing.length} não encontrados no escopo atual.
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="mt-1 text-emerald-700">Todos os imports da sessão estão elegíveis para preview.</p>
                  )}
                  {sessionImportIds.length !== eligibleImportIds.length ? (
                    <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-background/70 p-2">
                      {sessionImportEligibility
                        .filter((row) => !row.eligible)
                        .slice(0, 3)
                        .map((row) => (
                          <p key={`blocked-${row.id}`} className="truncate">
                            <strong>{row.label}</strong> — {parseStatusLabel(row.parseStatus)}
                            {row.linkedOperacaoId ? ` (op. #${row.linkedOperacaoId})` : ''}
                          </p>
                        ))}
                      {sessionImportEligibility.filter((row) => !row.eligible).length > 3 ? (
                        <p>…e outros itens bloqueados.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {disecuritImport.importsQuery.isFetching ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Atualizando status dos uploads…
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base">Workspace de Revisão</CardTitle>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                  value={activeFilter}
                  onChange={(event) => setActiveFilter(event.target.value as RowFilter)}
                >
                  <option value="all">Todos</option>
                  <option value="ready">Prontos</option>
                  <option value="review">Revisão</option>
                  <option value="error">Erro</option>
                  <option value="created">Criados</option>
                  <option value="failed">Falhas</option>
                  <option value="ignored">Ignorados</option>
                </select>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {workspaceState === 'no_context' && (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Envie PDFs no copiloto (aba Entrada), depois use <strong>Montar lote</strong> para gerar o preview e iniciar a
                  revisão.
                </div>
              )}

              {workspaceState === 'loading' && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Montando lote de revisão...
                </div>
              )}

              {workspaceState === 'error' && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {previewError || 'Falha ao carregar workspace.'}
                </div>
              )}

              {workspaceState === 'empty' && (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nenhum item retornado para o lote selecionado.
                </div>
              )}

              {workspaceState === 'ready' && (
                <>
                  {filteredItems.length === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Nenhum item no filtro atual.
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const isEditing = editingItemId === item.id;
                      const isReprocessingThisItem =
                        reprocessingImportId === item.import_file_id &&
                        disecuritImport.reprocessImportMutation.isPending;
                      const stockOptions = estoques.filter(
                        (stock) => String(stock.tipo || '').toUpperCase() === String(item.program || '').toUpperCase()
                      );

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'space-y-3 rounded-lg border p-4 transition-shadow',
                            activeItemId === item.id
                              ? 'border-primary ring-2 ring-primary/30'
                              : 'border-muted/60'
                          )}
                        >
                          <div
                            className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-md p-1 -m-1 hover:bg-muted/30"
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveItemId(item.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setActiveItemId(item.id);
                              }
                            }}
                          >
                            <div>
                              <p className="text-sm font-medium">{item.original_filename || item.import_file_id}</p>
                              <p className="text-xs text-muted-foreground">Import: {item.import_file_id}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Programa</Label>
                              <select
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                value={item.program || ''}
                                disabled={!isEditing}
                                onChange={(event) => {
                                  const newProgram = (event.target.value || null) as EditableDraftItem['program'];
                                  updateItem(item.id, (current) => {
                                    const availableStocks = estoques.filter(
                                      (stock) =>
                                        String(stock.tipo || '').toUpperCase() === String(newProgram || '').toUpperCase()
                                    );
                                    const firstStock = availableStocks[0]?.id || null;
                                    const nextSoiFormula =
                                      newProgram === 'SOI' ? ensureSoiFormula(current) : current.soi_formula || null;
                                    const nextSpproFormula =
                                      newProgram === 'SPPRO' ? ensureSpproFormula(current) : current.sppro_formula || null;
                                    return {
                                      ...current,
                                      program: newProgram,
                                      estoque_id: firstStock,
                                      soi_formula: nextSoiFormula,
                                      sppro_formula: nextSpproFormula,
                                    };
                                  });
                                }}
                              >
                                <option value="">Selecione...</option>
                                <option value="SPPRO">SPPRO</option>
                                <option value="SOI">SOI</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Conta bancária</Label>
                              <select
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                value={item.conta_bancaria_id || ''}
                                disabled={!isEditing}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    conta_bancaria_id: event.target.value || null,
                                  }))
                                }
                              >
                                <option value="">Selecione...</option>
                                {contasBancariasWorkspace.map((conta) => (
                                  <option key={conta.id} value={conta.id}>
                                    {conta.descricao}
                                    {conta.id === defaultContaBancariaId ? ' (padrão)' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Fornecedor</Label>
                              <select
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                value={item.fornecedor_id || ''}
                                disabled={!isEditing}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    fornecedor_id: event.target.value || null,
                                    fornecedor_match_method: 'manual',
                                    fornecedor_match_confidence: null,
                                  }))
                                }
                              >
                                <option value="">Selecione...</option>
                                {fornecedores.map((fornecedor) => (
                                  <option key={fornecedor.id} value={fornecedor.id}>
                                    {fornecedor.razao_social}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Estoque</Label>
                              <select
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                value={item.estoque_id ? String(item.estoque_id) : ''}
                                disabled={!isEditing}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    estoque_id: event.target.value ? Number(event.target.value) : null,
                                  }))
                                }
                              >
                                <option value="">Selecione...</option>
                                {stockOptions.map((stock) => (
                                  <option key={stock.id} value={String(stock.id)}>
                                    {stock.descricao || `Estoque #${stock.id}`}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Data</Label>
                              <Input
                                type="date"
                                value={toDateInput(item.data_operacao)}
                                disabled={!isEditing}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    data_operacao: event.target.value || null,
                                  }))
                                }
                              />
                            </div>
                            {item.program === 'SOI' ? (
                              <>
                                <div className="md:col-span-3 rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">
                                  Fórmula SOI (espelho do PDF): edite os campos para resolver conflito crítico de extração.
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(+ ) Valor Original</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.valor_original ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'valor_original', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de Deságio</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.valor_desagio ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'valor_desagio', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de Deságio Antecipação</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.valor_desagio_antecipacao ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'valor_desagio_antecipacao', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(* ) Despesas</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.despesas ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'despesas', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Regresso</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.regresso ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'regresso', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Amortiza débitos</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.amortiza_debitos ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'amortiza_debitos', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(+ ) Amortiza créditos</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.amortiza_creditos ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'amortiza_creditos', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Créditos gerados</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.creditos_gerados ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'creditos_gerados', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(= ) Líquido Liberado</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.soi_formula?.liquido_liberado ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSoiFormulaField(item.id, 'liquido_liberado', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                              </>
                            ) : item.program === 'SPPRO' ? (
                              <>
                                <div className="md:col-span-3 rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">
                                  Fórmula SPPRO (espelho do PDF): use os campos com sinal (+/-/=) para revisar e confirmar.
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Quantidade de Títulos</Label>
                                  <Input
                                    type="number"
                                    step="1"
                                    value={item.sppro_formula?.quantidade_titulos ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'quantidade_titulos', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(+ ) Valor de Face dos Títulos</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.valor_face ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'valor_face', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de Compra</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.valor_compra ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'valor_compra', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de Ad-valorem</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.ad_valorem ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'ad_valorem', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de ISS</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.iss ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'iss', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de Despesas</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.despesas ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'despesas', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de IOF</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.iof ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'iof', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de IOF Adicional</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.iof_adicional ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'iof_adicional', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(- ) Valor de Recompra</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.recompra ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'recompra', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">(= ) Valor Líquido da Operação</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.sppro_formula?.liquido_operacao ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateSpproFormulaField(item.id, 'liquido_operacao', toNumber(event.target.value))
                                    }
                                  />
                                </div>
                                <div className="md:col-span-3 rounded-md border border-dashed border-border/60 bg-muted/10 p-2">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Avançado
                                  </p>
                                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Amort. débitos</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={item.amortizacao_debitos ?? ''}
                                        disabled={!isEditing}
                                        onChange={(event) =>
                                          updateItem(item.id, (current) => ({
                                            ...current,
                                            amortizacao_debitos: toNumber(event.target.value),
                                          }))
                                        }
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Amort. créditos</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={item.amortizacao_creditos ?? ''}
                                        disabled={!isEditing}
                                        onChange={(event) =>
                                          updateItem(item.id, (current) => ({
                                            ...current,
                                            amortizacao_creditos: toNumber(event.target.value),
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="space-y-1">
                                  <Label className="text-xs">Face títulos</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.face_titulos ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateItem(item.id, (current) => ({
                                        ...current,
                                        face_titulos: toNumber(event.target.value),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Valor compra/líquido</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.valor_compra ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateItem(item.id, (current) => ({
                                        ...current,
                                        valor_compra: toNumber(event.target.value),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Despesas</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={item.despesas ?? ''}
                                    disabled={!isEditing}
                                    onChange={(event) =>
                                      updateItem(item.id, (current) => ({
                                        ...current,
                                        despesas: toNumber(event.target.value),
                                      }))
                                    }
                                  />
                                </div>
                              </>
                            )}
                            <div className="space-y-1 md:col-span-2">
                              <Label className="text-xs">Documento</Label>
                              <Input
                                value={item.documento || ''}
                                disabled={!isEditing}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    documento: event.target.value || null,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1 md:col-span-3">
                              <Label className="text-xs">Histórico</Label>
                              <Textarea
                                rows={2}
                                value={item.historico || ''}
                                disabled={!isEditing}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    historico: event.target.value || null,
                                  }))
                                }
                              />
                            </div>
                          </div>

                          {duplicateTestModeEnabled && item.parse_status === 'duplicate' ? (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div className="flex items-center gap-2">
                                <input
                                  id={`force-${item.id}`}
                                  type="checkbox"
                                  checked={item.force_create}
                                  onChange={(event) =>
                                    updateItem(item.id, (current) => ({
                                      ...current,
                                      force_create: event.target.checked,
                                      force_create_reason:
                                        event.target.checked && !String(current.force_create_reason || '').trim()
                                          ? buildDuplicateAutoForceReason(current.import_file_id)
                                          : current.force_create_reason,
                                    }))
                                  }
                                />
                                <Label htmlFor={`force-${item.id}`} className="text-xs">
                                  Permitir force_create (duplicidade) com justificativa
                                </Label>
                              </div>
                              <Input
                                placeholder="Justificativa force_create"
                                value={item.force_create_reason}
                                onChange={(event) =>
                                  updateItem(item.id, (current) => ({
                                    ...current,
                                    force_create_reason: event.target.value,
                                  }))
                                }
                                disabled={!item.force_create}
                              />
                            </div>
                          ) : null}

                          {item.decision === 'ignore' ? (
                            <Input
                              placeholder="Justificativa do ignore (obrigatória)"
                              value={item.ignore_reason}
                              onChange={(event) =>
                                updateItem(item.id, (current) => ({
                                  ...current,
                                  ignore_reason: event.target.value,
                                }))
                              }
                            />
                          ) : null}

                          <div className="flex flex-wrap gap-2">
                            {isEditing ? (
                              <>
                                <Button type="button" size="sm" onClick={() => void handleSaveEdit(item.id)}>
                                  Salvar alterações
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => setEditingItemId(null)}>
                                  Cancelar edição
                                </Button>
                              </>
                            ) : (
                              <Button type="button" size="sm" variant="outline" onClick={() => setEditingItemId(item.id)}>
                                Editar
                              </Button>
                            )}

                            <Button type="button" size="sm" variant="outline" onClick={() => handleRevalidateItem(item.id)}>
                              Revalidar
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant={item.decision === 'ignore' ? 'secondary' : 'outline'}
                              onClick={() => handleToggleIgnore(item)}
                              disabled={item.parse_status === 'duplicate' && !duplicateTestModeEnabled}
                            >
                              {item.parse_status === 'duplicate' && !duplicateTestModeEnabled
                                ? 'Ignorado automaticamente (produção)'
                                : item.decision === 'ignore'
                                  ? 'Voltar para confirmar'
                                  : 'Ignorar'}
                            </Button>

                            {duplicateTestModeEnabled &&
                            item.parse_status === 'duplicate' &&
                            item.duplicate_hydration_status === 'missing' ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="warning"
                                onClick={() => void handleReprocessMissingOrigin(item)}
                                disabled={isReprocessingThisItem}
                              >
                                {isReprocessingThisItem ? 'Reprocessando...' : 'Reprocessar import'}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {confirmResult?.summary.failed ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800">
              Lote parcial: o filtro foi movido para <strong>Falhas</strong>. Valor criado{' '}
              {formatCurrency(summaryCard?.value_total_created || 0)} · tempo{' '}
              {summaryCard?.processing_time_ms ? `${summaryCard.processing_time_ms} ms` : '—'}
            </div>
          ) : null}
          </div>
        </div>
      </FinanceiroWorkspaceShell>

      <Sheet open={chatDrawerOpen} onOpenChange={setChatDrawerOpen} modal={false}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col p-0 sm:max-w-[380px]"
          title="Copiloto — Operações com IA"
          description="Entrada de PDFs, programa, data do lote e assistente para revisão."
        >
          {copilotPanel}
        </SheetContent>
      </Sheet>
    </>
  );
}
