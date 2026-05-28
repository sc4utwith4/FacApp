import type { SupabaseClient } from '@supabase/supabase-js';

export type BankAiExecutionRunStatus =
  | 'triggered'
  | 'processing'
  | 'completed'
  | 'no_pending'
  | 'failed'
  | 'timeout';

export interface BankAiExecutionRunCounts {
  sugestoes_total?: number;
  match_existing_count?: number;
  create_new_count?: number;
  ignore_count?: number;
  needs_review_count?: number;
}

export interface BankAiExecutionRunRow {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  extrato_import_id: string;
  correlation_id: string;
  trigger_source: string;
  status: BankAiExecutionRunStatus;
  sugestoes_total: number;
  match_existing_count: number;
  create_new_count: number;
  ignore_count: number;
  needs_review_count: number;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

type StatusTransitionDecision = {
  nextStatus: BankAiExecutionRunStatus;
  ignoredRequestedStatus: BankAiExecutionRunStatus | null;
  ignoredReason?: string;
};

type ResolvedCounts = {
  sugestoes_total: number;
  match_existing_count: number;
  create_new_count: number;
  ignore_count: number;
  needs_review_count: number;
};

const TERMINAL_STATUSES = new Set<BankAiExecutionRunStatus>(['completed', 'no_pending', 'failed']);

const isTerminalStatus = (status: BankAiExecutionRunStatus): boolean => TERMINAL_STATUSES.has(status);

const toNonNegativeInt = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
};

export function resolveBankAiExecutionRunCountsUpdate(args: {
  existing: ResolvedCounts;
  incoming?: BankAiExecutionRunCounts;
  ignoredTerminalTransition?: boolean;
}): ResolvedCounts {
  const pick = (key: keyof ResolvedCounts): number => {
    const existingValue = toNonNegativeInt(args.existing[key]);
    const incomingValue = args.incoming?.[key];
    if (incomingValue == null) return existingValue;
    const normalizedIncoming = toNonNegativeInt(incomingValue);
    return args.ignoredTerminalTransition
      ? Math.max(existingValue, normalizedIncoming)
      : normalizedIncoming;
  };

  return {
    sugestoes_total: pick('sugestoes_total'),
    match_existing_count: pick('match_existing_count'),
    create_new_count: pick('create_new_count'),
    ignore_count: pick('ignore_count'),
    needs_review_count: pick('needs_review_count'),
  };
}

export function generateBankAiExecutionCorrelationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `bank-ai-${ts}-${rand}`;
}

export function resolveBankAiExecutionRunStatusTransition(
  currentStatus: BankAiExecutionRunStatus,
  requestedStatus?: BankAiExecutionRunStatus
): StatusTransitionDecision {
  if (!requestedStatus || requestedStatus === currentStatus) {
    return {
      nextStatus: currentStatus,
      ignoredRequestedStatus: null,
    };
  }

  if (requestedStatus === 'failed') {
    return {
      nextStatus: 'failed',
      ignoredRequestedStatus: null,
    };
  }

  if (currentStatus === 'failed') {
    return {
      nextStatus: currentStatus,
      ignoredRequestedStatus: requestedStatus,
      ignoredReason: 'failed_terminal_dominant',
    };
  }

  if (currentStatus === 'completed' || currentStatus === 'no_pending') {
    return {
      nextStatus: currentStatus,
      ignoredRequestedStatus: requestedStatus,
      ignoredReason: 'terminal_status_locked',
    };
  }

  if (
    (currentStatus === 'processing' || currentStatus === 'timeout') &&
    requestedStatus === 'triggered'
  ) {
    return {
      nextStatus: currentStatus,
      ignoredRequestedStatus: requestedStatus,
      ignoredReason: 'cannot_regress_to_triggered',
    };
  }

  return {
    nextStatus: requestedStatus,
    ignoredRequestedStatus: null,
  };
}

