import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatPlanConfidenceBand,
  ChatReconciliationPlan,
  ChatReviewDecision,
  ChatReviewGuidance,
  ChatReviewQueueItem,
  ChatReviewQuickAction,
} from '../../../types/bank-reconciliation.js';

type ReviewSourceAction = 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
type ReviewStatus = 'pending' | 'asked' | 'resolved' | 'deferred' | 'blocked';
type ReviewBatchClass = 'safe_match' | 'auto_divergence' | 'exception';

export interface ReviewQueueRow {
  id: string;
  empresa_id: string;
  session_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  suggestion_id: string;
  extrato_transacao_id: string;
  source_action: ReviewSourceAction;
  review_status: ReviewStatus;
  decision: ChatReviewDecision | null;
  justification: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  asked_count: number;
  last_asked_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ReviewCandidate {
  suggestion_id: string;
  extrato_transacao_id: string;
  source_action: ReviewSourceAction;
  item_financeiro_id: string | null;
  confidence: number | null;
  confidence_band: ChatPlanConfidenceBand;
  descricao: string;
  data_movimento: string;
  valor_centavos: number;
  question: string;
  rationale: string | null;
}

interface SuggestedItemSnapshot {
  id: string;
  data: string;
  valor_centavos: number;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const confidenceBand = (value: number | null | undefined): ChatPlanConfidenceBand => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 0.85) return 'high';
  if (n >= 0.6) return 'medium';
  return 'low';
};

const looksEnglishRationale = (value: string): boolean =>
  /\b(transaction|candidate|description|match|suggest(?:ed|ion)?|review|confidence|date|amount|same value|same date)\b/i.test(
    value
  );

const normalizeRationalePtBr = (
  action: ReviewSourceAction,
  rawRationale: string | null | undefined
): string | null => {
  const trimmed = String(rawRationale || '').trim();
  if (!trimmed) {
    if (action === 'create_new') {
      return 'Sem vínculo automático confiável neste contexto. Nesta fase, você decide apenas divergência ou revisão manual.';
    }
    if (action === 'needs_review') {
      return 'A sugestão precisa de validação manual antes de confirmar.';
    }
    if (action === 'match_existing') {
      return 'A sugestão de vínculo está com baixa confiança. Valide antes de confirmar.';
    }
    if (action === 'ignore') {
      return 'A IA sugeriu marcar como divergência; confirme com justificativa.';
    }
    return null;
  }

  if (!looksEnglishRationale(trimmed)) return trimmed;

  if (action === 'create_new') {
    return 'Sem vínculo automático confiável neste contexto. Nesta fase, você decide apenas divergência ou revisão manual.';
  }
  if (action === 'needs_review') {
    return 'A transação e o candidato não têm correspondência suficiente para confirmação automática. Revise manualmente este item.';
  }
  if (action === 'match_existing') {
    return 'A sugestão de vínculo está com baixa confiança para confirmação automática. Valide o código do lançamento antes de aprovar.';
  }
  if (action === 'ignore') {
    return 'Há indícios de divergência neste item. Se confirmar, registre justificativa e marque como divergência.';
  }

  return trimmed;
};

const actionPriority = (action: ReviewSourceAction): number => {
  if (action === 'needs_review') return 0;
  if (action === 'ignore') return 1;
  if (action === 'create_new') return 2;
  return 3;
};

const questionFromPlanItem = (item: ChatReconciliationPlan['items'][number], valor: string): string => {
  if (item.action === 'needs_review') {
    return `Preciso da sua orientação para "${item.extrato_descricao_raw}" (${valor}) em ${item.extrato_data_movimento}. Como devemos tratar?`;
  }

  if (item.action === 'create_new') {
    return `Não encontrei vínculo automático para "${item.extrato_descricao_raw}" (${valor}) em ${item.extrato_data_movimento}. Como deseja tratar nesta fase?`;
  }

  if (item.action === 'ignore') {
    return `Confirma marcar como divergência "${item.extrato_descricao_raw}" (${valor})?`;
  }

  return `Confirma o match sugerido para "${item.extrato_descricao_raw}" (${valor})?`;
};

