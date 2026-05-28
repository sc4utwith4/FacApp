import { describe, expect, it, vi } from 'vitest';
import { BankImportReprocessConflictError, processBankImport } from '../_import-core';

function makeAwaitableQuery(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    order: vi.fn(() => query),
    gte: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  };
  return query;
}

describe('processBankImport forceReprocess safety guard', () => {
  it('blocks reset with 409-domain error when confirmed reconciliations exist', async () => {
    const importRow = {
      id: 'import-1',
      empresa_id: 'empresa-1',
      conta_bancaria_id: 'conta-1',
      parse_status: 'parsed',
      parse_attempts: 1,
      source: 'bradesco',
      file_format: 'csv',
      file_storage_bucket: 'extratos-bancarios',
      file_storage_key: 'imports/import-1.csv',
      periodo_inicio: null,
      periodo_fim: null,
      error_message: null,
      file_sha256: 'hash-1',
    };

    const updateSpy = vi.fn(() => makeAwaitableQuery(null));
    const storageDownloadSpy = vi.fn();

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === 'extratos_import') {
          return {
            select: vi.fn((columns: string) => {
              if (columns === '*') {
                const query: Record<string, unknown> = {
                  eq: vi.fn(() => query),
                  maybeSingle: vi.fn(async () => ({ data: importRow, error: null })),
                };
                return query;
              }
              if (columns === 'id') {
                return makeAwaitableQuery([]);
              }
              throw new Error(`Unexpected extratos_import select columns: ${columns}`);
            }),
            update: updateSpy,
          };
        }

        if (table === 'extrato_transacoes') {
          return {
            select: vi.fn(() => makeAwaitableQuery([{ id: 'tx-1' }])),
            delete: vi.fn(() => makeAwaitableQuery(null)),
          };
        }

        if (table === 'conciliacoes_bancarias') {
          return {
            select: vi.fn(() => makeAwaitableQuery([{ id: 'conc-1' }])),
            delete: vi.fn(() => makeAwaitableQuery(null)),
          };
        }

        if (table === 'bank_ai_suggestions') {
          return {
            delete: vi.fn(() => makeAwaitableQuery(null)),
          };
        }

        if (table === 'bank_reconciliation_audit_log') {
          return {
            insert: vi.fn(async () => ({ error: null })),
          };
        }

        throw new Error(`Unexpected table access in reprocess test: ${table}`);
      }),
      storage: {
        from: vi.fn(() => ({
          download: storageDownloadSpy,
        })),
      },
    };

    let capturedError: unknown = null;
    try {
      await processBankImport({
        adminClient: adminClient as never,
        empresaId: 'empresa-1',
        importId: 'import-1',
        userId: 'user-1',
        forceReprocess: true,
      });
    } catch (error: unknown) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(BankImportReprocessConflictError);
    expect((capturedError as BankImportReprocessConflictError).code).toBe('reprocess_blocked_confirmed');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(storageDownloadSpy).not.toHaveBeenCalled();
  });
});
