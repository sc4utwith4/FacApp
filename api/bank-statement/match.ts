import { buildDeterministicMatches } from '../../src/lib/bank-reconciliation/matchingEngine.js';
import {
  getFirstMatchingRule,
  inferLancamentoTipoFromTransaction,
} from '../../src/lib/bank-reconciliation/rulesEngine.js';
import type {
  BankMatchRequest,
  ExtratoTransacaoRow,
  MatchingLancamentoCandidate,
  ReconciliationRuleRow,
} from '../../src/types/bank-reconciliation.js';
import {
  callUserRpc,
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  isBankReconciliationBalanceMutationDisabled,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../src/server/bank-statement/_shared.js';

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const toMoney = (centavos: number): number => Number((centavos / 100).toFixed(2));
const AUTO_CONFIRM_DATE_WINDOW_DAYS = 2;
const AUTO_CONFIRM_TEXT_THRESHOLD = 0.85;
const RULE_AUTO_CREATE_PHASE_DISABLED = true;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para conciliacao bancaria.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessao expirada. Faca login novamente.',
    });
  }

  let body: BankMatchRequest;
  try {
    body = (parseJsonBody(req) || {}) as BankMatchRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const importId = String(body?.import_id || '').trim();
  if (!importId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'import_id e obrigatorio.',
    });
  }

  const autoConfirm = body?.auto_confirm !== false;
  const balanceMutationBlocked = isBankReconciliationBalanceMutationDisabled();

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error: unknown) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  const { data: importRow, error: importError } = await adminClient
    .from('extratos_import')
    .select('id,empresa_id,conta_bancaria_id,parse_status,periodo_inicio,periodo_fim,error_message')
    .eq('id', importId)
    .eq('empresa_id', auth.empresaId)
    .maybeSingle();

  if (importError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar importacao: ${importError.message}`,
    });
  }

  if (!importRow) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Importacao nao encontrada para a empresa.',
    });
  }

  if (importRow.parse_status !== 'parsed') {
    return res.status(409).json({
      error: 'Invalid state',
      message: `Importacao precisa estar em parsed. Status atual: ${importRow.parse_status}`,
      import_id: importRow.id,
      parse_status: importRow.parse_status,
      parse_error_message: importRow.error_message || null,
    });
  }

  const { data: extratoRows, error: extratoError } = await adminClient
    .from('extrato_transacoes')
    .select('*')
    .eq('empresa_id', auth.empresaId)
    .eq('extrato_import_id', importId)
    .order('data_movimento', { ascending: true })
    .order('line_number', { ascending: true });

  if (extratoError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar transacoes do extrato: ${extratoError.message}`,
    });
  }

  const transactions = (extratoRows || []) as ExtratoTransacaoRow[];
  if (!transactions.length) {
    return res.status(200).json({
      ok: true,
      import_id: importId,
      suggested_count: 0,
      confirmed_count: 0,
      skipped_count: 0,
      rule_autocreated_count: 0,
    });
  }

  const txIds = transactions.map((tx) => tx.id);

  const { data: existingConciliacoes, error: conciliacoesError } = await adminClient
    .from('conciliacoes_bancarias')
    .select('id,extrato_transacao_id,item_financeiro_id,lancamento_caixa_id,status')
    .eq('empresa_id', auth.empresaId)
    .in('extrato_transacao_id', txIds);

  if (conciliacoesError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar conciliacoes existentes: ${conciliacoesError.message}`,
    });
  }

  const confirmedByTransaction = new Set<string>();
  const usedItemIds = new Set<string>();
  const legacyConfirmedLancamentoIds = new Set<string>();

  for (const row of existingConciliacoes || []) {
    if (row.status === 'confirmed') {
      confirmedByTransaction.add(row.extrato_transacao_id);
      if (row.item_financeiro_id) {
        usedItemIds.add(row.item_financeiro_id);
      } else if (row.lancamento_caixa_id) {
        legacyConfirmedLancamentoIds.add(row.lancamento_caixa_id);
      }
    }
  }

  const { error: deleteSuggestedError } = await adminClient
    .from('conciliacoes_bancarias')
    .delete()
    .eq('empresa_id', auth.empresaId)
    .eq('status', 'suggested')
    .in('extrato_transacao_id', txIds);

  if (deleteSuggestedError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao limpar sugestoes anteriores: ${deleteSuggestedError.message}`,
    });
  }

  const dateValues = transactions.map((tx) => tx.data_movimento).sort();
  const fromDate = addDays(dateValues[0], -AUTO_CONFIRM_DATE_WINDOW_DAYS);
  const toDate = addDays(dateValues[dateValues.length - 1], AUTO_CONFIRM_DATE_WINDOW_DAYS);

  const syncResponse = await callUserRpc(
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    'rpc_bank_sync_conciliacao_itens',
    {
      payload: {
        empresa_id: auth.empresaId,
        conta_bancaria_id: importRow.conta_bancaria_id,
        full_refresh: false,
      },
    }
  );

  if (syncResponse.error) {
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_import_id: importId,
      action: 'matching_sync_items_warning',
      status: 'warning',
      message: `Nao foi possivel sincronizar itens de conciliacao: ${syncResponse.error}`,
      created_by: auth.userId,
    });
  }

  const { data: itemsRows, error: itemsError } = await adminClient
    .from('conciliacao_itens_financeiros')
    .select(
      'id,conta_bancaria_id,data,tipo,valor_centavos,descricao_exibicao,documento,origem_tipo,origem_id_uuid,origem_id_bigint'
    )
    .eq('empresa_id', auth.empresaId)
    .eq('ativo', true)
    .eq('conta_bancaria_id', importRow.conta_bancaria_id)
    .gte('data', fromDate)
    .lte('data', toDate)
    .order('data', { ascending: true });

  if (itemsError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar itens financeiros: ${itemsError.message}`,
    });
  }

  const { data: ruleRows, error: rulesError } = await adminClient
    .from('regras_conciliacao')
    .select('*')
    .eq('empresa_id', auth.empresaId)
    .eq('active', true)
    .or(`conta_bancaria_id.eq.${importRow.conta_bancaria_id},conta_bancaria_id.is.null`)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  if (rulesError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar regras de conciliacao: ${rulesError.message}`,
    });
  }

  const rules = (ruleRows || []) as ReconciliationRuleRow[];
  const itemRows =
    (itemsRows || []) as Array<{
      id: string;
      conta_bancaria_id: string;
      data: string;
      tipo: 'entrada' | 'saida';
      valor_centavos: number;
      descricao_exibicao: string | null;
      documento: string | null;
      origem_tipo: 'lancamento_caixa' | 'movimentacao_estoque';
      origem_id_uuid: string | null;
      origem_id_bigint: number | null;
    }>;

  const itemById = new Map(itemRows.map((item) => [item.id, item]));
  const itemByLancamentoId = new Map<string, string>();
  for (const item of itemRows) {
    if (item.origem_tipo === 'lancamento_caixa' && item.origem_id_uuid) {
      itemByLancamentoId.set(item.origem_id_uuid, item.id);
    }
  }

  for (const legacyLancamentoId of legacyConfirmedLancamentoIds) {
    const mapped = itemByLancamentoId.get(legacyLancamentoId);
    if (mapped) {
      usedItemIds.add(mapped);
    }
  }

  const lancamentos = itemRows.map((item) => {
    return {
      id: item.id,
      data: item.data,
      tipo: item.tipo,
      valor: toMoney(item.valor_centavos),
      historico: item.descricao_exibicao,
      documento: item.documento,
      conta_bancaria_id: item.conta_bancaria_id,
      item_financeiro_id: item.id,
      origem_tipo: item.origem_tipo,
      origem_id_uuid: item.origem_id_uuid,
      origem_id_bigint: item.origem_id_bigint,
    } as MatchingLancamentoCandidate;
  });

  let suggestedCount = 0;
  let confirmedCount = 0;
  let skippedCount = 0;
  let ruleAutocreatedCount = 0;
  let ruleAutoCreateBlockedCount = 0;
  let ruleAutoCreatePhaseBlockedCount = 0;

  for (const tx of transactions) {
    if (confirmedByTransaction.has(tx.id)) {
      skippedCount += 1;
      continue;
    }

    const matchingRule = getFirstMatchingRule(tx, rules);

    if (matchingRule?.auto_create) {
      if (RULE_AUTO_CREATE_PHASE_DISABLED) {
        ruleAutoCreateBlockedCount += 1;
        ruleAutoCreatePhaseBlockedCount += 1;
        await safeInsertBankAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          extrato_import_id: importId,
          extrato_transacao_id: tx.id,
          action: 'rule_auto_create_blocked_phase_policy',
          status: 'info',
          message: `Auto-create da regra ${matchingRule.id} bloqueado por politica da fase (somente match_existing).`,
          created_by: auth.userId,
          details: {
            rule_id: matchingRule.id,
            policy: 'P0_MATCH_EXISTING_ONLY',
          },
        });
      } else if (balanceMutationBlocked) {
        ruleAutoCreateBlockedCount += 1;
        await safeInsertBankAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          extrato_import_id: importId,
          extrato_transacao_id: tx.id,
          action: 'rule_auto_create_blocked_policy',
          status: 'warning',
          message: `Auto-create da regra ${matchingRule.id} bloqueado por politica sem mutacao de saldo.`,
          created_by: auth.userId,
          details: {
            rule_id: matchingRule.id,
            policy: 'BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION',
          },
        });
      } else {
        const rpcPayload = {
          payload: {
            empresa_id: auth.empresaId,
            conta_bancaria_id: importRow.conta_bancaria_id,
            extrato_transacao_id: tx.id,
            idempotency_key: `rule-auto:${tx.id}:${matchingRule.id}:${tx.valor_centavos}:${tx.data_movimento}`,
            tipo: inferLancamentoTipoFromTransaction(tx.tipo),
            valor: toMoney(tx.valor_centavos),
            valor_centavos: tx.valor_centavos,
            data: tx.data_movimento,
            historico: tx.descricao_raw,
            documento: tx.documento_ref,
            grupo_contas_id: matchingRule.default_grupo_contas_id,
            method: 'rule',
            explanation: `Auto-create por regra ${matchingRule.id}`,
          },
        };

        const rpcResponse = await callUserRpc(
          supabaseUrl,
          supabaseAnonKey,
          accessToken,
          'rpc_bank_create_lancamento_and_reconcile',
          rpcPayload
        );

        if (!rpcResponse.error) {
          confirmedCount += 1;
          ruleAutocreatedCount += 1;
          confirmedByTransaction.add(tx.id);

          await safeInsertBankAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            extrato_import_id: importId,
            extrato_transacao_id: tx.id,
            action: 'rule_auto_create_confirmed',
            status: 'success',
            message: `Regra ${matchingRule.id} criou e conciliou lancamento automaticamente.`,
            created_by: auth.userId,
            details: {
              rule_id: matchingRule.id,
              rpc_result: rpcResponse.data,
            },
          });

          continue;
        }

        await safeInsertBankAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          extrato_import_id: importId,
          extrato_transacao_id: tx.id,
          action: 'rule_auto_create_failed',
          status: 'warning',
          message: rpcResponse.error,
          created_by: auth.userId,
          details: {
            rule_id: matchingRule.id,
            rpc_status: rpcResponse.status,
          },
        });
      }
    }

    const availableCandidates = lancamentos.filter((lanc) => !usedItemIds.has(lanc.id));
    const matching = buildDeterministicMatches(tx, availableCandidates, {
      autoConfirmThreshold: 0.95,
      uniqueGapThreshold: 0.12,
      minSuggestedScore: 0.62,
      dateWindowDays: AUTO_CONFIRM_DATE_WINDOW_DAYS,
      autoConfirmTextThreshold: AUTO_CONFIRM_TEXT_THRESHOLD,
      autoConfirmRequireExactAmount: true,
    });

    const topSuggestion = matching.suggestions[0];
    if (!topSuggestion) {
      skippedCount += 1;
      continue;
    }

    const hasAutoConfirmAmbiguity = matching.autoConfirmEligibleIds.length > 1;
    if (autoConfirm && hasAutoConfirmAmbiguity) {
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_import_id: importId,
        extrato_transacao_id: tx.id,
        action: 'matching_auto_confirm_ambiguous',
        status: 'info',
        message: 'Auto-conciliacao nao aplicada por ambiguidade entre multiplos candidatos elegiveis.',
        created_by: auth.userId,
        details: {
          eligible_item_ids: matching.autoConfirmEligibleIds,
          text_threshold: AUTO_CONFIRM_TEXT_THRESHOLD,
          requires_exact_amount: true,
          date_window_days: AUTO_CONFIRM_DATE_WINDOW_DAYS,
        },
      });
    }

    const allowAutoByRule = matchingRule ? matchingRule.auto_confirm : true;
    const shouldConfirm =
      autoConfirm &&
      allowAutoByRule &&
      matching.autoConfirmIds.includes(topSuggestion.lancamento_caixa_id);

    const matchedItemId = topSuggestion.lancamento_caixa_id;
    const matchedItem = itemById.get(matchedItemId);
    const matchedLancamentoId =
      matchedItem?.origem_tipo === 'lancamento_caixa' ? matchedItem.origem_id_uuid : null;

    const payload = {
      empresa_id: auth.empresaId,
      extrato_transacao_id: topSuggestion.extrato_transacao_id,
      item_financeiro_id: matchedItemId,
      lancamento_caixa_id: matchedLancamentoId,
      valor_alocado_centavos: tx.valor_centavos,
      status: shouldConfirm ? 'confirmed' : 'suggested',
      confidence: topSuggestion.confidence,
      method: matchingRule ? 'rule' : 'deterministic',
      explanation: matchingRule
        ? `Regra ${matchingRule.id} aplicada | ${topSuggestion.explanation}`
        : topSuggestion.explanation,
      rule_id: matchingRule?.id || null,
      confirmed_by: shouldConfirm ? auth.userId : null,
      confirmed_at: shouldConfirm ? new Date().toISOString() : null,
    };

    const { error: upsertError } = await adminClient
      .from('conciliacoes_bancarias')
      .upsert(payload, { onConflict: 'extrato_transacao_id,item_financeiro_id' });

    if (upsertError) {
      skippedCount += 1;
      continue;
    }

    usedItemIds.add(matchedItemId);

    if (shouldConfirm) {
      confirmedCount += 1;
      confirmedByTransaction.add(tx.id);
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_import_id: importId,
        extrato_transacao_id: tx.id,
        action: 'matching_auto_confirm_value_description',
        status: 'success',
        message: 'Conciliacao automatica confirmada por valor exato + descricao semelhante.',
        created_by: auth.userId,
        details: {
          item_financeiro_id: matchedItemId,
          confidence: topSuggestion.confidence,
          text_score: topSuggestion.score.text_score,
          text_threshold: AUTO_CONFIRM_TEXT_THRESHOLD,
          requires_exact_amount: true,
          date_window_days: AUTO_CONFIRM_DATE_WINDOW_DAYS,
        },
      });
    } else {
      suggestedCount += 1;
    }
  }

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_import_id: importId,
    action: 'matching_completed',
    status: 'success',
    message: 'Matching deterministico concluido.',
    created_by: auth.userId,
    details: {
      total_transactions: transactions.length,
      suggested_count: suggestedCount,
      confirmed_count: confirmedCount,
      skipped_count: skippedCount,
      rule_autocreated_count: ruleAutocreatedCount,
      rule_auto_create_blocked_count: ruleAutoCreateBlockedCount,
      rule_auto_create_phase_blocked_count: ruleAutoCreatePhaseBlockedCount,
      balance_mutation_blocked: balanceMutationBlocked,
      rules_loaded: rules.length,
      rule_auto_create_phase_disabled: RULE_AUTO_CREATE_PHASE_DISABLED,
      auto_confirm: autoConfirm,
      policy: {
        mode: 'value_exact_description_fuzzy',
        text_threshold: AUTO_CONFIRM_TEXT_THRESHOLD,
        requires_exact_amount: true,
        date_window_days: AUTO_CONFIRM_DATE_WINDOW_DAYS,
      },
    },
  });

  return res.status(200).json({
    ok: true,
    import_id: importId,
    suggested_count: suggestedCount,
    confirmed_count: confirmedCount,
    skipped_count: skippedCount,
    rule_autocreated_count: ruleAutocreatedCount,
    rule_auto_create_blocked_count: ruleAutoCreateBlockedCount,
    rule_auto_create_phase_blocked_count: ruleAutoCreatePhaseBlockedCount,
    balance_mutation_blocked: balanceMutationBlocked,
    policy: {
      auto_confirm_mode: 'value_exact_description_fuzzy',
      auto_confirm_text_threshold: AUTO_CONFIRM_TEXT_THRESHOLD,
      auto_confirm_requires_exact_amount: true,
      auto_confirm_date_window_days: AUTO_CONFIRM_DATE_WINDOW_DAYS,
      min_suggested_score: 0.62,
      rule_auto_create_phase_disabled: RULE_AUTO_CREATE_PHASE_DISABLED,
    },
  });
}