const buildReviewCandidates = (plan: ChatReconciliationPlan): ReviewCandidate[] => {
  return plan.items
    .map((item) => {
      const confidence = typeof item.confidence === 'number' ? item.confidence : null;
      const shouldInclude =
        item.action === 'needs_review' ||
        item.action === 'create_new' ||
        item.action === 'ignore' ||
        (item.action === 'match_existing' && (confidence ?? 0) < 0.75);

      if (!shouldInclude || !item.suggestion_id) return null;

      const valor = toNumber(item.extrato_valor_centavos, 0);
      const valorLabel = `R$ ${(valor / 100).toFixed(2)}`;

      return {
        suggestion_id: item.suggestion_id,
        extrato_transacao_id: item.extrato_transacao_id,
        source_action: item.action,
        item_financeiro_id: item.item_financeiro_id || null,
        confidence,
        confidence_band: confidenceBand(confidence),
        descricao: item.extrato_descricao_raw || item.extrato_transacao_id,
        data_movimento: item.extrato_data_movimento || plan.data_referencia,
        valor_centavos: valor,
        question: questionFromPlanItem(item, valorLabel),
        rationale: normalizeRationalePtBr(item.action, item.explanation),
      } satisfies ReviewCandidate;
    })
    .filter((row): row is ReviewCandidate => !!row);
};

const toQueueItem = (row: ReviewQueueRow): ChatReviewQueueItem => {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const confidence =
    metadata.confidence === null || metadata.confidence === undefined
      ? null
      : toNumber(metadata.confidence, 0);

  return {
    case_id: row.id,
    suggestion_id: row.suggestion_id,
    extrato_transacao_id: row.extrato_transacao_id,
    action: row.source_action,
    question: String(metadata.question || 'Como deseja tratar este item?'),
    rationale: typeof metadata.rationale === 'string' ? metadata.rationale : null,
    confidence,
    confidence_band:
      (typeof metadata.confidence_band === 'string' ? (metadata.confidence_band as ChatPlanConfidenceBand) : undefined) ||
      confidenceBand(confidence),
    descricao: typeof metadata.descricao === 'string' ? metadata.descricao : row.extrato_transacao_id,
    data_movimento: typeof metadata.data_movimento === 'string' ? metadata.data_movimento : row.data_referencia,
    valor_centavos:
      metadata.valor_centavos === null || metadata.valor_centavos === undefined
        ? null
        : toNumber(metadata.valor_centavos, 0),
    suggested_item_financeiro_id:
      typeof metadata.item_financeiro_id === 'string' ? metadata.item_financeiro_id : null,
  };
};

const buildQuickActions = (item: ChatReviewQueueItem): ChatReviewQuickAction[] => {
  const canApproveMatch = Boolean(item.suggested_item_financeiro_id) || item.action === 'match_existing';

  const actions: ChatReviewQuickAction[] = [];

  if (canApproveMatch) {
    actions.push({
      decision: 'approve_match',
      label: 'Aprovar vínculo',
      requires_item_financeiro_id: !item.suggested_item_financeiro_id,
    });
  }

  actions.push({
    decision: 'approve_ignore',
    label: item.action === 'create_new' ? 'Marcar divergência' : 'Ignorar',
    requires_justification: true,
  });

  actions.push({
    decision: 'keep_pending',
    label: 'Pular por enquanto',
  });

  actions.push({
    decision: 'open_manual_review',
    label: 'Enviar para revisão manual',
  });

  return actions;
};

const parseRowList = (rows: unknown[] | null | undefined): ReviewQueueRow[] => {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      id: String(row.id || ''),
      empresa_id: String(row.empresa_id || ''),
      session_id: String(row.session_id || ''),
      conta_bancaria_id: String(row.conta_bancaria_id || ''),
      data_referencia: String(row.data_referencia || ''),
      suggestion_id: String(row.suggestion_id || ''),
      extrato_transacao_id: String(row.extrato_transacao_id || ''),
      source_action: String(row.source_action || 'needs_review') as ReviewSourceAction,
      review_status: String(row.review_status || 'pending') as ReviewStatus,
      decision: (row.decision ? String(row.decision) : null) as ChatReviewDecision | null,
      justification: row.justification ? String(row.justification) : null,
      resolved_by: row.resolved_by ? String(row.resolved_by) : null,
      resolved_at: row.resolved_at ? String(row.resolved_at) : null,
      asked_count: toNumber(row.asked_count, 0),
      last_asked_at: row.last_asked_at ? String(row.last_asked_at) : null,
      metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {},
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
    }))
    .filter((row) => Boolean(row.id && row.suggestion_id));
};

