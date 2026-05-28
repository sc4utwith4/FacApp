import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getBankReconciliationIntegrationSecret,
  validateBankReconciliationPilotScope,
  getBankReconciliationWebhookTimeoutMs,
  getBankReconciliationWebhookUrl,
  safeInsertBankAuditLog,
} from './_shared.js';
import {
  createBankAiExecutionRun,
  updateBankAiExecutionRunStatus,
} from './aiExecutionRuns.js';

export interface TriggerBankAiWorkflowArgs {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  extratoImportId: string;
  initiatedByUserId?: string | null;
  source?: string;
  reason?: string;
}

export interface TriggerBankAiWorkflowResult {
  attempted: boolean;
  triggered: boolean;
  status_code: number | null;
  message: string;
  response: unknown | null;
  correlation_id?: string | null;
  execution_run_id?: string | null;
}

async function supersedeOpenAiSuggestionsForImport(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  extratoImportId: string;
}): Promise<number> {
  const { data: txRows, error: txError } = await args.adminClient
    .from('extrato_transacoes')
    .select('id')
    .eq('empresa_id', args.empresaId)
    .eq('extrato_import_id', args.extratoImportId)
    .limit(5000);

  if (txError) {
    throw new Error(`Falha ao carregar transacoes para supersede de sugestoes IA: ${txError.message}`);
  }

  const txIds = ((txRows || []) as Array<{ id: string }>)
    .map((row) => String(row.id || '').trim())
    .filter(Boolean);

  if (txIds.length === 0) return 0;

  const { data: updatedRows, error: updateError } = await args.adminClient
    .from('bank_ai_suggestions')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', args.empresaId)
    .eq('status', 'suggested')
    .in('extrato_transacao_id', txIds)
    .select('id');

  if (updateError) {
    throw new Error(`Falha ao supersede sugestões IA abertas: ${updateError.message}`);
  }

  return Array.isArray(updatedRows) ? updatedRows.length : 0;
}

