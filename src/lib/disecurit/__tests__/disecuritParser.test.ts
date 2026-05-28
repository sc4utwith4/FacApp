import { describe, expect, it } from 'vitest';
import {
  detectProgramFromText,
  parseDateBR,
  parseDisecuritPdfText,
  parseMoneyBR,
} from '../disecuritParser';

const spproFixture = `
DEMONSTRATIVO DE OPERAÇÃO DE FOMENTO MERCANTIL
COMPRA DE CRÉDITOS. PAGAMENTO A VISTA
Borderô nº 9876 10/02/2026
Vendedora - Contratante: ALFA INDUSTRIA LTDA
Compradora - Contratada: ASSFAC FOMENTO LTDA
Valor de Face dos Títulos: R$ 12.500,00
Valor de Compra: R$ 11.850,00
Valor de Ad-valorem: R$ 120,00
Valor de ISS: R$ 18,00
Valor de Despesas: R$ 32,00
Valor de IOF: R$ 25,00
Valor de IOF Adicional: R$ 5,00
Valor Líquido da Operação: R$ 450,00
`;

const spproRealisticFixture = `
DEMONSTRATIVO DE OPERAÇÃO DE FOMENTO MERCANTIL - FACTORING
Vendedora - Contratante: TESTE - PROJEÇÃO HADASSA TEXTIL EIRELI ME
Compradora - Contratada:
COMPRA DE CRÉDITOS. PAGAMENTO A VISTA
Títulos Discriminados no Borderô nº 773, em Anexo. ( ) 11/02/2026
Valor de Face dos Títulos: R$: 88.653,66
Valor de Compra: R$: 6.582,85
Valor de Ad-valorem: R$: 531,92
Valor de ISS: R$: 26,59
Valor de Despesas: R$: 93,00
604,16 R$: ( - ) Valor de IOF:
779,67 R$: ( - ) Valor de IOF Adicional:
80.035,47 R$: ( = ) Valor Líquido da Operação:
`;

const soiFixture = `
BORDERÔ DE OPERAÇÃO
Operação: 2588
Dt. Pag.: 09/02/2026
Cliente: 65 - SILVA COMERCIO E SERVICOS EIRELI CNPJ: 39.890.160/0001-99
Valor informado: 6.100,00
Valor de Deságio 369,09
Despesas 10,00
Amortiza débitos 0,00
Amortiza créditos 5,00
Líquido Liberado 5.730,91
DOCUMENTOS DA OPERAÇÃO
RLG ALIMENTOS LTDA
04.766.105/0003-79
9/001
09/03/2026
2 30,00 1.030,00 55,02 974,98 28,00
2
DP
`;

const soiRealisticFixture = `
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

const soiProblematicLiquidityFixture = `
BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1
Operação: 2762
Dt. Pag.: 26/03/2026
Cliente: 88 - O REI DO PAPELAO LTDA CNPJ: 61.188.410/0001-00
( + ) Valor Original 11.486,11
( = ) Líquido Liberado 34,00 * ( - ) Valor de Deságio Antecipação 131,20 10.630,89 *
DOCUMENTOS DA OPERAÇÃO
PAPELAO LTDA 61.188.410/0001-00 1/001 10/04/2026 2 15,00 5.743,06 213,12 5.529,94 21,00 2 DP
PAPELAO LTDA 61.188.410/0001-00 1/002 11/04/2026 2 15,00 5.743,05 642,10 5.100,95 21,00 2 DP
`;

const soiOperationSummaryFixtures = [
  {
    operation: '2806',
    rawText: `
BORDERÔ DE OPERAÇÃO
Operação: 2806
Dt. Pag.: 13/04/2026
DEMONSTRATIVO DOS V ALORES APURADOS NA OPERAÇÃO
( + ) V alor Original 29.967,00
( = ) Líquido Liberado 2.487,91 * ( - ) V alor de Deságio Antecipação 0,00 27.319,09 *
DOCUMENTOS DA OPERAÇÃO
RLG ALIMENTOS LTDA 04.766.105/0003-79 9/001 09/03/2026 2 30,00 1.030,00 55,02 974,98 28,00 2 DP
RLG ALIMENTOS LTDA 04.766.105/0003-79 9/002 09/04/2026 2 63,00 1.030,00 103,74 926,26 59,00 2 DP
2.647,91 29.967,00 20Operação 27.319,09
`,
    expected: {
      valor_original: 29967,
      valor_desagio: 2647.91,
      liquido_liberado: 27319.09,
    },
  },
  {
    operation: '2790',
    rawText: `
