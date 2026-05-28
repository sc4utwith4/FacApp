import { describe, expect, it } from 'vitest';
import {
  buildInsertPayloadFromConfirmItem,
  buildDraftItemFromImport,
  evaluateConfirmPayloadIssues,
  evaluateDuplicateFlags,
  refreshSoiOriginPayloadIfNeeded,
  resolveDuplicateOriginImport,
  summarizeDuplicateFlags,
  type OperationIaContaBancariaRow,
  type OperationIaEstoqueRow,
  type OperationIaFornecedorRow,
  type OperationIaImportRow,
} from '../core';

const fornecedores: OperationIaFornecedorRow[] = [
  {
    id: 'fornecedor-1',
    razao_social: 'Fornecedor Alpha LTDA',
    nome_fantasia: 'Alpha',
    cnpj: '11.222.333/0001-44',
    status: true,
  },
];

const estoques: OperationIaEstoqueRow[] = [
  {
    id: 10,
    tipo: 'SOI',
    descricao: 'SOI Principal',
    ativo: true,
  },
];

const contas: OperationIaContaBancariaRow[] = [
  {
    id: 'conta-1',
    descricao: 'SB-S0I2',
    status: true,
  },
];

const importRowBase: OperationIaImportRow = {
  id: 'import-1',
  empresa_id: 'empresa-1',
  source: 'disecurit',
  parse_status: 'parsed',
  parsed_payload: {
    source: 'disecurit',
    program: 'SOI',
    detected_by: 'keyword',
    confidence: 0.95,
    document: {
      operation_number: 'OP-123',
      date: '2026-03-10',
      payment_date: '2026-03-10',
    },
    parties: {
      client_name: 'Fornecedor Alpha LTDA',
      client_doc: '11.222.333/0001-44',
    },
    values: {
      face_value: 100000,
      purchase_value: 5000,
      net_value: 95000,
      expenses: 0,
      amort_debits: 0,
      amort_credits: 0,
    },
    debug: {
      soi_formula_v2: {
        valor_original: { value: 100000, raw_value: '100000,00', match_type: 'direct_label', confidence: 1 },
        valor_desagio: { value: 5000, raw_value: '5000,00', match_type: 'direct_label', confidence: 1 },
        valor_desagio_antecipacao: { value: 0, raw_value: '0,00', match_type: 'direct_label', confidence: 1 },
        despesas: { value: 0, raw_value: '0,00', match_type: 'direct_label', confidence: 1 },
        regresso: { value: 0, raw_value: '0,00', match_type: 'direct_label', confidence: 1 },
        amortiza_debitos: { value: 0, raw_value: '0,00', match_type: 'direct_label', confidence: 1 },
        amortiza_creditos: { value: 0, raw_value: '0,00', match_type: 'direct_label', confidence: 1 },
        creditos_gerados: { value: 0, raw_value: '0,00', match_type: 'direct_label', confidence: 1 },
        liquido_liberado: { value: 95000, raw_value: '95000,00', match_type: 'direct_label', confidence: 1 },
      },
    },
    raw: {
      text_hash: 'hash-123',
      text_excerpt: '...pdf...',
    },
  },
  linked_operacao_id: null,
  operation_number: 'OP-123',
  original_filename: 'arquivo.pdf',
  file_sha256: 'sha-123',
  program_hint: 'SOI',
  created_at: new Date().toISOString(),
};