const sortReviewItems = (rows: ReviewQueueRow[]): ReviewQueueRow[] => {
  const statusPriority = (status: ReviewStatus): number => {
    if (status === 'asked') return 0;
    if (status === 'pending') return 1;
    if (status === 'deferred') return 2;
    if (status === 'resolved') return 3;
    return 4;
  };

  return [...rows].sort((a, b) => {
    const aStatusPriority = statusPriority(a.review_status);
    const bStatusPriority = statusPriority(b.review_status);
    if (aStatusPriority !== bStatusPriority) return aStatusPriority - bStatusPriority;

    const aPriority = actionPriority(a.source_action);
    const bPriority = actionPriority(b.source_action);
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aConfidence =
      a.metadata.confidence === null || a.metadata.confidence === undefined
        ? 2
        : toNumber(a.metadata.confidence, 2);
    const bConfidence =
      b.metadata.confidence === null || b.metadata.confidence === undefined
        ? 2
        : toNumber(b.metadata.confidence, 2);
    if (aConfidence !== bConfidence) return aConfidence - bConfidence;

    const aValor = Math.abs(toNumber(a.metadata.valor_centavos, 0));
    const bValor = Math.abs(toNumber(b.metadata.valor_centavos, 0));
    if (aValor !== bValor) return bValor - aValor;

    const aAsked = a.last_asked_at ? Date.parse(a.last_asked_at) : 0;
    const bAsked = b.last_asked_at ? Date.parse(b.last_asked_at) : 0;
    if (aAsked !== bAsked) return bAsked - aAsked;

    return Date.parse(a.created_at || '1970-01-01') - Date.parse(b.created_at || '1970-01-01');
  });
};

const getBatchClassFromMetadata = (row: ReviewQueueRow): ReviewBatchClass => {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  if (metadata.safe_match_candidate === true) return 'safe_match';
  if (metadata.auto_divergence_candidate === true) return 'auto_divergence';
  return 'exception';
};

export function buildBlockedCreateNewSummary(
  plan: ChatReconciliationPlan | null | undefined
): ChatReviewGuidance['create_new_summary'] {
  if (!plan) return null;

  const createNewItems = plan.items.filter((item) => item.action === 'create_new');
  if (createNewItems.length === 0) return null;

  const valorTotalCentavos = createNewItems.reduce(
    (acc, item) => acc + Math.abs(toNumber(item.extrato_valor_centavos, 0)),
    0
  );

  const topItems = [...createNewItems]
    .sort(
      (a, b) =>
        Math.abs(toNumber(b.extrato_valor_centavos, 0)) -
        Math.abs(toNumber(a.extrato_valor_centavos, 0))
    )
    .slice(0, 3)
    .map((item) => ({
      suggestion_id: item.suggestion_id || null,
      descricao: item.extrato_descricao_raw || item.extrato_transacao_id,
      valor_centavos: toNumber(item.extrato_valor_centavos, 0),
      confidence: typeof item.confidence === 'number' ? item.confidence : null,
    }));

  return {
    total: createNewItems.length,
    valor_total_centavos: valorTotalCentavos,
    top_items: topItems,
  };
}

