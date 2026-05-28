import { describe, expect, it } from 'vitest';
import { parseOfx } from '@/lib/bank-reconciliation/ofxParser';

describe('ofxParser', () => {
  it('normaliza transacoes OFX e aplica dedupe quando necessario', () => {
    const ofx = [
      '<OFX>',
      '<BANKMSGSRSV1>',
      '<STMTTRNRS>',
      '<STMTRS>',
      '<BANKTRANLIST>',
      '<STMTTRN>',
      '<TRNTYPE>DEBIT',
      '<DTPOSTED>20260210120000[-3:BRT]',
      '<TRNAMT>-50.00',
      '<FITID>ABC123',
      '<CHECKNUM>991',
      '<NAME>PIX UBER',
      '</STMTTRN>',
      '<STMTTRN>',
      '<TRNTYPE>DEBIT',
      '<DTPOSTED>20260210',
      '<TRNAMT>-50.00',
      '<CHECKNUM>991',
      '<NAME>PIX UBER',
      '</STMTTRN>',
      '<STMTTRN>',
      '<TRNTYPE>CREDIT',
      '<DTPOSTED>20260211',
      '<TRNAMT>120.00',
      '<NAME>RECEBIMENTO CLIENTE',
      '</STMTTRN>',
      '</BANKTRANLIST>',
      '</STMTRS>',
      '</STMTTRNRS>',
      '</BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n');

    const result = parseOfx(ofx);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(3);
    expect(result.periodo_inicio).toBe('2026-02-10');
    expect(result.periodo_fim).toBe('2026-02-11');

    const [first, second, third] = result.transactions;
    expect(first.fit_id).toBe('ABC123');
    expect(first.tipo).toBe('debit');
    expect(first.valor_centavos).toBe(5000);

    expect(second.fit_id).toBeNull();
    expect(second.tipo).toBe('debit');
    expect(second.dedupe_ordinal).toBe(1);

    expect(third.tipo).toBe('credit');
    expect(third.valor_centavos).toBe(12000);
  });
});