describe('operacoes-ia core', () => {
  it('monta item ready quando campos críticos estão presentes', () => {
    const item = buildDraftItemFromImport(importRowBase, fornecedores, estoques, {
      defaultContaBancariaId: 'conta-1',
    });

    expect(item.status).toBe('ready');
    expect(item.fornecedor_id).toBe('fornecedor-1');
    expect(item.estoque_id).toBe(10);
    expect(item.conta_bancaria_id).toBe('conta-1');
    expect(item.issues).toHaveLength(0);
  });

  it('usa referenceDate como fallback quando o parse não traz data no documento', () => {
    const rowNoDocDate: OperationIaImportRow = {
      ...importRowBase,
      parsed_payload: {
        ...(importRowBase.parsed_payload as object),
        document: {
          operation_number: 'OP-999',
        },
      },
    };

    const item = buildDraftItemFromImport(rowNoDocDate, fornecedores, estoques, {
      referenceDate: '2026-01-15',
      defaultContaBancariaId: 'conta-1',
    });

    expect(item.data_operacao).toBe('2026-01-15');
  });

  it('auto-mapeia fornecedor por nome quando CNPJ não vem no payload e há match único', () => {
    const rowWithoutDoc: OperationIaImportRow = {
      ...importRowBase,
      parsed_payload: {
        ...(importRowBase.parsed_payload as object),
        parties: {
          client_name: 'HADASSA TEXTIL EIRELI ME',
          client_doc: null,
        },
      },
    };
    const fornecedoresByName: OperationIaFornecedorRow[] = [
      {
        id: 'fornecedor-hadassa',
        razao_social: 'HADASSA TEXTIL EIRELI ME',
        nome_fantasia: null,
        cnpj: '00.111.222/0001-33',
        status: true,
      },
      {
        id: 'fornecedor-outro',
        razao_social: 'OUTRO FORNECEDOR LTDA',
        nome_fantasia: null,
        cnpj: '11.222.333/0001-99',
        status: true,
      },
    ];

    const item = buildDraftItemFromImport(rowWithoutDoc, fornecedoresByName, estoques, {
      defaultContaBancariaId: 'conta-1',
    });

    expect(item.fornecedor_id).toBe('fornecedor-hadassa');
    expect(item.fornecedor_match_method).toBe('name_fuzzy');
    expect(item.status).toBe('ready');
  });

  it('mantém revisão quando match por nome é ambíguo', () => {
    const rowAmbiguousName: OperationIaImportRow = {
      ...importRowBase,
      parsed_payload: {
        ...(importRowBase.parsed_payload as object),
        parties: {
          client_name: 'FORNECEDOR DUPLICADO LTDA',
          client_doc: null,
        },
      },
    };
    const fornecedoresAmbiguous: OperationIaFornecedorRow[] = [
      {
        id: 'fornecedor-dup-1',
        razao_social: 'FORNECEDOR DUPLICADO LTDA',
        nome_fantasia: null,
        cnpj: '10.000.000/0001-01',
        status: true,
      },
      {
        id: 'fornecedor-dup-2',
        razao_social: 'FORNECEDOR DUPLICADO LTDA',
        nome_fantasia: null,
        cnpj: '10.000.000/0001-02',
        status: true,
      },
    ];

    const item = buildDraftItemFromImport(rowAmbiguousName, fornecedoresAmbiguous, estoques, {
      defaultContaBancariaId: 'conta-1',
    });

    expect(item.fornecedor_id).toBeNull();
    expect(item.status).toBe('review');
    expect(item.issues.some((issue) => issue.includes('Fornecedor ambíguo'))).toBe(true);
  });

  it('retorna issue quando payload de confirmação está sem fornecedor', () => {
    const issues = evaluateConfirmPayloadIssues(
      {
        program: 'SOI',
        estoque_id: 10,
        fornecedor_id: null,
        conta_bancaria_id: 'conta-1',
        data_operacao: '2026-03-10',
        documento: 'OP-123',
        historico: 'Histórico',
        face_titulos: 1000,
        valor_compra: 900,
        despesas: 0,
        recompra: 0,
        ad_valorem: 0,
        iss: 0,
        iof: 0,
        iof_adicional: 0,
        amortizacao_debitos: 0,
        amortizacao_creditos: 0,
      },
      'parsed',
      null,
      estoques[0],
      null,
      contas[0]
    );

    expect(issues.some((issue) => issue.includes('Fornecedor'))).toBe(true);
  });

  it('retorna issue quando payload de confirmação está sem conta bancária', () => {
    const issues = evaluateConfirmPayloadIssues(
      {
        program: 'SOI',
        estoque_id: 10,
        fornecedor_id: 'fornecedor-1',
        conta_bancaria_id: null,
        data_operacao: '2026-03-10',
        documento: 'OP-123',
        historico: 'Histórico',
        face_titulos: 1000,
        valor_compra: 900,
        despesas: 0,
        recompra: 0,
        ad_valorem: 0,
        iss: 0,
        iof: 0,
        iof_adicional: 0,
        amortizacao_debitos: 0,
        amortizacao_creditos: 0,
      },
      'parsed',
      null,
      estoques[0],
      fornecedores[0],
      null
    );

    expect(issues.some((issue) => issue.includes('Conta bancária'))).toBe(true);
  });

  it('sinaliza duplicidade por documento e hash já vinculado', () => {
    const flags = evaluateDuplicateFlags(
      importRowBase,
      'OP-123',
      new Set(['sha-123']),
      new Set(['op 123'])
    );
    const messages = summarizeDuplicateFlags(flags);

    expect(flags.hashAlreadyLinked).toBe(true);
    expect(flags.operationNumberAlreadyExists).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('aplica iof_adicional no cálculo de líquido para SPPRO', () => {
    const baseItem = {
      item_id: 'item-1',
      import_file_id: 'imp-1',
      decision: 'confirm' as const,
      payload: {
        program: 'SPPRO' as const,
        estoque_id: 10,
        fornecedor_id: 'fornecedor-1',
        conta_bancaria_id: 'conta-1',
        data_operacao: '2026-03-10',
        documento: 'OP-123',
        historico: 'Histórico',
        face_titulos: 1000,
        valor_compra: 900,
        despesas: 10,
        recompra: 0,
        ad_valorem: 5,
        iss: 2,
        iof: 3,
        iof_adicional: 0,
        amortizacao_debitos: 0,
        amortizacao_creditos: 0,
      },
    };

    const withoutIofAdditional = buildInsertPayloadFromConfirmItem('empresa-1', 'user-1', baseItem);
    const withIofAdditional = buildInsertPayloadFromConfirmItem('empresa-1', 'user-1', {
      ...baseItem,
      payload: {
        ...baseItem.payload,
        iof_adicional: 20,
      },
    });

    expect(Number(withIofAdditional.liquido_operacao)).toBeLessThan(Number(withoutIofAdditional.liquido_operacao));
  });

  it('resolve origem de duplicado por auditoria com chave variante camelCase', async () => {
    const duplicateImport: OperationIaImportRow = {
      ...importRowBase,
      id: 'dup-1',
      parse_status: 'duplicate',
      parsed_payload: {},
      file_sha256: null,
      operation_number: null,
    };

    const originRow: OperationIaImportRow = {
      ...importRowBase,
      id: 'origin-1',
      parse_status: 'failed',
      parsed_payload: {
        foo: 'bar',
      },
    };

    const adminClient = {
      from: (table: string) => {
        if (table === 'integration_audit_log') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [
                        {
                          details: {
                            response: {
                              existingImportFileId: 'origin-1',
                            },
                          },
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'operation_import_files') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => ({
                    data: [originRow],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Tabela inesperada no teste: ${table}`);
      },
    } as any;

    const resolution = await resolveDuplicateOriginImport(adminClient, 'empresa-1', duplicateImport, 'disecurit');
    expect(resolution.duplicate_hydration_status).toBe('hydrated');
    expect(resolution.duplicate_origin_import_file_id).toBe('origin-1');
    expect(resolution.duplicate_hydration_resolution_method).toBe('audit');
  });

  it('resolve origem por operation_number derivado do nome do arquivo quando campo está vazio', async () => {
    const duplicateImport: OperationIaImportRow = {
      ...importRowBase,
      id: 'dup-2',
      parse_status: 'duplicate',
      parsed_payload: {},
      file_sha256: null,
      operation_number: null,
      original_filename: 'PAPELAO2760.pdf',
    };

    const originRow: OperationIaImportRow = {
      ...importRowBase,
      id: 'origin-2760',
      operation_number: '2760',
      parse_status: 'duplicate',
      parsed_payload: {
        source: 'legacy',
      },
    };

    const adminClient = {
      from: (table: string) => {
        if (table === 'integration_audit_log') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'operation_import_files') {
          return {
            select: () => ({
              eq: () => ({
                ilike: () => ({
                  neq: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [originRow],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Tabela inesperada no teste: ${table}`);
      },
    } as any;

    const resolution = await resolveDuplicateOriginImport(adminClient, 'empresa-1', duplicateImport, 'disecurit');
    expect(resolution.duplicate_hydration_status).toBe('hydrated');
    expect(resolution.duplicate_origin_import_file_id).toBe('origin-2760');
    expect(resolution.duplicate_hydration_resolution_method).toBe('operation_number');
  });

  it('prioriza self_payload válido antes de buscar origem externa', async () => {
    const duplicateImport: OperationIaImportRow = {
      ...importRowBase,
      id: 'dup-self',
      parse_status: 'duplicate',
      operation_number: 'SELF-1',
      file_sha256: 'sha-self',
      parsed_payload: importRowBase.parsed_payload as Record<string, unknown>,
    };

    const adminClient = {
      from: () => {
        throw new Error('Não deveria consultar origem externa quando self_payload é válido.');
      },
    } as any;

    const resolution = await resolveDuplicateOriginImport(adminClient, 'empresa-1', duplicateImport, 'disecurit');
    expect(resolution.duplicate_hydration_status).toBe('hydrated');
    expect(resolution.duplicate_origin_import_file_id).toBe('dup-self');
    expect(resolution.duplicate_hydration_resolution_method).toBe('self_payload');
    expect(resolution.resolution_method).toBe('self_payload');
  });

  it('retorna missing quando auditoria aponta origem sem payload hidratável', async () => {
    const duplicateImport: OperationIaImportRow = {
      ...importRowBase,
      id: 'dup-missing',
      parse_status: 'duplicate',
      parsed_payload: {},
      file_sha256: null,
      operation_number: null,
    };

    const staleOriginRow: OperationIaImportRow = {
      ...importRowBase,
      id: 'origin-stale',
      parse_status: 'parsed',
      parsed_payload: {},
      file_sha256: null,
      operation_number: '9999',
    };

    const adminClient = {
      from: (table: string) => {
        if (table === 'integration_audit_log') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [{ details: { response: { existingImportFileId: 'origin-stale' } } }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'operation_import_files') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => ({
                    data: [staleOriginRow],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Tabela inesperada no teste: ${table}`);
      },
    } as any;

    const resolution = await resolveDuplicateOriginImport(adminClient, 'empresa-1', duplicateImport, 'disecurit');
    expect(resolution.duplicate_hydration_status).toBe('missing');
    expect(resolution.duplicate_origin_import_file_id).toBeNull();
    expect(resolution.duplicate_hydration_resolution_method).toBe('none');
    expect(resolution.source_import_row).toBeNull();
  });

  it('marca origem SOI como stale quando falta raw_text para auto-reparse', async () => {
    const staleRow: OperationIaImportRow = {
      ...importRowBase,
      id: 'origin-without-raw',
      parse_status: 'parsed',
      parsed_payload: {
        source: 'disecurit',
        program: 'SOI',
        debug: {},
      },
      raw_text: null,
    };

    const adminClient = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as any;

    const refreshed = await refreshSoiOriginPayloadIfNeeded(adminClient, staleRow);
    expect(refreshed.refreshed).toBe(false);
    expect(refreshed.status).toBe('source_stale');
    expect(refreshed.row.id).toBe('origin-without-raw');
  });
});
