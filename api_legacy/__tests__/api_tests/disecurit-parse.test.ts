import { describe, expect, it } from 'vitest';
import handler from '../../disecurit-parse';

interface MockResponse {
  statusCode: number;
  payload: any;
  status: (code: number) => MockResponse;
  json: (data: any) => MockResponse;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.payload = data;
      return this;
    },
  };
}

const spproRawText = `
DEMONSTRATIVO DE OPERAÇÃO DE FOMENTO MERCANTIL - FACTORING
COMPRA DE CRÉDITOS. PAGAMENTO A VISTA
Títulos Discriminados no Borderô nº 773, em Anexo. ( ) 11/02/2026
Valor de Face dos Títulos: R$: 88.653,66
80.035,47 R$: ( = ) Valor Líquido da Operação:
`;

const soiRawText = `
BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1
Operação: Prazo Médio: Fator Período: Taxa Efetiva: Fator Nominal:
2588 09/02/2026 NORMAL PAGA 36,52 4,30 4,493208 % % %
Valor informado: Valor apurado: Qtde. apurada: Qtde. informada:
6.100,00 6.100,00 4 4
Dt. Pag.: 09/02/2026
( + ) Valor Original 6.100,00
( = ) Líquido Liberado 319,30 * ( - ) Valor de Deságio Antecipação 0,00 5.730,91 *
DOCUMENTOS DA OPERAÇÃO
RLGALIMENTOS LTDA 04.766.105/0003-79 9/001 09/03/2026 2 30,00 1.030,00 55,02 974,98 28,00 2 DP
RLGALIMENTOS LTDA 04.766.105/0003-79 9/002 09/04/2026 2 63,00 1.030,00 103,74 926,26 59,00 2 DP
RLGALIMENTOS LTDA 04.766.105/0003-79 10/001 12/03/2026 2 35,00 1.980,00 113,32 1.866,68 31,00 2 DP
RLGALIMENTOS LTDA 04.766.105/0003-79 11/001 05/03/2026 2 28,00 2.060,00 97,01 1.962,99 24,00 2 DP
`;

describe('api/disecurit-parse', () => {
  it('retorna parsed para SPPRO quando face_value e net_value estão presentes', async () => {
    process.env.DISECURIT_PARSE_SECRET = 'test-secret';

    const req = {
      method: 'POST',
      headers: {
        'x-disecurit-parse-secret': 'test-secret',
      },
      body: {
        raw_text: spproRawText,
        program_hint: 'SPPRO',
        import_file_id: 'import-test',
        empresa_id: '00000000-0000-0000-0000-000000000001',
      },
    };
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload.parse_status).toBe('parsed');
    expect(res.payload.parsed_payload.program).toBe('SPPRO');
    expect(res.payload.parsed_payload.values.face_value).toBe(88653.66);
    expect(res.payload.parsed_payload.values.net_value).toBe(80035.47);
    expect(res.payload.missing_critical).toEqual([]);
  });

  it('retorna parse_partial quando SPPRO não contém face_value e net_value', async () => {
    process.env.DISECURIT_PARSE_SECRET = 'test-secret';

    const req = {
      method: 'POST',
      headers: {
        'x-disecurit-parse-secret': 'test-secret',
      },
      body: {
        raw_text: `
          DEMONSTRATIVO DE OPERAÇÃO DE FOMENTO MERCANTIL
          COMPRA DE CRÉDITOS. PAGAMENTO A VISTA
          Borderô nº 1000 10/02/2026
        `,
        program_hint: 'SPPRO',
      },
    };
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload.parse_status).toBe('parse_partial');
    expect(res.payload.missing_critical).toContain('face_value');
    expect(res.payload.missing_critical).toContain('net_value');
  });

  it('retorna parse_partial para SOI real quando há candidatos conflitantes de líquido', async () => {
    process.env.DISECURIT_PARSE_SECRET = 'test-secret';

    const req = {
      method: 'POST',
      headers: {
        'x-disecurit-parse-secret': 'test-secret',
      },
      body: {
        raw_text: soiRawText,
        program_hint: 'SOI',
        hints: { operation_number: '2588', program_hint: 'SOI' },
      },
    };
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload.parse_status).toBe('parse_partial');
    expect(res.payload.parsed_payload.document.operation_number).toBe('2588');
    expect(res.payload.parsed_payload.values.face_value).toBe(6100);
    expect(res.payload.parsed_payload.values.net_value).toBe(5730.91);
    expect(res.payload.parsed_payload.debug?.soi_formula_v2?.valor_original?.value).toBe(6100);
    expect(res.payload.parsed_payload.debug?.soi_formula_v2?.liquido_liberado?.value).toBe(5730.91);
    expect(res.payload.parsed_payload.debug?.soi_formula?.liquido_liberado?.value).toBe(5730.91);
    expect(res.payload.totals_checks.docs_count).toBe(4);
    expect(res.payload.has_critical_conflict).toBe(true);
  });

  it('retorna parse_partial para SOI quando há divergência entre totais e soma dos documentos', async () => {
    process.env.DISECURIT_PARSE_SECRET = 'test-secret';

    const req = {
      method: 'POST',
      headers: {
        'x-disecurit-parse-secret': 'test-secret',
      },
      body: {
        raw_text: soiRawText.replace('6.100,00 6.100,00', '6.200,00 6.200,00'),
        program_hint: 'SOI',
        hints: { operation_number: '2588', program_hint: 'SOI' },
      },
    };
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload.parse_status).toBe('parse_partial');
    expect(String(res.payload.reason || '').toLowerCase()).toContain('conflito crítico');
    expect(Array.isArray(res.payload.warnings)).toBe(true);
    expect(res.payload.warnings.length).toBeGreaterThan(0);
    expect(res.payload.has_critical_conflict).toBe(true);
    expect(Array.isArray(res.payload.extraction_diagnostics)).toBe(true);
  });

  it('mantém parse_partial quando o layout traz candidatos conflitantes críticos', async () => {
    process.env.DISECURIT_PARSE_SECRET = 'test-secret';

    const req = {
      method: 'POST',
      headers: {
        'x-disecurit-parse-secret': 'test-secret',
      },
      body: {
        raw_text: soiRawText.replace('6.100,00 6.100,00', '6.110,00 6.110,00'),
        program_hint: 'SOI',
        hints: { operation_number: '2588', program_hint: 'SOI' },
      },
    };
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload.parse_status).toBe('parse_partial');
    expect(res.payload.has_critical_conflict).toBe(true);
  });
});
