#!/usr/bin/env node
/* eslint-disable no-console */

const DEFAULT_EMPRESA_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_OPERATION_NUMBERS = ['2759', '2760', '2761', '2762'];

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function assertEnv(name) {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function normalizeOperationNumber(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function inferOperationNumberFromFilename(filename) {
  const match = String(filename || '').match(/(\d{3,8})/);
  return match ? normalizeOperationNumber(match[1]) : '';
}

function hasSoiFormulaV2(payload) {
  const debug = payload && typeof payload === 'object' ? payload.debug : null;
  const formula = debug && typeof debug === 'object' ? debug.soi_formula_v2 : null;
  if (!formula || typeof formula !== 'object') return false;
  const required = ['valor_original', 'valor_desagio', 'despesas', 'liquido_liberado'];
  return required.every((key) => {
    const raw = formula[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return true;
    if (!raw || typeof raw !== 'object') return false;
    const nested = Number(raw.value);
    return Number.isFinite(nested);
  });
}

function isSoiRow(row) {
  const programHint = String(row.program_hint || '').toUpperCase();
  const payloadProgram = String(row?.parsed_payload?.program || '').toUpperCase();
  return programHint === 'SOI' || payloadProgram === 'SOI';
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { response, payload };
}

async function main() {
  const supabaseUrl = assertEnv('VITE_SUPABASE_URL');
  const serviceRole = assertEnv('SUPABASE_SERVICE_ROLE_KEY');
  const webhookUrl = assertEnv('N8N_DISECURIT_IMPORT_WEBHOOK_URL');
  const webhookSecret = assertEnv('N8N_DISECURIT_INTEGRATION_SECRET');
  const empresaId = env('OPERACOES_IA_REPAIR_EMPRESA_ID', DEFAULT_EMPRESA_ID);
  const userId = env('OPERACOES_IA_REPAIR_USER_ID', '00000000-0000-0000-0000-000000000000');
  const dryRun = String(env('OPERACOES_IA_REPAIR_DRY_RUN', 'false')).toLowerCase() === 'true';

  const operationNumbersRaw = env('OPERACOES_IA_REPAIR_OPERATION_NUMBERS', DEFAULT_OPERATION_NUMBERS.join(','));
  const operationSet = new Set(
    String(operationNumbersRaw)
      .split(',')
      .map((value) => normalizeOperationNumber(value))
      .filter(Boolean)
  );

  const query = new URLSearchParams({
    select:
      'id,empresa_id,source,parse_status,program_hint,operation_number,original_filename,file_storage_bucket,file_storage_key,parsed_payload,parse_attempts,created_at',
    empresa_id: `eq.${empresaId}`,
    source: 'eq.disecurit',
    parse_status: 'eq.duplicate',
    order: 'created_at.desc',
    limit: '300',
  });

  const listUrl = `${supabaseUrl}/rest/v1/operation_import_files?${query.toString()}`;
  const { response: listResponse, payload: rowsPayload } = await requestJson(listUrl, {
    method: 'GET',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Accept: 'application/json',
    },
  });

  if (!listResponse.ok) {
    throw new Error(`Failed to list duplicate imports: HTTP ${listResponse.status}`);
  }

  const rows = Array.isArray(rowsPayload) ? rowsPayload : [];
  const candidates = rows.filter((row) => {
    if (!isSoiRow(row)) return false;
    if (hasSoiFormulaV2(row.parsed_payload || null)) return false;
    const operationNumber = normalizeOperationNumber(row.operation_number || '');
    const inferred = inferOperationNumberFromFilename(row.original_filename || '');
    const key = operationNumber || inferred;
    if (!operationSet.size) return true;
    return key ? operationSet.has(key) : false;
  });

  console.log(
    JSON.stringify(
      {
        total_duplicates: rows.length,
        candidates: candidates.length,
        empresa_id: empresaId,
        operation_numbers_filter: Array.from(operationSet),
        dry_run: dryRun,
      },
      null,
      2
    )
  );

  const results = [];

  for (const row of candidates) {
    const importId = String(row.id || '').trim();
    if (!importId) continue;

    const nextAttempts = Number(row.parse_attempts || 0) + 1;
    const patchUrl =
      `${supabaseUrl}/rest/v1/operation_import_files` +
      `?id=eq.${encodeURIComponent(importId)}&empresa_id=eq.${encodeURIComponent(empresaId)}`;

    if (dryRun) {
      results.push({
        import_file_id: importId,
        status: 'skipped',
        reason: 'dry_run',
      });
      continue;
    }

    const patchResp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        parse_status: 'processing',
        parse_attempts: nextAttempts,
        error_message: null,
        program_hint: row.program_hint || 'SOI',
      }),
    });

    if (!patchResp.ok) {
      results.push({
        import_file_id: importId,
        status: 'failed',
        reason: `patch_failed_http_${patchResp.status}`,
      });
      continue;
    }

    const webhookResp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-secret': webhookSecret,
      },
      body: JSON.stringify({
        action: 'reprocess',
        import_file_id: importId,
        empresa_id: empresaId,
        user_id: userId,
        source: 'disecurit',
        storage_bucket: row.file_storage_bucket,
        storage_key: row.file_storage_key,
        program_hint: row.program_hint || 'SOI',
        hints: {
          program_hint: row.program_hint || 'SOI',
        },
        reason: `repair_duplicate_soi_formula_v2:${importId}`,
        triggered_at: new Date().toISOString(),
      }),
    });

    const webhookText = await webhookResp.text().catch(() => '');
    let webhookPayload = null;
    try {
      webhookPayload = webhookText ? JSON.parse(webhookText) : null;
    } catch {
      webhookPayload = { raw: webhookText };
    }

    if (!webhookResp.ok) {
      results.push({
        import_file_id: importId,
        status: 'failed',
        reason: `webhook_failed_http_${webhookResp.status}`,
      });
      continue;
    }

    results.push({
      import_file_id: importId,
      status: webhookPayload?.status || 'processing',
      reason: webhookPayload?.reason || null,
      workflow_version: webhookPayload?.workflow_version || null,
    });
  }

  const summary = {
    total: results.length,
    repaired: results.filter((item) => item.status === 'parsed' || item.status === 'parse_partial' || item.status === 'duplicate').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((error) => {
  console.error('[repair-operacoes-ia-duplicate-soi] fatal:', error?.message || error);
  process.exitCode = 1;
});
