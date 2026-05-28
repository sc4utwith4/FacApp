/**
 * Fase A — evidência automatizada B1 (saldo) e B3 (lock verificado).
 * @vitest-environment node
 *
 * Requer schema migrado e LANCAMENTOS_PHASE_A_DB_URL. Sem URL, suíte skipped.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const dbUrl = process.env.LANCAMENTOS_PHASE_A_DB_URL?.trim();
const runDoubleAssertion = process.env.LANCAMENTOS_PHASE_A_ASSERT_NO_DOUBLE === '1';

const describePhaseA = dbUrl ? describe : describe.skip;
const SALDO_INSERT_TRIGGER_NAME = 'trigger_atualizar_saldo_insert';
const INCREMENT_SIGNATURE = 'public.increment(text,text,uuid,text,numeric)';

async function withTransaction<T>(client: Client, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

describePhaseA('Lançamentos Fase A — B1 saldo / B3 lock verificado', () => {
  let client: Client;
  let optionalIncrementSkipReason: string | null = null;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();

    // Preflight obrigatório B1: trigger de saldo em INSERT de lancamentos_caixa.
    const { rows: triggerRows } = await client.query<{
      trigger_name: string;
      trigger_function: string;
      is_after_insert: boolean;
    }>(
      `SELECT
         tg.tgname AS trigger_name,
         p.proname AS trigger_function,
         ((tg.tgtype & 4) = 4 AND (tg.tgtype & 2) = 0) AS is_after_insert
       FROM pg_trigger tg
       JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = tg.tgfoid
       WHERE n.nspname = 'public'
         AND c.relname = 'lancamentos_caixa'
         AND NOT tg.tgisinternal
         AND tg.tgname = $1`,
      [SALDO_INSERT_TRIGGER_NAME],
    );

    const hasRequiredInsertTrigger = triggerRows.some((row) => row.is_after_insert);
    if (!hasRequiredInsertTrigger) {
      const observedTriggers = triggerRows.length
        ? triggerRows.map((row) => `${row.trigger_name}:${row.trigger_function}`).join(', ')
        : 'none';
      throw new Error(
        `Preflight obrigatório B1 falhou: trigger '${SALDO_INSERT_TRIGGER_NAME}' (AFTER INSERT ON public.lancamentos_caixa) não encontrado. Observado: ${observedTriggers}.`,
      );
    }

    // Preflight opcional B1 (ASSERT_NO_DOUBLE): assinatura UUID de increment.
    const { rows: incrementRows } = await client.query<{ has_increment_uuid_signature: boolean }>(
      `SELECT to_regprocedure($1) IS NOT NULL AS has_increment_uuid_signature`,
      [INCREMENT_SIGNATURE],
    );
    const hasIncrementUuidSignature = Boolean(incrementRows[0]?.has_increment_uuid_signature);
    if (runDoubleAssertion && !hasIncrementUuidSignature) {
      optionalIncrementSkipReason = `Preflight opcional: função ${INCREMENT_SIGNATURE} ausente no ambiente.`;
    }
  });

  afterAll(async () => {
    await client.end();
  });

  it('B1: INSERT saída em lancamentos_caixa aplica trigger uma vez (saldo S → S − V)', async () => {
    await withTransaction(client, async (c) => {
      const empresaId = randomUUID();
      const contaId = randomUUID();
      const lancId = randomUUID();
      const S = 1000;
      const V = 50;

      await c.query(
        `INSERT INTO public.empresas (id, nome, status) VALUES ($1, $2, true)`,
        [empresaId, `phase-a-b1-${empresaId.slice(0, 8)}`],
      );

      await c.query(
        `INSERT INTO public.contas_bancarias (id, empresa_id, descricao, saldo_inicial, saldo_atual, status)
         VALUES ($1, $2, $3, $4, $4, true)`,
        [contaId, empresaId, 'Conta teste B1', S],
      );

      const { rows: before } = await c.query<{ saldo_atual: string }>(
        `SELECT saldo_atual::text FROM public.contas_bancarias WHERE id = $1`,
        [contaId],
      );
      expect(Number(before[0].saldo_atual)).toBe(S);

      await c.query(
        `INSERT INTO public.lancamentos_caixa (
           id, empresa_id, conta_bancaria_id, data, historico, tipo, valor
         ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 'saida', $5)`,
        [lancId, empresaId, contaId, 'Phase A B1 saída', V],
      );

      const { rows: after } = await c.query<{ saldo_atual: string }>(
        `SELECT saldo_atual::text FROM public.contas_bancarias WHERE id = $1`,
        [contaId],
      );
      expect(Number(after[0].saldo_atual)).toBe(S - V);
    });
  });

  it('B1 (opcional): diagnóstico explícito do caminho legado (INSERT + increment => S − 2V)', async (ctx) => {
    if (!runDoubleAssertion) {
      return;
    }
    if (optionalIncrementSkipReason) {
      ctx.skip(optionalIncrementSkipReason);
    }

    await withTransaction(client, async (c) => {
      const empresaId = randomUUID();
      const contaId = randomUUID();
      const lancId = randomUUID();
      const S = 1000;
      const V = 40;

      await c.query(
        `INSERT INTO public.empresas (id, nome, status) VALUES ($1, $2, true)`,
        [empresaId, `phase-a-b1d-${empresaId.slice(0, 8)}`],
      );

      await c.query(
        `INSERT INTO public.contas_bancarias (id, empresa_id, descricao, saldo_inicial, saldo_atual, status)
         VALUES ($1, $2, $3, $4, $4, true)`,
        [contaId, empresaId, 'Conta teste B1 double', S],
      );

      await c.query(
        `INSERT INTO public.lancamentos_caixa (
           id, empresa_id, conta_bancaria_id, data, historico, tipo, valor
         ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 'saida', $5)`,
        [lancId, empresaId, contaId, 'Phase A B1 double path', V],
      );

      await c.query(
        `SELECT public.increment($1::text, $2::text, $3::uuid, $4::text, $5::numeric)`,
        ['contas_bancarias', 'id', contaId, 'saldo_atual', -V],
      );

      const { rows } = await c.query<{ saldo_atual: string }>(
        `SELECT saldo_atual::text FROM public.contas_bancarias WHERE id = $1`,
        [contaId],
      );

      // Contrato diagnóstico: em SQL bruto, duas mutações explícitas aplicam 2x no saldo.
      // O anti-dupla-mutação de runtime é garantido por teste de hook (sem increment em contas_bancarias).
      expect(Number(rows[0].saldo_atual)).toBe(S - (2 * V));
    });
  });

  it('B3: UPDATE/DELETE em lancamentos_caixa bloqueados quando item verificado na view', async () => {
    await withTransaction(client, async (c) => {
      const empresaId = randomUUID();
      const contaId = randomUUID();
      const lancId = randomUUID();
      const importId = randomUUID();
      const extratoTxId = randomUUID();
      const concId = randomUUID();
      const valorReais = 75;
      const valorCentavos = 7500;
      const origemKey = `lancamento_caixa:${lancId}`;

      await c.query(
        `INSERT INTO public.empresas (id, nome, status) VALUES ($1, $2, true)`,
        [empresaId, `phase-a-b3-${empresaId.slice(0, 8)}`],
      );

      await c.query(
        `INSERT INTO public.contas_bancarias (id, empresa_id, descricao, saldo_inicial, saldo_atual, status)
         VALUES ($1, $2, $3, 5000, 5000, true)`,
        [contaId, empresaId, 'Conta teste B3'],
      );

      await c.query(
        `INSERT INTO public.lancamentos_caixa (
           id, empresa_id, conta_bancaria_id, data, historico, tipo, valor
         ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 'saida', $5)`,
        [lancId, empresaId, contaId, 'Phase A B3 lanc', valorReais],
      );

      await c.query(
        `INSERT INTO public.extratos_import (
           id, empresa_id, conta_bancaria_id, source, file_format, file_storage_key, file_sha256, parse_status
         ) VALUES ($1, $2, $3, 'ofx_generic', 'ofx', $4, $5, 'parsed')`,
        [
          importId,
          empresaId,
          contaId,
          `phase-a/${importId}/dummy.ofx`,
          'a'.repeat(64),
        ],
      );

      await c.query(
        `INSERT INTO public.extrato_transacoes (
           id, empresa_id, extrato_import_id, conta_bancaria_id, hash_fallback, descricao_raw, descricao_norm,
           data_movimento, valor_centavos, tipo
         ) VALUES ($1, $2, $3, $4, $5, $6, $6, CURRENT_DATE, $7, 'debit')`,
        [extratoTxId, empresaId, importId, contaId, `phase-a-hash-${extratoTxId}`, 'Extrato teste', valorCentavos],
      );

      // Evita colisão de unique: o item canônico já é sincronizado por trigger no INSERT do lançamento.
      // Faz fallback explícito para upsert se o ambiente estiver com sync desabilitado.
      let { rows: itemRows } = await c.query<{ id: string }>(
        `SELECT id
         FROM public.conciliacao_itens_financeiros
         WHERE empresa_id = $1
           AND origem_key = $2
         LIMIT 1`,
        [empresaId, origemKey],
      );
      if (!itemRows[0]) {
        await c.query(`SELECT public.fn_upsert_conciliacao_item_from_lancamento($1)`, [lancId]);
        ({ rows: itemRows } = await c.query<{ id: string }>(
          `SELECT id
           FROM public.conciliacao_itens_financeiros
           WHERE empresa_id = $1
             AND origem_key = $2
           LIMIT 1`,
          [empresaId, origemKey],
        ));
      }
      const itemId = itemRows[0]?.id;
      expect(itemId).toBeTruthy();

      await c.query(
        `INSERT INTO public.conciliacoes_bancarias (
           id, empresa_id, extrato_transacao_id, lancamento_caixa_id, item_financeiro_id, valor_alocado_centavos, status, method
         ) VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'manual')`,
        [concId, empresaId, extratoTxId, lancId, itemId, valorCentavos],
      );

      const { rows: st } = await c.query<{ status_verificacao: string }>(
        `SELECT status_verificacao FROM public.vw_conciliacao_item_status WHERE id = $1`,
        [itemId],
      );
      expect(st[0]?.status_verificacao).toBe('verificado');

      await c.query('SAVEPOINT b3_update_lock');
      await expect(
        c.query(`UPDATE public.lancamentos_caixa SET historico = $2 WHERE id = $1`, [
          lancId,
          'tentativa update bloqueada',
        ]),
      ).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringContaining('LANCAMENTO_VERIFICADO_BLOQUEADO') as unknown as string,
      });
      await c.query('ROLLBACK TO SAVEPOINT b3_update_lock');

      await c.query('SAVEPOINT b3_delete_lock');
      await expect(c.query(`DELETE FROM public.lancamentos_caixa WHERE id = $1`, [lancId])).rejects.toMatchObject({
        code: 'P0001',
      });
      await c.query('ROLLBACK TO SAVEPOINT b3_delete_lock');
    });
  });

  it('B3 controle negativo: sem conciliação confirmada, UPDATE em lancamentos_caixa permitido', async () => {
    await withTransaction(client, async (c) => {
      const empresaId = randomUUID();
      const contaId = randomUUID();
      const lancId = randomUUID();

      await c.query(
        `INSERT INTO public.empresas (id, nome, status) VALUES ($1, $2, true)`,
        [empresaId, `phase-a-b3n-${empresaId.slice(0, 8)}`],
      );

      await c.query(
        `INSERT INTO public.contas_bancarias (id, empresa_id, descricao, saldo_inicial, saldo_atual, status)
         VALUES ($1, $2, $3, 1000, 1000, true)`,
        [contaId, empresaId, 'Conta negativo B3'],
      );

      await c.query(
        `INSERT INTO public.lancamentos_caixa (
           id, empresa_id, conta_bancaria_id, data, historico, tipo, valor
         ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 'entrada', 10)`,
        [lancId, empresaId, contaId, 'Sem conciliação verificada'],
      );

      const res = await c.query(`UPDATE public.lancamentos_caixa SET historico = $2 WHERE id = $1`, [
        lancId,
        'histórico alterado ok',
      ]);
      expect(res.rowCount).toBe(1);
    });
  });
});
