import type {
  AiIntegrationSuggestRequest,
  AiSuggestionCreatePayload,
} from '../../../src/types/bank-reconciliation.js';
import {
  extractBearerToken,
  getAdminClient,
  getBankReconciliationIntegrationSecret,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isEmpresaHeaderConsistent,
  isValidIntegrationSecret,
  parseIntegrationScope,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';
import { incrementBankAiExecutionRunCounts } from '../../../src/server/bank-statement/aiExecutionRuns.js';

const VALID_ACTIONS = new Set(['match_existing', 'create_new', 'ignore', 'needs_review']);

interface ResolvedAuthContext {
  mode: 'user' | 'integration';
  userId: string | null;
  empresaId: string;
  contaBancariaId: string | null;
}

export function applySuggestionDedupeWindowFilter<
  T extends {
    gte: (column: string, value: string) => T;
  },
>(query: T, dedupeSinceIso: string | null): T {
  if (!dedupeSinceIso) return query;
  return query.gte('created_at', dedupeSinceIso);
}

const normalizePayload = (value: unknown): AiSuggestionCreatePayload[] => {
  if (!value || typeof value !== 'object') return [];
  const body = value as Record<string, unknown>;
  if (Array.isArray(body.suggestions)) {
    return body.suggestions as AiSuggestionCreatePayload[];
  }
  return [body as unknown as AiSuggestionCreatePayload];
};

const clampConfidence = (confidence: number): number => {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildSuggestionSignature = (
  action: string,
  itemFinanceiroId: string | null,
  proposed: unknown
): string => {
  return [
    action.trim().toLowerCase(),
    itemFinanceiroId || 'null',
    stableStringify(proposed || null),
  ].join('|');
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const integrationSecret = getBankReconciliationIntegrationSecret();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para conciliacao bancaria.',
    });
  }

  let parsedBody: unknown;
  try {
    parsedBody = parseJsonBody(req) || {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const bodyRecord = (parsedBody || {}) as AiIntegrationSuggestRequest & Record<string, unknown>;
  const suggestions = normalizePayload(parsedBody);
  const correlationId = String(bodyRecord?.correlation_id || '').trim() || null;
  const topLevelImportId =
    String(bodyRecord?.extrato_import_id || '').trim() ||
    String(bodyRecord?.import_id || '').trim() ||
    null;

  if (!suggestions.length) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Nenhuma sugestao foi informada.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  const isIntegrationCall = Boolean(getHeaderValue(req, 'x-integration-secret'));

  let auth: ResolvedAuthContext;

  if (isIntegrationCall) {
    if (!integrationSecret || !isValidIntegrationSecret(req, integrationSecret)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'x-integration-secret invalido para ai/suggest.',
      });
    }

    const parsedScope = parseIntegrationScope(bodyRecord, {
      requireContaBancariaId: true,
      requireImportId: false,
    });

    if (parsedScope.error || !parsedScope.scope) {
      return res.status(400).json({
        error: 'Invalid input',
        message: parsedScope.error || 'Escopo de integracao invalido.',
      });
    }

    if (!isEmpresaHeaderConsistent(req, parsedScope.scope.empresaId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'x-empresa-id inconsistente com empresa_id do payload.',
      });
    }

    auth = {
      mode: 'integration',
      userId: null,
      empresaId: parsedScope.scope.empresaId,
      contaBancariaId: parsedScope.scope.contaBancariaId,
    };
  } else {
    if (!accessToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Sessao expirada. Faca login novamente.',
      });
    }

    let userAuth;
    try {
      userAuth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
    } catch (error: unknown) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
      });
    }

    auth = {
      mode: 'user',
      userId: userAuth.userId,
      empresaId: userAuth.empresaId,
      contaBancariaId: String(bodyRecord?.conta_bancaria_id || '').trim() || null,
    };
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
  const created: unknown[] = [];
  const skipped: Array<{ reason: string; extrato_transacao_id?: string }> = [];
  const createdActionCounts = {
    sugestoes_total: 0,
    match_existing_count: 0,
    create_new_count: 0,
    ignore_count: 0,
    needs_review_count: 0,
  };
  const touchedImportIds = new Set<string>();
  let dedupeSinceIso: string | null = null;

  if (correlationId) {
    const { data: runRow, error: runError } = await adminClient
      .from('bank_ai_execution_runs')
      .select('created_at')
      .eq('empresa_id', auth.empresaId)
      .eq('correlation_id', correlationId)
      .maybeSingle();

    if (runError) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao carregar execução IA para deduplicação por correlação: ${runError.message}`,
      });
    }

    dedupeSinceIso = runRow?.created_at ? String(runRow.created_at) : null;
  }

  for (const suggestion of suggestions) {
    const extratoTransacaoId = String(suggestion?.extrato_transacao_id || '').trim();
    const action = String(suggestion?.action || '').trim();

    if (!extratoTransacaoId || !VALID_ACTIONS.has(action)) {
      skipped.push({
        reason: 'payload invalido',
        extrato_transacao_id: extratoTransacaoId || undefined,
      });
      continue;
    }

    const { data: extratoTx, error: txError } = await adminClient
      .from('extrato_transacoes')
      .select('id,empresa_id,conta_bancaria_id,valor_centavos,extrato_import_id')
      .eq('id', extratoTransacaoId)
      .eq('empresa_id', auth.empresaId)
      .maybeSingle();

    if (txError || !extratoTx) {
      skipped.push({
        reason: 'extrato_transacao_id invalido para empresa',
        extrato_transacao_id: extratoTransacaoId,
      });
      continue;
    }
    if (extratoTx.extrato_import_id) {
      touchedImportIds.add(String(extratoTx.extrato_import_id));
    }

    if (auth.contaBancariaId && extratoTx.conta_bancaria_id !== auth.contaBancariaId) {
      skipped.push({
        reason: 'escopo conta_bancaria_id invalido para transacao',
        extrato_transacao_id: extratoTransacaoId,
      });
      continue;
    }

    const suggestedItemIdRaw =
      (suggestion?.match && 'item_financeiro_id' in suggestion.match
        ? suggestion.match.item_financeiro_id
        : null) || null;
    const suggestedLancamentoIdRaw = suggestion?.match?.lancamento_caixa_id || null;

    let targetItemId: string | null = suggestedItemIdRaw ? String(suggestedItemIdRaw).trim() : null;
    let targetLancamentoId: string | null = suggestedLancamentoIdRaw ? String(suggestedLancamentoIdRaw).trim() : null;

    if (action === 'match_existing') {
      if (!targetItemId && !targetLancamentoId) {
        skipped.push({
          reason: 'match_existing requer item_financeiro_id ou lancamento_caixa_id',
          extrato_transacao_id: extratoTransacaoId,
        });
        continue;
      }

      let itemRow:
        | {
          id: string;
          empresa_id: string;
          conta_bancaria_id: string;
          origem_tipo: 'lancamento_caixa' | 'movimentacao_estoque';
          origem_id_uuid: string | null;
        }
        | null = null;

      if (targetItemId) {
        const { data } = await adminClient
          .from('conciliacao_itens_financeiros')
          .select('id,empresa_id,conta_bancaria_id,origem_tipo,origem_id_uuid')
          .eq('id', targetItemId)
          .eq('empresa_id', auth.empresaId)
          .eq('ativo', true)
          .maybeSingle();
        itemRow = (data as typeof itemRow) || null;
      } else if (targetLancamentoId) {
        const { data } = await adminClient
          .from('conciliacao_itens_financeiros')
          .select('id,empresa_id,conta_bancaria_id,origem_tipo,origem_id_uuid')
          .eq('empresa_id', auth.empresaId)
          .eq('origem_tipo', 'lancamento_caixa')
          .eq('origem_id_uuid', targetLancamentoId)
          .eq('ativo', true)
          .maybeSingle();
        itemRow = (data as typeof itemRow) || null;
      }

      if (!itemRow) {
        skipped.push({
          reason: 'item/lancamento alvo invalido para empresa',
          extrato_transacao_id: extratoTransacaoId,
        });
        continue;
      }

      targetItemId = itemRow.id;
      targetLancamentoId = itemRow.origem_tipo === 'lancamento_caixa' ? itemRow.origem_id_uuid : null;

      if (itemRow.conta_bancaria_id !== extratoTx.conta_bancaria_id) {
        skipped.push({
          reason: 'item financeiro de conta diferente da transacao de extrato',
          extrato_transacao_id: extratoTransacaoId,
        });
        continue;
      }

      const { data: hasConfirmed } = await adminClient
        .from('conciliacoes_bancarias')
        .select('id')
        .eq('empresa_id', auth.empresaId)
        .eq('extrato_transacao_id', extratoTransacaoId)
        .eq('status', 'confirmed')
        .limit(1);

      if ((hasConfirmed || []).length > 0) {
        skipped.push({
          reason: 'transacao ja possui conciliacao confirmada',
          extrato_transacao_id: extratoTransacaoId,
        });
        continue;
      }

      const { error: upsertConcError } = await adminClient
        .from('conciliacoes_bancarias')
        .upsert(
          {
            empresa_id: auth.empresaId,
            extrato_transacao_id: extratoTransacaoId,
            item_financeiro_id: targetItemId,
            lancamento_caixa_id: targetLancamentoId,
            valor_alocado_centavos: extratoTx.valor_centavos,
            status: 'suggested',
            confidence: clampConfidence(Number(suggestion?.confidence || 0)),
            method: 'ai',
            explanation: suggestion?.explanation || 'Sugestao de match gerada por IA.',
            confirmed_by: null,
            confirmed_at: null,
          },
          { onConflict: 'extrato_transacao_id,item_financeiro_id' }
        );

      if (upsertConcError) {
        skipped.push({
          reason: `falha ao criar sugestao de conciliacao: ${upsertConcError.message}`,
          extrato_transacao_id: extratoTransacaoId,
        });
        continue;
      }

      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_import_id: extratoTx.extrato_import_id,
        extrato_transacao_id: extratoTransacaoId,
        action: 'ai_match_suggestion_upserted',
        status: 'info',
        message: 'Sugestao de conciliacao (match_existing) gerada por IA.',
        created_by: auth.userId,
        details: {
          item_financeiro_id: targetItemId,
          lancamento_caixa_id: targetLancamentoId,
          confidence: clampConfidence(Number(suggestion?.confidence || 0)),
        },
      });
    }

    const incomingSignature = buildSuggestionSignature(action, targetItemId, suggestion?.create || null);
    let existingRowsQuery = adminClient
      .from('bank_ai_suggestions')
      .select('*')
      .eq('empresa_id', auth.empresaId)
      .eq('extrato_transacao_id', extratoTransacaoId)
      .eq('suggestion_action', action)
      .eq('status', 'suggested')
      .order('created_at', { ascending: false })
      .limit(25);

    existingRowsQuery = applySuggestionDedupeWindowFilter(existingRowsQuery, dedupeSinceIso);

    const { data: existingRows } = await existingRowsQuery;

    if (existingRows && existingRows.length > 0) {
      const duplicate = existingRows.find((row) => {
        const rowSignature = buildSuggestionSignature(
          row.suggestion_action,
          row.item_financeiro_id || null,
          row.proposed_lancamento || null
        );
        return rowSignature === incomingSignature;
      });

      if (duplicate) {
        created.push(duplicate);
        continue;
      }
    }

    const insertPayload = {
      empresa_id: auth.empresaId,
      extrato_transacao_id: extratoTransacaoId,
      suggestion_action: action,
      confidence: clampConfidence(Number(suggestion?.confidence || 0)),
      item_financeiro_id: targetItemId,
      lancamento_caixa_id: targetLancamentoId,
      proposed_lancamento: suggestion?.create || null,
      explanation: suggestion?.explanation || null,
      warnings: Array.isArray(suggestion?.warnings) ? suggestion.warnings : [],
      status: 'suggested',
      source: auth.mode === 'integration' ? 'n8n_ai' : 'manual_ai',
      created_by: auth.userId,
    };

    const { data, error } = await adminClient
      .from('bank_ai_suggestions')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      skipped.push({
        reason: error.message,
        extrato_transacao_id: extratoTransacaoId,
      });
      continue;
    }

    created.push(data);
    createdActionCounts.sugestoes_total += 1;
    if (action === 'match_existing') createdActionCounts.match_existing_count += 1;
    if (action === 'create_new') createdActionCounts.create_new_count += 1;
    if (action === 'ignore') createdActionCounts.ignore_count += 1;
    if (action === 'needs_review') createdActionCounts.needs_review_count += 1;
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_import_id: extratoTx.extrato_import_id,
      extrato_transacao_id: extratoTransacaoId,
      action: 'ai_suggestion_created',
      status: 'info',
      message: `Sugestao IA registrada (${action}).`,
      created_by: auth.userId,
      details: {
        ai_suggestion_id: data.id,
        action,
        confidence: data.confidence,
        mode: auth.mode,
      },
    });
  }

  if (correlationId) {
    try {
      const metadataPatch: Record<string, unknown> = {
        last_suggest_at: new Date().toISOString(),
        suggest_created_count: created.length,
        suggest_skipped_count: skipped.length,
      };
      if (topLevelImportId || touchedImportIds.size === 1) {
        metadataPatch.extrato_import_id = topLevelImportId || Array.from(touchedImportIds)[0];
      }

      await incrementBankAiExecutionRunCounts({
        adminClient,
        empresaId: auth.empresaId,
        correlationId,
        increments: createdActionCounts,
        metadataPatch,
      });
    } catch (error: unknown) {
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_import_id: topLevelImportId || Array.from(touchedImportIds)[0] || null,
        action: 'ai_execution_run_update_warning',
        status: 'warning',
        message: error instanceof Error ? error.message : 'Falha ao atualizar execução IA após ai/suggest.',
        created_by: auth.userId,
        details: {
          correlation_id: correlationId,
        },
      });
    }
  }

  return res.status(200).json({
    ok: true,
    created_count: created.length,
    skipped_count: skipped.length,
    created_action_counts: createdActionCounts,
    correlation_id: correlationId,
    data: created,
    skipped,
  });
}