export async function syncReviewQueueFromPlan(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  userId: string;
  sessionId: string;
  contaBancariaId: string;
  dataReferencia: string;
  plan: ChatReconciliationPlan | null;
}): Promise<void> {
  const {
    adminClient,
    empresaId,
    userId,
    sessionId,
    contaBancariaId,
    dataReferencia,
    plan,
  } = args;

  if (!plan) {
    await adminClient
      .from('bank_reconciliation_chat_review_items')
      .update({
        review_status: 'resolved',
        decision: 'keep_pending',
        updated_at: new Date().toISOString(),
      })
      .eq('empresa_id', empresaId)
      .eq('session_id', sessionId);
    return;
  }

  const candidates = buildReviewCandidates(plan);
  const candidateBySuggestion = new Map(candidates.map((item) => [item.suggestion_id, item]));
  const suggestedItemIds = Array.from(
    new Set(candidates.map((item) => item.item_financeiro_id || '').filter(Boolean))
  );

  let suggestedItemById = new Map<string, SuggestedItemSnapshot>();
  if (suggestedItemIds.length > 0) {
    const { data: suggestedItemsRaw, error: suggestedItemsError } = await adminClient
      .from('conciliacao_itens_financeiros')
      .select('id,data,valor_centavos')
      .eq('empresa_id', empresaId)
      .in('id', suggestedItemIds);

    if (suggestedItemsError) {
      throw new Error(
        `Falha ao carregar itens sugeridos para revisão guiada: ${suggestedItemsError.message}`
      );
    }

    const snapshots = ((suggestedItemsRaw || []) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id || ''),
        data: String(row.data || ''),
        valor_centavos: toNumber(row.valor_centavos, 0),
      }))
      .filter((row) => row.id && row.data);

    suggestedItemById = new Map(snapshots.map((row) => [row.id, row]));
  }

  const { data: existingRowsRaw, error: existingError } = await adminClient
    .from('bank_reconciliation_chat_review_items')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('session_id', sessionId);

  if (existingError) {
    throw new Error(`Falha ao carregar fila de revisão guiada: ${existingError.message}`);
  }

  const existingRows = parseRowList(existingRowsRaw as unknown[]);
  const existingBySuggestion = new Map(existingRows.map((row) => [row.suggestion_id, row]));

  const upsertRows: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const existing = existingBySuggestion.get(candidate.suggestion_id);
    const suggestedItem = candidate.item_financeiro_id
      ? suggestedItemById.get(candidate.item_financeiro_id)
      : null;
    const extratoDate = String(candidate.data_movimento || '').slice(0, 10);
    const suggestedDate = String(suggestedItem?.data || '').slice(0, 10);
    const strictValueDateMatch =
      Boolean(suggestedItem) &&
      suggestedDate === extratoDate &&
      Math.abs(toNumber(suggestedItem?.valor_centavos, 0)) === Math.abs(toNumber(candidate.valor_centavos, 0));
    const safeMatchCandidate = Boolean(candidate.item_financeiro_id) && strictValueDateMatch;
    const autoDivergenceCandidate = !safeMatchCandidate && candidate.source_action === 'create_new';
    const batchClass: ReviewBatchClass = safeMatchCandidate
      ? 'safe_match'
      : autoDivergenceCandidate
        ? 'auto_divergence'
        : 'exception';

    const metadata = {
      ...(existing?.metadata || {}),
      confidence: candidate.confidence,
      confidence_band: candidate.confidence_band,
      descricao: candidate.descricao,
      data_movimento: candidate.data_movimento,
      valor_centavos: candidate.valor_centavos,
      question: candidate.question,
      rationale: candidate.rationale,
      item_financeiro_id: candidate.item_financeiro_id,
      strict_value_date_match: strictValueDateMatch,
      safe_match_candidate: safeMatchCandidate,
      auto_divergence_candidate: autoDivergenceCandidate,
      exception_candidate: batchClass === 'exception',
      batch_classification: batchClass,
      suggested_item_data: suggestedItem?.data || null,
      suggested_item_valor_centavos: suggestedItem?.valor_centavos ?? null,
      updated_by_sync: new Date().toISOString(),
    } as Record<string, unknown>;

    const preserveResolved =
      existing?.review_status === 'resolved' &&
      Boolean(existing.decision);
    const preservedStatus: ReviewStatus =
      existing &&
      (existing.review_status === 'pending' ||
        existing.review_status === 'asked' ||
        existing.review_status === 'deferred' ||
        preserveResolved)
        ? existing.review_status
        : 'pending';
    const preserveDecision = preservedStatus === 'deferred' || preservedStatus === 'resolved';

    upsertRows.push({
      ...(existing?.id ? { id: existing.id } : {}),
      empresa_id: empresaId,
      session_id: sessionId,
      conta_bancaria_id: contaBancariaId,
      data_referencia: dataReferencia,
      suggestion_id: candidate.suggestion_id,
      extrato_transacao_id: candidate.extrato_transacao_id,
      source_action: candidate.source_action,
      review_status: preservedStatus,
      decision: preserveDecision ? existing?.decision || 'keep_pending' : null,
      justification: preserveDecision ? existing?.justification || null : null,
      resolved_by: preserveDecision ? existing?.resolved_by || null : null,
      resolved_at: preserveDecision ? existing?.resolved_at || null : null,
      asked_count: toNumber(existing?.asked_count, 0),
      last_asked_at: existing?.last_asked_at || null,
      metadata,
    });
  }

  if (upsertRows.length > 0) {
    const { error: upsertError } = await adminClient
      .from('bank_reconciliation_chat_review_items')
      .upsert(upsertRows, {
        onConflict: 'empresa_id,session_id,suggestion_id',
      });

    if (upsertError) {
      throw new Error(`Falha ao sincronizar itens da revisão guiada: ${upsertError.message}`);
    }
  }

  const staleRows = existingRows.filter(
    (row) =>
      !candidateBySuggestion.has(row.suggestion_id) &&
      (row.review_status === 'pending' || row.review_status === 'asked' || row.review_status === 'deferred')
  );

  if (staleRows.length > 0) {
    const staleIds = staleRows.map((row) => row.id);
    const { error: staleError } = await adminClient
      .from('bank_reconciliation_chat_review_items')
      .update({
        review_status: 'resolved',
        decision: 'keep_pending',
        updated_at: new Date().toISOString(),
      })
      .eq('empresa_id', empresaId)
      .in('id', staleIds);

    if (staleError) {
      throw new Error(`Falha ao marcar itens stale da revisão guiada: ${staleError.message}`);
    }
  }

  if (candidates.length === 0) {
    await adminClient
      .from('bank_reconciliation_chat_review_items')
      .update({
        review_status: 'resolved',
        decision: 'keep_pending',
        updated_at: new Date().toISOString(),
      })
      .eq('empresa_id', empresaId)
      .eq('session_id', sessionId)
      .in('review_status', ['pending', 'asked', 'deferred']);
  }

  try {
    await adminClient
      .from('bank_reconciliation_audit_log')
      .insert({
        empresa_id: empresaId,
        action: 'chat_guided_review_queue_synced',
        status: 'success',
        message: 'Fila de revisão guiada sincronizada com o plano atual.',
        created_by: userId,
        details: {
          session_id: sessionId,
          conta_bancaria_id: contaBancariaId,
          data_referencia: dataReferencia,
          review_candidates: candidates.length,
        },
      });
  } catch {
    // audit log nunca deve bloquear o fluxo principal
  }
}