export async function triggerBankReconciliationAiWorkflow(
  args: TriggerBankAiWorkflowArgs
): Promise<TriggerBankAiWorkflowResult> {
  const {
    adminClient,
    empresaId,
    contaBancariaId,
    extratoImportId,
    initiatedByUserId = null,
    source = 'bank_reconciliation',
    reason = null,
  } = args;

  const webhookUrl = getBankReconciliationWebhookUrl();
  const integrationSecret = getBankReconciliationIntegrationSecret();
  const timeoutMs = getBankReconciliationWebhookTimeoutMs();
  const pilotGate = validateBankReconciliationPilotScope(empresaId, contaBancariaId);

  let executionRun:
    | {
        id: string;
        correlation_id: string;
      }
    | null = null;

  if (!pilotGate.allowed) {
    const message = `Trigger IA bloqueado por configuracao de escopo: ${pilotGate.reason || 'fora de escopo'}.`;
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_workflow_trigger_skipped_scope_gate',
      status: 'warning',
      message,
      created_by: initiatedByUserId,
      details: {
        scope_gate_enabled: pilotGate.enabled,
        reason: pilotGate.reason,
        conta_bancaria_id: contaBancariaId,
      },
    });
    return {
      attempted: false,
      triggered: false,
      status_code: null,
      message,
      response: null,
      correlation_id: null,
      execution_run_id: null,
    };
  }

  if (!webhookUrl || !integrationSecret) {
    const message = 'Webhook/secret de integracao bancaria nao configurados.';
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_workflow_trigger_skipped_config',
      status: 'warning',
      message,
      created_by: initiatedByUserId,
      details: {
        has_webhook_url: Boolean(webhookUrl),
        has_integration_secret: Boolean(integrationSecret),
      },
    });
    return {
      attempted: false,
      triggered: false,
      status_code: null,
      message,
      response: null,
      correlation_id: null,
      execution_run_id: null,
    };
  }

  try {
    const run = await createBankAiExecutionRun({
      adminClient,
      empresaId,
      contaBancariaId,
      extratoImportId,
      triggerSource: source,
      createdBy: initiatedByUserId,
      metadata: {
        reason,
        trigger_path: 'webhook',
      },
    });
    executionRun = {
      id: run.id,
      correlation_id: run.correlation_id,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Falha ao registrar execução IA';
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_execution_run_create_failed',
      status: 'error',
      message,
      created_by: initiatedByUserId,
      details: {
        conta_bancaria_id: contaBancariaId,
        source,
        reason,
      },
    });
    return {
      attempted: false,
      triggered: false,
      status_code: null,
      message,
      response: null,
      correlation_id: null,
      execution_run_id: null,
    };
  }

  let supersededSuggestedCount = 0;
  try {
    supersededSuggestedCount = await supersedeOpenAiSuggestionsForImport({
      adminClient,
      empresaId,
      extratoImportId,
    });

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_suggestions_superseded_before_trigger',
      status: 'info',
      message: `Sugestoes IA abertas superseded antes do trigger: ${supersededSuggestedCount}.`,
      created_by: initiatedByUserId,
      details: {
        superseded_suggested_count: supersededSuggestedCount,
        correlation_id: executionRun?.correlation_id || null,
        execution_run_id: executionRun?.id || null,
      },
    });

    if (executionRun?.correlation_id) {
      await updateBankAiExecutionRunStatus({
        adminClient,
        empresaId,
        correlationId: executionRun.correlation_id,
        metadataPatch: {
          superseded_suggested_count: supersededSuggestedCount,
          superseded_before_trigger_at: new Date().toISOString(),
        },
      }).catch(() => null);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Falha ao supersede sugestões IA abertas antes do trigger.';

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_suggestions_supersede_before_trigger_failed',
      status: 'error',
      message,
      created_by: initiatedByUserId,
      details: {
        correlation_id: executionRun?.correlation_id || null,
        execution_run_id: executionRun?.id || null,
      },
    });

    if (executionRun?.correlation_id) {
      await updateBankAiExecutionRunStatus({
        adminClient,
        empresaId,
        correlationId: executionRun.correlation_id,
        status: 'failed',
        errorMessage: message,
        metadataPatch: {
          superseded_before_trigger_failed: true,
        },
        setCompletedAt: true,
      }).catch(() => null);
    }

    return {
      attempted: false,
      triggered: false,
      status_code: null,
      message,
      response: null,
      correlation_id: executionRun?.correlation_id || null,
      execution_run_id: executionRun?.id || null,
    };
  }

  const payload = {
    empresa_id: empresaId,
    conta_bancaria_id: contaBancariaId,
    extrato_import_id: extratoImportId,
    correlation_id: executionRun?.correlation_id || null,
    source,
    reason,
    triggered_at: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let responseText = '';
  let responseJson: unknown = null;
  let statusCode: number | null = null;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-secret': integrationSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    statusCode = response.status;
    responseText = await response.text().catch(() => '');

    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = responseText || null;
    }

    if (!response.ok) {
      const message = `Webhook n8n retornou erro (${response.status}).`;
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: empresaId,
        extrato_import_id: extratoImportId,
        action: 'ai_workflow_trigger_failed',
        status: 'error',
        message,
        created_by: initiatedByUserId,
        details: {
          webhook_status: response.status,
          response: responseJson,
          correlation_id: executionRun?.correlation_id || null,
          execution_run_id: executionRun?.id || null,
        },
      });
      if (executionRun?.correlation_id) {
        await updateBankAiExecutionRunStatus({
          adminClient,
          empresaId,
          correlationId: executionRun.correlation_id,
          status: 'failed',
          errorMessage: message,
          metadataPatch: {
            webhook_status: response.status,
            response: responseJson,
          },
          setCompletedAt: true,
        }).catch(() => null);
      }
      return {
        attempted: true,
        triggered: false,
        status_code: response.status,
        message,
        response: responseJson,
        correlation_id: executionRun?.correlation_id || null,
        execution_run_id: executionRun?.id || null,
      };
    }

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_workflow_triggered',
      status: 'success',
      message: 'Webhook de conciliacao bancaria acionado com sucesso.',
      created_by: initiatedByUserId,
      details: {
        webhook_status: response.status,
        response: responseJson,
        correlation_id: executionRun?.correlation_id || null,
        execution_run_id: executionRun?.id || null,
      },
    });

    return {
      attempted: true,
      triggered: true,
      status_code: response.status,
      message: 'Webhook acionado com sucesso.',
      response: responseJson,
      correlation_id: executionRun?.correlation_id || null,
      execution_run_id: executionRun?.id || null,
    };
  } catch (error: unknown) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const message = isTimeout
      ? `Timeout ao acionar webhook n8n (${timeoutMs}ms).`
      : error instanceof Error
        ? error.message
        : 'Erro desconhecido ao acionar webhook n8n.';

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_workflow_trigger_exception',
      status: 'error',
      message,
      created_by: initiatedByUserId,
      details: {
        timeout_ms: timeoutMs,
        correlation_id: executionRun?.correlation_id || null,
        execution_run_id: executionRun?.id || null,
      },
    });
    if (executionRun?.correlation_id) {
      await updateBankAiExecutionRunStatus({
        adminClient,
        empresaId,
        correlationId: executionRun.correlation_id,
        status: 'failed',
        errorMessage: message,
        metadataPatch: {
          timeout_ms: timeoutMs,
        },
        setCompletedAt: true,
      }).catch(() => null);
    }

    return {
      attempted: true,
      triggered: false,
      status_code: statusCode,
      message,
      response: responseJson,
      correlation_id: executionRun?.correlation_id || null,
      execution_run_id: executionRun?.id || null,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
