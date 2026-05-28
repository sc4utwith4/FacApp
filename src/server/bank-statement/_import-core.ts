import { parseBradescoCsv } from '../../lib/bank-reconciliation/bradescoCsvParser.js';
import { parseOfx } from '../../lib/bank-reconciliation/ofxParser.js';
import type { BankImportParseStatus, ParsedBankStatementResult } from '../../types/bank-reconciliation.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeInsertBankAuditLog } from './_shared.js';

const isDuplicateError = (error: unknown): boolean => {
  const errorRecord = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const code = String(errorRecord?.code || '');
  const message = String(errorRecord?.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key value') || message.includes('already exists');
};

export interface ProcessBankImportArgs {
  adminClient: SupabaseClient;
  empresaId: string;
  importId: string;
  userId?: string | null;
  forceReprocess?: boolean;
}

export interface ProcessBankImportResult {
  ok: boolean;
  import_id: string;
  parse_status: BankImportParseStatus;
  inserted_count: number;
  skipped_count: number;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  warnings: string[];
  errors: string[];
}

export class BankImportReprocessConflictError extends Error {
  readonly code = 'reprocess_blocked_confirmed';

  constructor(message: string) {
    super(message);
    this.name = 'BankImportReprocessConflictError';
  }
}

export async function processBankImport(args: ProcessBankImportArgs): Promise<ProcessBankImportResult> {
  const { adminClient, empresaId, importId, userId, forceReprocess = false } = args;

  const { data: importRow, error: importError } = await adminClient
    .from('extratos_import')
    .select('*')
    .eq('id', importId)
    .eq('empresa_id', empresaId)
    .maybeSingle();

  if (importError) {
    throw new Error(`Falha ao buscar importacao: ${importError.message}`);
  }

  if (!importRow) {
    throw new Error('Importacao nao encontrada para a empresa.');
  }

  if (!forceReprocess && importRow.parse_status === 'parsed') {
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: importId,
      action: 'import_skipped_already_parsed',
      status: 'info',
      message: 'Importacao ja estava em parsed.',
      created_by: userId || null,
    });

    return {
      ok: true,
      import_id: importId,
      parse_status: 'parsed',
      inserted_count: 0,
      skipped_count: 0,
      periodo_inicio: importRow.periodo_inicio || null,
      periodo_fim: importRow.periodo_fim || null,
      warnings: ['Importacao ja estava em status parsed.'],
      errors: [],
    };
  }

  const { data: duplicateRows, error: duplicateCheckError } = await adminClient
    .from('extratos_import')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('conta_bancaria_id', importRow.conta_bancaria_id)
    .eq('file_sha256', importRow.file_sha256)
    .neq('id', importId)
    .limit(1);

  if (duplicateCheckError) {
    throw new Error(`Falha ao validar duplicidade do arquivo: ${duplicateCheckError.message}`);
  }

  if ((duplicateRows || []).length > 0) {
    await adminClient
      .from('extratos_import')
      .update({
        parse_status: 'duplicate',
        error_message: `Arquivo duplicado. Importacao original: ${duplicateRows[0].id}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', importId)
      .eq('empresa_id', empresaId);

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: importId,
      action: 'import_duplicate_file',
      status: 'warning',
      message: `Arquivo duplicado. Importacao original: ${duplicateRows[0].id}`,
      created_by: userId || null,
    });

    return {
      ok: true,
      import_id: importId,
      parse_status: 'duplicate',
      inserted_count: 0,
      skipped_count: 0,
      periodo_inicio: null,
      periodo_fim: null,
      warnings: [`Arquivo duplicado. Importacao original: ${duplicateRows[0].id}`],
      errors: [],
    };
  }

  if (forceReprocess) {
    const { data: existingTxRows, error: existingTxError } = await adminClient
      .from('extrato_transacoes')
      .select('id')
      .eq('empresa_id', empresaId)
      .eq('extrato_import_id', importId)
      .limit(5000);

    if (existingTxError) {
      throw new Error(`Falha ao carregar transacoes existentes para reprocessamento: ${existingTxError.message}`);
    }

    const txIds = (existingTxRows || [])
      .map((row) => String((row as { id?: string }).id || '').trim())
      .filter(Boolean);

    if (txIds.length > 0) {
      const { data: confirmedRows, error: confirmedError } = await adminClient
        .from('conciliacoes_bancarias')
        .select('id')
        .eq('empresa_id', empresaId)
        .eq('status', 'confirmed')
        .in('extrato_transacao_id', txIds)
        .limit(1);

      if (confirmedError) {
        throw new Error(
          `Falha ao validar conciliacoes confirmadas antes do reset de reprocessamento: ${confirmedError.message}`
        );
      }

      if ((confirmedRows || []).length > 0) {
        const message =
          'Reprocessamento bloqueado: existem conciliacoes confirmadas para este import. Reverta/ajuste as conciliacoes antes de reprocessar.';

        await safeInsertBankAuditLog(adminClient, {
          empresa_id: empresaId,
          extrato_import_id: importId,
          action: 'import_reprocess_reset_blocked_confirmed',
          status: 'warning',
          message,
          created_by: userId || null,
          details: {
            tx_count: txIds.length,
          },
        });

        throw new BankImportReprocessConflictError(message);
      }

      const { error: deleteSuggestionsError } = await adminClient
        .from('bank_ai_suggestions')
        .delete()
        .eq('empresa_id', empresaId)
        .in('extrato_transacao_id', txIds);

      if (deleteSuggestionsError) {
        throw new Error(
          `Falha ao limpar sugestoes IA antes do reprocessamento: ${deleteSuggestionsError.message}`
        );
      }

      const { error: deleteConciliacoesError } = await adminClient
        .from('conciliacoes_bancarias')
        .delete()
        .eq('empresa_id', empresaId)
        .in('extrato_transacao_id', txIds);

      if (deleteConciliacoesError) {
        throw new Error(
          `Falha ao limpar conciliacoes antes do reprocessamento: ${deleteConciliacoesError.message}`
        );
      }

      const { error: deleteTxError } = await adminClient
        .from('extrato_transacoes')
        .delete()
        .eq('empresa_id', empresaId)
        .eq('extrato_import_id', importId);

      if (deleteTxError) {
        throw new Error(`Falha ao limpar transacoes antes do reprocessamento: ${deleteTxError.message}`);
      }

      await safeInsertBankAuditLog(adminClient, {
        empresa_id: empresaId,
        extrato_import_id: importId,
        action: 'import_reprocess_reset_rebuilt',
        status: 'info',
        message: 'Dados operacionais do import limpos para reprocessamento completo.',
        created_by: userId || null,
        details: {
          tx_count: txIds.length,
        },
      });
    }
  }

  const parseAttempts = Number(importRow.parse_attempts || 0) + 1;

  const { error: processingError } = await adminClient
    .from('extratos_import')
    .update({
      parse_status: 'processing',
      parse_attempts: parseAttempts,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', importId)
    .eq('empresa_id', empresaId);

  if (processingError) {
    throw new Error(`Falha ao atualizar status de processamento: ${processingError.message}`);
  }

  const storageBucket = importRow.file_storage_bucket || 'extratos-bancarios';
  const storageKey = importRow.file_storage_key;

  const { data: fileBlob, error: downloadError } = await adminClient.storage
    .from(storageBucket)
    .download(storageKey);

  if (downloadError || !fileBlob) {
    const message = downloadError?.message || 'Arquivo nao encontrado no storage';
    await adminClient
      .from('extratos_import')
      .update({
        parse_status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', importId)
      .eq('empresa_id', empresaId);

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: importId,
      action: 'import_file_download_failed',
      status: 'error',
      message,
      created_by: userId || null,
    });

    return {
      ok: false,
      import_id: importId,
      parse_status: 'failed',
      inserted_count: 0,
      skipped_count: 0,
      periodo_inicio: null,
      periodo_fim: null,
      warnings: [],
      errors: [message],
    };
  }

  const fileText = await fileBlob.text();

  let parsed: ParsedBankStatementResult;
  const source = String(importRow.source || '').toLowerCase();
  const fileFormat = String(importRow.file_format || '').toLowerCase();

  if (fileFormat === 'csv' && source === 'bradesco') {
    parsed = parseBradescoCsv(fileText);
  } else if (fileFormat === 'ofx') {
    parsed = parseOfx(fileText);
  } else {
    const message = 'Formato/origem nao suportado. Use CSV Bradesco ou OFX.';

    await adminClient
      .from('extratos_import')
      .update({
        parse_status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', importId)
      .eq('empresa_id', empresaId);

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: importId,
      action: 'import_parse_failed',
      status: 'error',
      message,
      created_by: userId || null,
      details: {
        source,
        file_format: fileFormat,
      },
    });

    return {
      ok: false,
      import_id: importId,
      parse_status: 'failed',
      inserted_count: 0,
      skipped_count: 0,
      periodo_inicio: null,
      periodo_fim: null,
      warnings: [],
      errors: [message],
    };
  }

  let insertedCount = 0;
  let skippedCount = 0;
  const rowErrors: string[] = [];

  for (const tx of parsed.transactions) {
    const payload = {
      empresa_id: empresaId,
      extrato_import_id: importId,
      conta_bancaria_id: importRow.conta_bancaria_id,
      fit_id: tx.fit_id || null,
      hash_fallback: tx.hash_fallback,
      line_number: tx.line_number,
      dedupe_ordinal: tx.dedupe_ordinal,
      data_movimento: tx.data_movimento,
      data_compensacao: tx.data_compensacao || null,
      descricao_raw: tx.descricao_raw,
      descricao_norm: tx.descricao_norm,
      valor_centavos: tx.valor_centavos,
      tipo: tx.tipo,
      documento_ref: tx.documento_ref || null,
      metadata: {
        ...(tx.metadata || {}),
        imported_by: userId || null,
      },
    };

    const { error: insertError } = await adminClient.from('extrato_transacoes').insert(payload);

    if (!insertError) {
      insertedCount += 1;
      continue;
    }

    if (isDuplicateError(insertError)) {
      skippedCount += 1;
      continue;
    }

    rowErrors.push(`Linha ${tx.line_number}: ${insertError.message}`);
  }

  const warnings = [...parsed.warnings];
  const errors = [...parsed.errors, ...rowErrors];

  const parseStatus: BankImportParseStatus = insertedCount + skippedCount > 0 && errors.length === 0 ? 'parsed' : 'failed';

  const statusMessage =
    errors.length > 0 ? errors.slice(0, 5).join(' | ') : warnings.length > 0 ? warnings.slice(0, 5).join(' | ') : null;

  await adminClient
    .from('extratos_import')
    .update({
      parse_status: parseStatus,
      periodo_inicio: parsed.periodo_inicio,
      periodo_fim: parsed.periodo_fim,
      error_message: statusMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', importId)
    .eq('empresa_id', empresaId);

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: empresaId,
    extrato_import_id: importId,
    action: parseStatus === 'parsed' ? 'import_parsed' : 'import_failed',
    status: parseStatus === 'parsed' ? 'success' : 'error',
    message: statusMessage,
    created_by: userId || null,
    details: {
      source,
      file_format: fileFormat,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      warning_count: warnings.length,
      error_count: errors.length,
      periodo_inicio: parsed.periodo_inicio,
      periodo_fim: parsed.periodo_fim,
    },
  });

  return {
    ok: parseStatus === 'parsed',
    import_id: importId,
    parse_status: parseStatus,
    inserted_count: insertedCount,
    skipped_count: skippedCount,
    periodo_inicio: parsed.periodo_inicio,
    periodo_fim: parsed.periodo_fim,
    warnings,
    errors,
  };
}