export async function loadReviewQueueItemById(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
  caseId: string;
}): Promise<ReviewQueueRow | null> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .select('*')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId)
    .eq('id', args.caseId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar item da revisão guiada: ${error.message}`);
  }

  const rows = parseRowList(data ? [data] : []);
  return rows[0] || null;
}

export async function markReviewQueueItemAsked(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  caseId: string;
}): Promise<void> {
  const { data: current, error: loadError } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .select('asked_count,review_status')
    .eq('empresa_id', args.empresaId)
    .eq('id', args.caseId)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Falha ao carregar estado do item da revisão guiada: ${loadError.message}`);
  }

  const askedCount = toNumber(current?.asked_count, 0);
  const status = String(current?.review_status || 'pending') as ReviewStatus;

  const { error: updateError } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .update({
      asked_count: askedCount + 1,
      last_asked_at: new Date().toISOString(),
      review_status: status === 'pending' ? 'asked' : status,
    })
    .eq('empresa_id', args.empresaId)
    .eq('id', args.caseId);

  if (updateError) {
    throw new Error(`Falha ao marcar item como perguntado: ${updateError.message}`);
  }
}

export async function resolveReviewQueueItem(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  caseId: string;
  userId: string;
  status: ReviewStatus;
  decision: ChatReviewDecision;
  justification?: string | null;
  metadataPatch?: Record<string, unknown>;
}): Promise<void> {
  const { data: current, error: currentError } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .select('metadata')
    .eq('empresa_id', args.empresaId)
    .eq('id', args.caseId)
    .maybeSingle();

  if (currentError) {
    throw new Error(`Falha ao carregar item para resolver revisão guiada: ${currentError.message}`);
  }

  const metadata = current?.metadata && typeof current.metadata === 'object'
    ? (current.metadata as Record<string, unknown>)
    : {};

  const { error: updateError } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .update({
      review_status: args.status,
      decision: args.decision,
      justification: args.justification || null,
      resolved_by: args.userId,
      resolved_at: new Date().toISOString(),
      metadata: {
        ...metadata,
        ...(args.metadataPatch || {}),
      },
    })
    .eq('empresa_id', args.empresaId)
    .eq('id', args.caseId);

  if (updateError) {
    throw new Error(`Falha ao resolver item da revisão guiada: ${updateError.message}`);
  }
}

