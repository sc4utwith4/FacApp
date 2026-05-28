import { describe, expect, it } from 'vitest';
import { parseBradescoCsv } from '@/lib/bank-reconciliation/bradescoCsvParser';

describe('bradescoCsvParser', () => {
  it('gera dedupe_ordinal e hash_fallback distintos para linhas identicas', () => {
    const csv = [
      'Data;Historico;Documento;Valor;Tipo',
      '10/02/2026;PIX UBER;123;50,00;D',
      '10/02/2026;PIX UBER;123;50,00;D',
      '11/02/2026;CREDITO CLIENTE;ABC;120,00;C',
    ].join('\n');

    const result = parseBradescoCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(3);
    expect(result.periodo_inicio).toBe('2026-02-10');
    expect(result.periodo_fim).toBe('2026-02-11');

    const [first, second, third] = result.transactions;

    expect(first.tipo).toBe('debit');
    expect(first.valor_centavos).toBe(5000);
    expect(first.dedupe_ordinal).toBe(1);

    expect(second.tipo).toBe('debit');
    expect(second.valor_centavos).toBe(5000);
    expect(second.dedupe_ordinal).toBe(2);
    expect(second.hash_fallback).not.toBe(first.hash_fallback);

    expect(third.tipo).toBe('credit');
    expect(third.valor_centavos).toBe(12000);
  });

  it('interpreta corretamente credito/debito quando o header vem com codificacao quebrada', () => {
    const csv = [
      ';Extrato de: Agencia: 140 Conta: 338094-7',
      'Data;Lan�amento;Dcto.;Cr�dito (R$);D�bito (R$);Saldo (R$)',
      '18/02/2026;TRANSFERENCIA PIX REM: CLIENTE;123;1.900,00;;326.843,17',
      '18/02/2026;TRANSFERENCIA PIX DES: FORNECEDOR;124;;-5.242,14;321.601,03',
    ].join('\n');

    const result = parseBradescoCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const [creditTx, debitTx] = result.transactions;
    expect(creditTx.tipo).toBe('credit');
    expect(creditTx.valor_centavos).toBe(190000);

    expect(debitTx.tipo).toBe('debit');
    expect(debitTx.valor_centavos).toBe(524214);
  });

  it('ignora linhas de saldo/valor disponivel para não gerar falso lançamento', () => {
    const csv = [
      'Data;Histórico;Documento;Valor',
      '18/02/2026;SALDO ANTERIOR;;;',
      '18/02/2026;LIQUIDACAO DE COBRANCA VALOR DISPONIVEL;123;1.000,00',
      '18/02/2026;TRANSFERENCIA PIX REM: CLIENTE;124;1.900,00',
    ].join('\n');

    const result = parseBradescoCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.descricao_raw).toContain('TRANSFERENCIA PIX REM');
    expect(result.transactions[0]?.valor_centavos).toBe(190000);
  });

  it('ignora variantes de saldo após lançamento e mantém apenas movimentos reais', () => {
    const csv = [
      'Data;Histórico;Documento;Valor',
      '13/02/2026;SALDO APÓS LANÇAMENTO;;;',
      '13/02/2026;SALDO FINAL;;;',
      '13/02/2026;TARIFA AUTORIZ COBRANCA TARIFA EXTRATO PROTESTO 00000001;9988;4,85',
    ].join('\n');

    const result = parseBradescoCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.descricao_raw).toContain('TARIFA AUTORIZ COBRANCA');
    expect(result.transactions[0]?.valor_centavos).toBe(485);
  });

  it('interpreta colunas de entrada/saída sem capturar coluna de saldo', () => {
    const csv = [
      'Data;Lançamento;Entrada (R$);Saída (R$);Saldo após lançamento',
      '18/02/2026;DEPÓSITO PIX CLIENTE;1.900,00;;326.843,17',
      '18/02/2026;PAGAMENTO FORNECEDOR;;5.242,14;321.601,03',
    ].join('\n');

    const result = parseBradescoCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const [creditTx, debitTx] = result.transactions;
    expect(creditTx.tipo).toBe('credit');
    expect(creditTx.valor_centavos).toBe(190000);

    expect(debitTx.tipo).toBe('debit');
    expect(debitTx.valor_centavos).toBe(524214);
  });
});