export async function createBankAiExecutionRun(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  extratoImportId: string;
  triggerSource: string;
  correlationId?: string;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<BankAiExecutionRunRow> {
  const correlationId = args.correlationId || generateBankAiExecutionCorrelationId();
  const { data, error } = await args.adminClient
    .from('bank_ai_execution_runs')
    .insert({
      empresa_id: args.empresaId,
      conta_bancaria_id: args.contaBancariaId,
      extrato_import_id: args.extratoImportId,
      correlation_id: correlationId,
      trigger_source: args.triggerSource,
      status: 'triggered',
      metadata: args.metadata || {},
      created_by: args.createdBy || null,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Falha ao registrar execução IA: ${error.message}`);
  }

  return data as BankAiExecutionRunRow;
}

export async function getBankAiExecutionRunByCorrelation(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  correlationId: string;
}): Promise<BankAiExecutionRunRow | null> {
  const { data, error } = await args.adminClient
    .from('bank_ai_execution_runs')
    .select('*')
    .eq('empresa_id', args.empresaId)
    .eq('correlation_id', args.correlationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar execução IA por correlação: ${error.message}`);
  }

  return data ? (data as BankAiExecutionRunRow) : null;
}

export async function getLatestBankAiExecutionRunForContext(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  extratoImportId?: string | null;
}): Promise<BankAiExecutionRunRow | null> {
  let query = args.adminClient
    .from('bank_ai_execution_runs')
    .select('*')
    .eq('empresa_id', args.empresaId)
    .eq('conta_bancaria_id', args.contaBancariaId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (args.extratoImportId) {
    query = query.eq('extrato_import_id', args.extratoImportId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Falha ao carregar última execução IA: ${error.message}`);
  }
  return data ? (data as BankAiExecutionRunRow) : null;
}

export async function updateBankAiExecutionRunStatus(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  correlationId: string;
  status?: BankAiExecutionRunStatus;
  errorMessage?: string | null;
  metadataPatch?: Record<string, unknown>;
  counts?: BankAiExecutionRunCounts;
  setCompletedAt?: boolean;
}): Promise<BankAiExecutionRunRow | null> {
  const existing = await getBankAiExecutionRunByCorrelation({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    correlationId: args.correlationId,
  });

  if (!existing) return null;

  const transition = resolveBankAiExecutionRunStatusTransition(existing.status, args.status);
  const nextStatus = transition.nextStatus;
  const ignoredTransition =
    transition.ignoredRequestedStatus && transition.ignoredRequestedStatus !== existing.status
      ? {
          requested_status: transition.ignoredRequestedStatus,
          current_status: existing.status,
          kept_status: nextStatus,
          reason: transition.ignoredReason || 'transition_blocked',
          callback_at: new Date().toISOString(),
        }
      : null;

  const mergedMetadata = {
    ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
    ...(args.metadataPatch || {}),
    ...(ignoredTransition
      ? {
          ignored_status_transition: ignoredTransition,
        }
      : {}),
  };

  const nextCounts = resolveBankAiExecutionRunCountsUpdate({
    existing: {
      sugestoes_total: existing.sugestoes_total,
      match_existing_count: existing.match_existing_count,
      create_new_count: existing.create_new_count,
      ignore_count: existing.ignore_count,
      needs_review_count: existing.needs_review_count,
    },
    incoming: args.counts,
    ignoredTerminalTransition: Boolean(ignoredTransition),
  });

  const statusChanged = nextStatus !== existing.status;
  const shouldMarkCompleted =
    !ignoredTransition &&
    (statusChanged
      ? isTerminalStatus(nextStatus) || nextStatus === 'timeout'
      : false);
  const shouldClearCompletedAt = statusChanged && (nextStatus === 'triggered' || nextStatus === 'processing');

  const { data, error } = await args.adminClient
    .from('bank_ai_execution_runs')
    .update({
      status: nextStatus,
      error_message:
        args.errorMessage !== undefined
          ? (args.errorMessage || null)
          : existing.error_message,
      metadata: mergedMetadata,
      sugestoes_total: nextCounts.sugestoes_total,
      match_existing_count: nextCounts.match_existing_count,
      create_new_count: nextCounts.create_new_count,
      ignore_count: nextCounts.ignore_count,
      needs_review_count: nextCounts.needs_review_count,
      ...(shouldMarkCompleted
        ? { completed_at: new Date().toISOString() }
        : shouldClearCompletedAt
          ? { completed_at: null }
          : {}),
    })
    .eq('id', existing.id)
    .eq('empresa_id', args.empresaId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Falha ao atualizar execução IA: ${error.message}`);
  }

  return data as BankAiExecutionRunRow;
}

export async function incrementBankAiExecutionRunCounts(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  correlationId: string;
  increments: BankAiExecutionRunCounts;
  status?: BankAiExecutionRunStatus;
  metadataPatch?: Record<string, unknown>;
  setCompletedAt?: boolean;
}): Promise<BankAiExecutionRunRow | null> {
  const existing = await getBankAiExecutionRunByCorrelation({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    correlationId: args.correlationId,
  });

  if (!existing) return null;

  return updateBankAiExecutionRunStatus({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    correlationId: args.correlationId,
    status: args.status,
    metadataPatch: args.metadataPatch,
    setCompletedAt: args.setCompletedAt,
    counts: {
      sugestoes_total: toNonNegativeInt(existing.sugestoes_total) + toNonNegativeInt(args.increments.sugestoes_total),
      match_existing_count:
        toNonNegativeInt(existing.match_existing_count) + toNonNegativeInt(args.increments.match_existing_count),
      create_new_count:
        toNonNegativeInt(existing.create_new_count) + toNonNegativeInt(args.increments.create_new_count),
      ignore_count: toNonNegativeInt(existing.ignore_count) + toNonNegativeInt(args.increments.ignore_count),
      needs_review_count:
        toNonNegativeInt(existing.needs_review_count) + toNonNegativeInt(args.increments.needs_review_count),
    },
  });
}