export async function getReviewGuidanceSnapshot(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
  plan?: ChatReconciliationPlan | null;
}): Promise<ChatReviewGuidance> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .select('*')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId);

  if (error) {
    throw new Error(`Falha ao carregar snapshot da revisão guiada: ${error.message}`);
  }

  const rows = parseRowList(data as unknown[]);
  const effectiveRows = rows.filter((row) => row.review_status !== 'blocked');
  const activeRows = sortReviewItems(
    effectiveRows.filter(
      (row) => row.review_status === 'pending' || row.review_status === 'asked' || row.review_status === 'deferred'
    )
  );

  const safeMatchCount = activeRows.filter((row) => getBatchClassFromMetadata(row) === 'safe_match').length;
  const autoDivergenceCount = activeRows.filter(
    (row) => getBatchClassFromMetadata(row) === 'auto_divergence'
  ).length;
  const exceptionCount = activeRows.length - safeMatchCount - autoDivergenceCount;
  const batchCandidateCount = safeMatchCount + autoDivergenceCount;
  const resolvedCount = effectiveRows.filter((row) => row.review_status === 'resolved').length;
  const queueTotalActive = activeRows.length;
  const queueRemaining = activeRows.length;
  const hasBatchOffer = safeMatchCount > 0;
  const queuePhase: ChatReviewGuidance['queue_phase'] =
    queueRemaining === 0 ? 'completed' : hasBatchOffer ? 'pre_batch' : 'guided_1x1';

  const currentRow =
    queuePhase === 'guided_1x1'
      ? activeRows.find((row) => getBatchClassFromMetadata(row) === 'exception') || activeRows[0] || null
      : null;
  const currentCase = currentRow ? toQueueItem(currentRow) : null;
  const currentPosition = currentRow && queueTotalActive > 0
    ? Math.max(activeRows.findIndex((row) => row.id === currentRow.id), 0) + 1
    : null;
  const manualReviewCount = effectiveRows.filter(
    (row) => row.review_status === 'resolved' && row.decision === 'open_manual_review'
  ).length;
  const finalSummary =
    queueRemaining === 0
      ? {
          total: effectiveRows.length,
          resolved: resolvedCount,
          unresolved: 0,
          manual_review_count: manualReviewCount,
        }
      : null;

  return {
    queue_total: queueTotalActive,
    queue_total_active: queueTotalActive,
    queue_remaining: queueRemaining,
    queue_phase: queuePhase,
    display_mode: queueRemaining === 0 ? 'guided_completed' : 'guided_active',
    safe_match_count: safeMatchCount,
    auto_divergence_count: autoDivergenceCount,
    exceptions_count: exceptionCount,
    batch_offer:
      hasBatchOffer
        ? {
            strategy: 'strict_date_value',
            apply_safe_matches: true,
            apply_auto_divergence: autoDivergenceCount > 0,
            safe_match_count: safeMatchCount,
            auto_divergence_count: autoDivergenceCount,
            exceptions_count: exceptionCount,
            total_candidate_count: batchCandidateCount,
            cta_label: 'Aplicar decisões rápidas',
            summary:
              'Posso aplicar em lote os vínculos seguros (mesmo valor e data) e marcar divergência onde não há vínculo confiável.',
            global_justification_suggestion:
              'Sem vínculo automático confiável nesta fase; divergência registrada para revisão financeira posterior.',
          }
        : null,
    final_summary: finalSummary,
    current_position: currentPosition,
    current_case: currentCase,
    next_actions: currentCase ? buildQuickActions(currentCase) : [],
    create_new_summary: buildBlockedCreateNewSummary(args.plan || null),
  };
}

export async function loadActiveReviewQueueRows(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
}): Promise<ReviewQueueRow[]> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .select('*')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId)
    .in('review_status', ['pending', 'asked', 'deferred']);

  if (error) {
    throw new Error(`Falha ao carregar fila ativa da revisão guiada: ${error.message}`);
  }

  return sortReviewItems(parseRowList(data as unknown[]));
}
