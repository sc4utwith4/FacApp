export type SpproRegressionExpected = {
  bordero_number: string;
  date: string;
  face_value: number;
  purchase_value: number;
  ad_valorem: number;
  iss: number;
  despesas: number;
  iof: number;
  iof_additional: number;
  recompra: number;
  net_value: number;
};

export type SpproRegressionFixture = {
  id: string;
  description: string;
  rawText: string;
  expected: SpproRegressionExpected;
};

const SPPRO_773_REAL_MULTILINE = `
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
R$: ( - ) Valor de Recompra:
80.035,47 R$: ( = ) Valor Líquido da Operação:
`;

const SPPRO_773_REAL_EXPECTED: SpproRegressionExpected = {
  bordero_number: '773',
  date: '2026-02-11',
  face_value: 88653.66,
  purchase_value: 6582.85,
  ad_valorem: 531.92,
  iss: 26.59,
  despesas: 93,
  iof: 604.16,
  iof_additional: 779.67,
  recompra: 0,
  net_value: 80035.47,
};

const toLinearized = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const spproRealRegressionFixtures: readonly SpproRegressionFixture[] = [
  {
    id: 'sppro_773_real_multiline',
    description: 'Texto bruto real de PDF SPPRO (quebras de linha preservadas).',
    rawText: SPPRO_773_REAL_MULTILINE,
    expected: SPPRO_773_REAL_EXPECTED,
  },
  {
    id: 'sppro_773_real_linearized',
    description: 'Mesmo conteúdo real SPPRO linearizado (estilo payload n8n).',
    rawText: toLinearized(SPPRO_773_REAL_MULTILINE),
    expected: SPPRO_773_REAL_EXPECTED,
  },
] as const;