BORDERÔ DE OPERAÇÃO
Operação: 2790
Dt. Pag.: 07/04/2026
DEMONSTRATIVO DOS V ALORES APURADOS NA OPERAÇÃO
( + ) V alor Original 128.320,00
( = ) Líquido Liberado 14.895,83 * ( - ) V alor de Deságio Antecipação 0,00 1 13.339,17 *
DOCUMENTOS DA OPERAÇÃO
RLG ALIMENTOS LTDA 04.766.105/0003-79 9/001 09/03/2026 2 30,00 1.030,00 55,02 974,98 28,00 2 DP
RLG ALIMENTOS LTDA 04.766.105/0003-79 9/002 09/04/2026 2 63,00 1.030,00 103,74 926,26 59,00 2 DP
14.980,83 128.320,00 14Operação 1 13.339,17
`,
    expected: {
      valor_original: 128320,
      valor_desagio: 14980.83,
      liquido_liberado: 113339.17,
    },
  },
] as const;

const soiV2RealFixtures = [
  {
    operation: '2759',
    rawText: `
BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1
Operação: 2759
Dt. Pag.: 26/03/2026
Cliente: DANIELLI CRISTINA VICARI - ME CNPJ: 13.630.113/0001-12
( + ) Valor Original (ENTRA NO ESTOQUE) 11.227,55 (-) Regresso 0,00
(- ) Valor de Deságio (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 513,42 (-) Amortiza débitos 3,21
(- ) Valor de Deságio Antecipação (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 0,00 (+) Amortiza créditos 0,00
(* ) Despesas (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 44,80 (-) Créditos gerados 0,00
( = ) Líquido Liberado 27,00 * (VALOR QUE SAI DO SB-S0I2) 10.666,12 *
`,
    expected: {
      valor_original: 11227.55,
      valor_desagio: 513.42,
      valor_desagio_antecipacao: 0,
      despesas: 44.8,
      regresso: 0,
      amortiza_debitos: 3.21,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 10666.12,
    },
  },
  {
    operation: '2760',
    rawText: `
BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1
Operação: 2760
Dt. Pag.: 26/03/2026
Cliente: SILVA COMERCIO E SERVICOS EIRELI CNPJ: 39.890.160/0001-99
( + ) Valor Original (ENTRA NO ESTOQUE) 4.500,00 (-) Regresso 0,00
(- ) Valor de Deságio (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 367,88 (-) Amortiza débitos 0,00
(- ) Valor de Deságio Antecipação (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 0,00 (+) Amortiza créditos 0,00
(* ) Despesas (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 30,40 (-) Créditos gerados 0,00
( = ) Líquido Liberado 4.500,00 * (VALOR QUE SAI DO SB-S0I2) 4.101,72 *
`,
    expected: {
      valor_original: 4500,
      valor_desagio: 367.88,
      valor_desagio_antecipacao: 0,
      despesas: 30.4,
      regresso: 0,
      amortiza_debitos: 0,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 4101.72,
    },
  },
  {
    operation: '2761',
    rawText: `
BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1
Operação: 2761
Dt. Pag.: 26/03/2026
Cliente: IGL EMBALAGENS LTDA CNPJ: 30.649.900/0001-25
( + ) Valor Original (ENTRA NO ESTOQUE) 12.712,70 (-) Regresso 0,00
(- ) Valor de Deságio (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 576,83 (-) Amortiza débitos 0,00
(- ) Valor de Deságio Antecipação (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 0,00 (+) Amortiza créditos 0,00
(* ) Despesas (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 44,80 (-) Créditos gerados 0,00
( = ) Líquido Liberado 19,00 * (VALOR QUE SAI DO SB-S0I2) 12.091,07 *
`,
    expected: {
      valor_original: 12712.7,
      valor_desagio: 576.83,
      valor_desagio_antecipacao: 0,
      despesas: 44.8,
      regresso: 0,
      amortiza_debitos: 0,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 12091.07,
    },
  },
  {
    operation: '2762',
    rawText: `
BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1
Operação: 2762
Dt. Pag.: 26/03/2026
Cliente: O REI DO PAPELAO LTDA CNPJ: 61.188.410/0001-00
( + ) Valor Original (ENTRA NO ESTOQUE) 11.486,11 (-) Regresso 0,00
(- ) Valor de Deságio (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 724,02 (-) Amortiza débitos 0,00
(- ) Valor de Deságio Antecipação (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 0,00 (+) Amortiza créditos 0,00
(* ) Despesas (É CALCULADO DIMINUINDO NO VALOR ORIGINAL) 131,20 (-) Créditos gerados 0,00
( = ) Líquido Liberado 34,00 * (VALOR QUE SAI DO SB-S0I2) 10.630,89 *
`,
    expected: {
      valor_original: 11486.11,
      valor_desagio: 724.02,
      valor_desagio_antecipacao: 0,
      despesas: 131.2,
      regresso: 0,
      amortiza_debitos: 0,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 10630.89,
    },
  },
] as const;

const soiV2FlattenedRawFixtures = [
  {
    operation: '2759',
    rawText:
      'BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1 Operação: 2759 26/03/2026 NORMAL PAGA Valor informado: 11.227,55 Valor apurado: 11.227,55 Dt. Pag.: 26/03/2026 DEMONSTRATIVO DOS VALORES APURADOS NA OPERAÇÃO ( ) Despesas ( - ) Regresso ( - ) Amortiza débitos 3,21 0,00 44,80 ( + ) Valor Original ( - ) Valor de Deságio 11.227,55 ( + )Amortiza créditos ( - ) Créditos gerados 0,00 0,00 ( = ) Líquido Liberado 513,42 * ( - ) Valor de Deságio Antecipação 0,00 10.666,12 * DOCUMENTOS DAOPERAÇÃO APK LOGISTICA E TRANSPORTE LTDA 01.502.510/0023-35 28727-0 22/04/2026 2 29,00 2.440,00 126,24 2.313,76 27,00 2 DP APK LOGISTICA E TRANSPORTE LTDA 01.502.510/0023-35 28728-8 22/04/2026 2 29,00 1.510,00 80,86 1.429,14 27,00 2 DP',
    expected: {
      valor_original: 11227.55,
      valor_desagio: 513.42,
      valor_desagio_antecipacao: 0,
      despesas: 44.8,
      regresso: 0,
      amortiza_debitos: 3.21,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 10666.12,
    },
  },
  {
    operation: '2760',
    rawText:
      'BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1 Operação: 2760 26/03/2026 NORMAL PAGA Valor informado: 4.500,00 Valor apurado: 4.500,00 Dt. Pag.: 26/03/2026 DEMONSTRATIVO DOS VALORES APURADOS NA OPERAÇÃO ( ) Despesas ( - ) Regresso ( - ) Amortiza débitos 0,00 0,00 30,40 ( + ) Valor Original ( - ) Valor de Deságio 4.500,00 ( + )Amortiza créditos ( - ) Créditos gerados 0,00 0,00 ( = ) Líquido Liberado 367,88 * ( - ) Valor de Deságio Antecipação 0,00 4.101,72 * DOCUMENTOS DAOPERAÇÃO NR TRANSPORTADORA LTDA 04.100.765/0001-54 32/001 30/04/2026 2 40,00 2.250,00 150,20 2.099,80 35,00 2 DP NR TRANSPORTADORA LTDA 04.100.765/0001-54 32/002 30/05/2026 2 69,00 2.250,00 248,08 2.001,92 65,00 2 DP',
    expected: {
      valor_original: 4500,
      valor_desagio: 367.88,
      valor_desagio_antecipacao: 0,
      despesas: 30.4,
      regresso: 0,
      amortiza_debitos: 0,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 4101.72,
    },
  },
  {
    operation: '2761',
    rawText:
      'BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1 Operação: 2761 26/03/2026 NORMAL PAGA Valor informado: 12.712,70 Valor apurado: 12.712,70 Dt. Pag.: 26/03/2026 DEMONSTRATIVO DOS VALORES APURADOS NA OPERAÇÃO ( ) Despesas ( - ) Regresso ( - ) Amortiza débitos 0,00 0,00 44,80 ( + ) Valor Original ( - ) Valor de Deságio 12.712,70 ( + )Amortiza créditos ( - ) Créditos gerados 0,00 0,00 ( = ) Líquido Liberado 576,83 * ( - ) Valor de Deságio Antecipação 0,00 12.091,07 *',
    expected: {
      valor_original: 12712.7,
      valor_desagio: 576.83,
      valor_desagio_antecipacao: 0,
      despesas: 44.8,
      regresso: 0,
      amortiza_debitos: 0,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 12091.07,
    },
  },
  {
    operation: '2762',
    rawText:
      'BORDERÔ DE OPERAÇÃO OIARE SECURITIZADORA S A Página: 1 Operação: 2762 26/03/2026 NORMAL PAGA Valor informado: 11.486,11 Valor apurado: 11.486,11 Dt. Pag.: 26/03/2026 DEMONSTRATIVO DOS VALORES APURADOS NA OPERAÇÃO ( ) Despesas ( - ) Regresso ( - ) Amortiza débitos 0,00 0,00 131,20 ( + ) Valor Original ( - ) Valor de Deságio 11.486,11 ( + )Amortiza créditos ( - ) Créditos gerados 0,00 0,00 ( = ) Líquido Liberado 724,02 * ( - ) Valor de Deságio Antecipação 0,00 10.630,89 *',
    expected: {
      valor_original: 11486.11,
      valor_desagio: 724.02,
      valor_desagio_antecipacao: 0,
      despesas: 131.2,
      regresso: 0,
      amortiza_debitos: 0,
      amortiza_creditos: 0,
      creditos_gerados: 0,
      liquido_liberado: 10630.89,
    },
  },
] as const;

const soiShortLiquidityFalsePositives = new Set([27, 34, 19]);

describe('disecuritParser', () => {
  it('parseMoneyBR normaliza formato pt-BR', () => {
    expect(parseMoneyBR('1.234,56')).toBe(1234.56);
    expect(parseMoneyBR('R$ 6.100,00')).toBe(6100);
    expect(parseMoneyBR('')).toBeNull();
  });

  it('parseDateBR converte dd/mm/aaaa para ISO', () => {
    expect(parseDateBR('09/02/2026')).toBe('2026-02-09');
    expect(parseDateBR('invalida')).toBeNull();
  });

  it('detectProgramFromText detecta SPPRO e SOI', () => {
    expect(detectProgramFromText(spproFixture)).toBe('SPPRO');
    expect(detectProgramFromText(soiFixture)).toBe('SOI');
  });

  it('program_hint sobrepõe detecção textual', () => {
    const parsed = parseDisecuritPdfText(soiFixture, 'SPPRO');
    expect(parsed.program).toBe('SPPRO');
    expect(parsed.detected_by).toBe('user_stock');
  });

  it('parseia campos principais SPPRO', () => {
    const parsed = parseDisecuritPdfText(spproFixture);

    expect(parsed.program).toBe('SPPRO');
    expect(parsed.document.bordero_number).toBe('9876');
    expect(parsed.document.date).toBe('2026-02-10');
    expect(parsed.values.face_value).toBe(12500);
    expect(parsed.values.purchase_value).toBe(11850);
    expect(parsed.values.ad_valorem).toBe(120);
    expect(parsed.values.iss).toBe(18);
    expect(parsed.values.iof).toBe(25);
    expect(parsed.values.iof_additional).toBe(5);
    expect(parsed.values.net_value).toBe(450);
  });

  it('parseia SPPRO real com R$: e líquido invertido (valor antes do rótulo)', () => {
    const parsed = parseDisecuritPdfText(spproRealisticFixture);

    expect(parsed.program).toBe('SPPRO');
    expect(parsed.document.bordero_number).toBe('773');
    expect(parsed.document.date).toBe('2026-02-11');
    expect(parsed.values.face_value).toBe(88653.66);
    expect(parsed.values.net_value).toBe(80035.47);
    expect(parsed.debug?.regex_matches?.face_value_match_type).toBe('after_label');
    expect(['before_label', 'direct_label']).toContain(parsed.debug?.regex_matches?.net_value_match_type);
  });

  it('parseia campos principais SOI e documentos', () => {
    const parsed = parseDisecuritPdfText(soiFixture);

    expect(parsed.program).toBe('SOI');
    expect(parsed.document.operation_number).toBe('2588');
    expect(parsed.document.payment_date).toBe('2026-02-09');
    expect(parsed.values.face_value).toBe(6100);
    expect(parsed.values.discount_value).toBe(369.09);
    expect(parsed.values.net_value).toBe(5730.91);
    expect(parsed.documents?.length).toBeGreaterThan(0);
    expect(parsed.documents?.[0].document).toBe('9/001');
    expect(parsed.documents?.[0].net).toBe(974.98);
  });

  it('parseia SOI real com operação deslocada no cabeçalho e net no último valor da janela', () => {
    const parsed = parseDisecuritPdfText(soiRealisticFixture, 'SOI', {
      hints: { operation_number: '2588' },
    });

    expect(parsed.program).toBe('SOI');
    expect(parsed.document.operation_number).toBe('2588');
    expect(parsed.values.face_value).toBe(6100);
    expect(parsed.values.net_value).toBe(5730.91);
    expect(parsed.documents?.length).toBe(4);
    expect(parsed.debug?.regex_matches?.operation_number_match_type).toBe('header_sequence');
    expect(['forward_window', 'after_label', 'direct_label']).toContain(
      parsed.debug?.regex_matches?.face_value_match_type
    );
    expect(['forward_last_money', 'documents_sum', 'direct_label']).toContain(
      parsed.debug?.regex_matches?.net_value_match_type
    );
  });

  it('prioriza líquido SOI correto quando a linha contém múltiplos valores curtos', () => {
    const parsed = parseDisecuritPdfText(soiProblematicLiquidityFixture, 'SOI', {
      hints: { operation_number: '2762' },
    });

    expect(parsed.program).toBe('SOI');
    expect(parsed.document.operation_number).toBe('2762');
    expect(parsed.values.net_value).toBe(10630.89);
    expect(parsed.debug?.soi_formula?.liquido_liberado?.value).toBe(10630.89);
    expect(parsed.values.face_value).toBe(11486.11);
  });

  it.each(soiV2RealFixtures)(
    'parseia SOI V2 completo para operação $operation sem líquido curto indevido',
    ({ operation, rawText, expected }) => {
      const parsed = parseDisecuritPdfText(rawText, 'SOI', {
        hints: { operation_number: operation },
      });

      const soiFormulaV2 = parsed.debug?.soi_formula_v2 || parsed.debug?.soi_formula;
      expect(parsed.program).toBe('SOI');
      expect(parsed.document.operation_number).toBe(operation);
      expect(soiFormulaV2?.valor_original?.value).toBeCloseTo(expected.valor_original, 2);
      expect(soiFormulaV2?.valor_desagio?.value).toBeCloseTo(expected.valor_desagio, 2);
      expect(soiFormulaV2?.valor_desagio_antecipacao?.value).toBeCloseTo(expected.valor_desagio_antecipacao, 2);
      expect(soiFormulaV2?.despesas?.value).toBeCloseTo(expected.despesas, 2);
      expect(soiFormulaV2?.regresso?.value).toBeCloseTo(expected.regresso, 2);
      expect(soiFormulaV2?.amortiza_debitos?.value).toBeCloseTo(expected.amortiza_debitos, 2);
      expect(soiFormulaV2?.amortiza_creditos?.value).toBeCloseTo(expected.amortiza_creditos, 2);
      expect(soiFormulaV2?.creditos_gerados?.value).toBeCloseTo(expected.creditos_gerados, 2);
      expect(soiFormulaV2?.liquido_liberado?.value).toBeCloseTo(expected.liquido_liberado, 2);
      expect(parsed.values.net_value).toBeCloseTo(expected.liquido_liberado, 2);
      expect(soiFormulaV2?.valor_desagio?.value).not.toBeCloseTo(expected.valor_original, 2);
      expect(soiShortLiquidityFalsePositives.has(Math.round(parsed.values.net_value || 0))).toBe(false);
    }
  );

  it.each(soiV2FlattenedRawFixtures)(
    'parseia SOI V2 em texto linearizado real (n8n) para operação $operation',
    ({ operation, rawText, expected }) => {
      const parsed = parseDisecuritPdfText(rawText, 'SOI', {
        hints: { operation_number: operation },
      });
      const soiFormulaV2 = parsed.debug?.soi_formula_v2 || parsed.debug?.soi_formula;
      expect(parsed.program).toBe('SOI');
      expect(parsed.document.operation_number).toBe(operation);
      expect(soiFormulaV2?.valor_original?.value).toBeCloseTo(expected.valor_original, 2);
      expect(soiFormulaV2?.valor_desagio?.value).toBeCloseTo(expected.valor_desagio, 2);
      expect(soiFormulaV2?.despesas?.value).toBeCloseTo(expected.despesas, 2);
      expect(soiFormulaV2?.regresso?.value).toBeCloseTo(expected.regresso, 2);
      expect(soiFormulaV2?.amortiza_debitos?.value).toBeCloseTo(expected.amortiza_debitos, 2);
      expect(soiFormulaV2?.creditos_gerados?.value).toBeCloseTo(expected.creditos_gerados, 2);
      expect(soiFormulaV2?.liquido_liberado?.value).toBeCloseTo(expected.liquido_liberado, 2);
      expect(parsed.values.net_value).toBeCloseTo(expected.liquido_liberado, 2);
      expect(soiFormulaV2?.valor_desagio?.value).not.toBeCloseTo(expected.valor_original, 2);
      expect(soiShortLiquidityFalsePositives.has(Math.round(parsed.values.net_value || 0))).toBe(false);
    }
  );

  it.each(soiOperationSummaryFixtures)(
    'prioriza linha-resumo de Operação para líquido SOI ($operation) mesmo com documents_sum concorrente',
    ({ operation, rawText, expected }) => {
      const parsed = parseDisecuritPdfText(rawText, 'SOI', {
        hints: { operation_number: operation },
      });
      const soiFormula = parsed.debug?.soi_formula;

      expect(parsed.program).toBe('SOI');
      expect(parsed.document.operation_number).toBe(operation);
      expect(soiFormula?.valor_original?.value).toBeCloseTo(expected.valor_original, 2);
      expect(soiFormula?.valor_desagio?.value).toBeCloseTo(expected.valor_desagio, 2);
      expect(soiFormula?.liquido_liberado?.value).toBeCloseTo(expected.liquido_liberado, 2);
      expect(parsed.values.net_value).toBeCloseTo(expected.liquido_liberado, 2);
      expect(soiFormula?.selection_reason?.liquido_liberado).not.toBe('documents_sum_reference');
    }
  );

  it('usa hint como fallback para operação SOI quando o número não está no texto', () => {
    const rawWithoutOperationNumber = soiRealisticFixture.replace(/\b2588\b/g, '');
    const parsed = parseDisecuritPdfText(rawWithoutOperationNumber, 'SOI', {
      hints: { operation_number: '2588' },
    });

    expect(parsed.document.operation_number).toBe('2588');
    expect(parsed.debug?.regex_matches?.operation_number_match_type).toBe('hint_fallback');
  });

  it('gera warnings em texto sem padrão confiável', () => {
    const parsed = parseDisecuritPdfText('texto avulso sem padrão conhecido');

    expect(parsed.debug?.warnings?.length).toBeGreaterThan(0);
    expect(parsed.raw.text_hash).toHaveLength(64);
  });
});
