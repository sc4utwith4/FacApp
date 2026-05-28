import { describe, expect, it } from 'vitest';
import {
  doesRuleMatchTransaction,
  getFirstMatchingRule,
  inferLancamentoTipoFromTransaction,
} from '@/lib/bank-reconciliation/rulesEngine';
import type { ExtratoTransacaoRow, ReconciliationRuleRow } from '@/types/bank-reconciliation';

const txBase: ExtratoTransacaoRow = {
  id: 'tx-1',
  empresa_id: 'empresa-1',
  extrato_import_id: 'import-1',
  conta_bancaria_id: 'conta-1',
  fit_id: null,
  hash_fallback: 'hash-1',
  line_number: 1,
  dedupe_ordinal: 1,
  data_movimento: '2026-02-10',
  data_compensacao: null,
  descricao_raw: 'TARIFA BANCARIA MENSAL',
  descricao_norm: 'tarifa bancaria mensal',
  valor_centavos: 1990,
  tipo: 'debit',
  documento_ref: null,
  metadata: {},
  created_at: '2026-02-10T00:00:00.000Z',
  updated_at: '2026-02-10T00:00:00.000Z',
};

const makeRule = (partial: Partial<ReconciliationRuleRow>): ReconciliationRuleRow => ({
  id: 'rule-1',
  empresa_id: 'empresa-1',
  conta_bancaria_id: null,
  match_type: 'contains',
  pattern: 'tarifa',
  direction: 'debit',
  default_grupo_contas_id: null,
  default_centro_custo: null,
  auto_create: false,
  auto_confirm: false,
  active: true,
  priority: 0,
  created_at: '2026-02-10T00:00:00.000Z',
  updated_at: '2026-02-10T00:00:00.000Z',
  ...partial,
});

describe('rulesEngine', () => {
  it('aplica direction e pattern corretamente', () => {
    const rule = makeRule({ pattern: 'tarifa', direction: 'debit', match_type: 'contains' });
    const result = doesRuleMatchTransaction(rule, txBase);

    expect(result.matched).toBe(true);
  });

  it('seleciona a primeira regra que casar na ordem de prioridade', () => {
    const rules = [
      makeRule({ id: 'rule-a', pattern: '^pix', match_type: 'regex', priority: 10 }),
      makeRule({ id: 'rule-b', pattern: 'tarifa', match_type: 'contains', priority: 5 }),
    ];

    const match = getFirstMatchingRule(txBase, rules);

    expect(match?.id).toBe('rule-b');
  });

  it('infere tipo de lancamento pelo tipo do extrato', () => {
    expect(inferLancamentoTipoFromTransaction('credit')).toBe('entrada');
    expect(inferLancamentoTipoFromTransaction('debit')).toBe('saida');
    expect(inferLancamentoTipoFromTransaction('other')).toBe('saida');
  });
});
