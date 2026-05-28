import { describe, expect, it } from 'vitest';
import { mapToUiSOI, mapToUiSPPRO } from '../disecuritMappers';
import {
  getImportProgram,
  normalizeLegacyToCanonical,
  resolveProgramForPrefill,
  toOperationImportDocuments,
} from '../disecuritAdapters';
import type { DisecuritParseResult, ParsedPayloadDisecurit } from '@/types/disecurit-import';

const canonicalSPPRO: DisecuritParseResult = {
  source: 'disecurit',
  program: 'SPPRO',
  detected_by: 'keyword',
  confidence: 0.92,
  document: {
    bordero_number: '9876',
    date: '2026-02-10',
  },
  values: {
    face_value: 12500,
    purchase_value: 11850,
    ad_valorem: 120,
    iss: 18,
    iof: 25,
    iof_additional: 5,
    expenses: 32,
    amort_debits: 0,
    amort_credits: 0,
    net_value: 11500,
  },
  raw: {
    text_hash: 'a'.repeat(64),
    text_excerpt: 'fixture',
  },
};

const canonicalSOI: DisecuritParseResult = {
  source: 'disecurit',
  program: 'SOI',
  detected_by: 'keyword',
  confidence: 0.9,
  document: {
    operation_number: '2588',
    payment_date: '2026-02-09',
    date: '2026-02-09',
  },
  parties: {
    client_name: 'SILVA COMERCIO E SERVICOS EIRELI',
    client_doc: '39.890.160/0001-99',
  },
  values: {
    face_value: 6100,
    discount_value: 369.09,
    expenses: 10,
    amort_debits: 0,
    amort_credits: 5,
    net_value: 5730.91,
  },
  documents: [
    {
      debtor_name: 'RLG ALIMENTOS LTDA',
      debtor_doc: '04.766.105/0003-79',
      document: '9/001',
      due_date: '2026-03-09',
      value: 1030,
      discount: 55.02,
      net: 974.98,
      doc_type: 'DP',
    },
  ],
  raw: {
    text_hash: 'b'.repeat(64),
    text_excerpt: 'fixture',
  },
};

describe('disecuritMappers/adapters', () => {
  it('mapToUiSPPRO mapeia campos esperados do formulário', () => {
    const mapped = mapToUiSPPRO(canonicalSPPRO);

    expect(mapped.data).toBe('2026-02-10');
    expect(mapped.documento).toBe('9876');
    expect(mapped.faceDosTitulos).toBe(12500);
    expect(mapped.valorDeCompra).toBe(11850);
    expect(mapped.adValorem).toBe(120);
    expect(mapped.iofAdicional).toBe(5);
  });

  it('mapToUiSOI usa net_value como valorDeCompra e gera histórico', () => {
    const mapped = mapToUiSOI(canonicalSOI);

    expect(mapped.data).toBe('2026-02-09');
    expect(mapped.documento).toBe('2588');
    expect(mapped.faceDosTitulos).toBe(6100);
    expect(mapped.valorDeCompra).toBe(5730.91);
    expect(mapped.historico).toContain('DISECURIT/SOI Operação 2588');
  });

  it('resolveProgramForPrefill prioriza estoque selecionado', () => {
    expect(resolveProgramForPrefill('SPPRO', canonicalSOI)).toBe('SPPRO');
    expect(resolveProgramForPrefill(null, canonicalSOI)).toBe('SOI');
  });

  it('normaliza payload legado para schema canônico', () => {
    const legacyPayload: ParsedPayloadDisecurit = {
      source: 'disecurit',
      operation_number: '2588',
      dt_pagamento: '2026-02-09',
      client: {
        name: 'Cliente Legado',
        cnpj: '39.890.160/0001-99',
      },
      totals: {
        valor: 6100,
        desagio: 369.09,
        liquido: 5730.91,
      },
      documents: [
        {
          sacado_nome: 'RLG ALIMENTOS LTDA',
          sacado_cnpj: '04.766.105/0003-79',
          documento: '9/001',
          vencimento: '2026-03-09',
          valor: 1030,
          desagio: 55.02,
          liquido: 974.98,
          tipo_doc: 'DP',
        },
      ],
    };

    const normalized = normalizeLegacyToCanonical(legacyPayload);

    expect(normalized?.program).toBe('SOI');
    expect(normalized?.document.operation_number).toBe('2588');
    expect(normalized?.values.face_value).toBe(6100);
    expect(normalized?.values.discount_value).toBe(369.09);
    expect(normalized?.documents?.[0].document).toBe('9/001');
  });

  it('converte documentos canônicos para estrutura usada no vínculo', () => {
    const docs = toOperationImportDocuments(canonicalSOI);

    expect(docs).toHaveLength(1);
    expect(docs[0].sacado_nome).toBe('RLG ALIMENTOS LTDA');
    expect(docs[0].documento).toBe('9/001');
    expect(docs[0].liquido).toBe(974.98);
  });

  it('usa program_hint quando parsed_payload não informa programa', () => {
    const resolved = getImportProgram({
      parsed_payload: null,
      program_hint: 'SPPRO',
    });

    expect(resolved).toBe('SPPRO');
  });

  it('prioriza programa do payload sobre program_hint', () => {
    const resolved = getImportProgram({
      parsed_payload: {
        source: 'disecurit',
        program: 'SOI',
        document: { operation_number: '2588', date: '2026-02-09' },
        values: { face_value: 1000, net_value: 900 },
        raw: { text_hash: 'a'.repeat(64), text_excerpt: 'fixture' },
      },
      program_hint: 'SPPRO',
    });

    expect(resolved).toBe('SOI');
  });
});
