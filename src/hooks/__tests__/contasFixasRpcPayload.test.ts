import { describe, expect, it } from 'vitest';

import {
  buildCreateContaFixaRpcPayload,
  buildUpdateContaFixaRpcPayload,
} from '../contasFixasRpcPayload';

describe('contasFixasRpcPayload', () => {
  it('buildCreateContaFixaRpcPayload normaliza uma data valida', () => {
    const payload = buildCreateContaFixaRpcPayload({
      descricao: 'Tarifa bancaria',
      natureza: 'saida',
      grupo_contas_id: '95c653f4-1f3c-4489-a9a6-1714b2857b2d',
      conta_bancaria_id: '26fd78d8-21cc-49ff-937d-a29d3ded6a25',
      periodicidade: 'mensal',
      dia_ref: 25,
      weekday_ref: undefined,
      valor: 125,
      ativo: true,
      proximo_evento: '2026-04-06',
      tolerancia_dias: 0,
      observacoes: 'Tarifas',
    });

    expect(payload.p_proximo_evento).toBe('2026-04-06');
    expect(payload.p_grupo_contas_id).toBe('95c653f4-1f3c-4489-a9a6-1714b2857b2d');
    expect(payload.p_conta_bancaria_id).toBe('26fd78d8-21cc-49ff-937d-a29d3ded6a25');
  });

  it('buildCreateContaFixaRpcPayload rejeita data vazia', () => {
    expect(() =>
      buildCreateContaFixaRpcPayload({
        descricao: 'Tarifa bancaria',
        natureza: 'saida',
        grupo_contas_id: '95c653f4-1f3c-4489-a9a6-1714b2857b2d',
        conta_bancaria_id: '26fd78d8-21cc-49ff-937d-a29d3ded6a25',
        periodicidade: 'mensal',
        dia_ref: 25,
        weekday_ref: undefined,
        valor: 125,
        ativo: true,
        proximo_evento: '   ',
        tolerancia_dias: 0,
        observacoes: '',
      }),
    ).toThrow('Próximo evento é obrigatório.');
  });

  it('buildUpdateContaFixaRpcPayload preserva update parcial sem proximo_evento', () => {
    const payload = buildUpdateContaFixaRpcPayload({
      id: 100,
      ativo: false,
    });

    expect(payload.p_id).toBe(100);
    expect(payload.p_ativo).toBe(false);
    expect(payload.p_proximo_evento).toBeNull();
    expect(payload.p_grupo_contas_id).toBeNull();
    expect(payload.p_conta_bancaria_id).toBeNull();
  });

  it('buildUpdateContaFixaRpcPayload trata data vazia como null', () => {
    const payload = buildUpdateContaFixaRpcPayload({
      id: 100,
      proximo_evento: '   ',
    });

    expect(payload.p_proximo_evento).toBeNull();
  });

  it('buildUpdateContaFixaRpcPayload preserva a data literal em string ISO', () => {
    const payload = buildUpdateContaFixaRpcPayload({
      id: 100,
      proximo_evento: '2026-04-06T00:00:00Z',
    });

    expect(payload.p_proximo_evento).toBe('2026-04-06');
  });

  it('buildCreateContaFixaRpcPayload rejeita UUID invalido', () => {
    expect(() =>
      buildCreateContaFixaRpcPayload({
        descricao: 'Tarifa bancaria',
        natureza: 'saida',
        grupo_contas_id: '123',
        conta_bancaria_id: '26fd78d8-21cc-49ff-937d-a29d3ded6a25',
        periodicidade: 'mensal',
        dia_ref: 25,
        weekday_ref: undefined,
        valor: 125,
        ativo: true,
        proximo_evento: '2026-04-06',
        tolerancia_dias: 0,
        observacoes: '',
      }),
    ).toThrow('Grupo de contas inválido.');
  });

  it('buildUpdateContaFixaRpcPayload rejeita UUID invalido quando o campo foi enviado', () => {
    expect(() =>
      buildUpdateContaFixaRpcPayload({
        id: 100,
        conta_bancaria_id: '123',
      }),
    ).toThrow('Conta bancária inválida.');
  });
});
