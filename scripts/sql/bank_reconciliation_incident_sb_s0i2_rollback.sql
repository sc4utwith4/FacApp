-- ============================================================
-- INCIDENTE SB-S0I2: rollback tecnico de lancamentos indevidos
-- ============================================================
-- Objetivo:
--   Reverter lancamentos criados indevidamente por conciliacao (create_new/rule-auto)
--   em janela de incidente, recomputar saldo e registrar auditoria.
--
-- IMPORTANTE:
-- 1) Rode primeiro a secao "1) DIAGNOSTICO (somente leitura)".
-- 2) Preencha TODOS os parametros (empresa_id, conta_bancaria_id, janela).
-- 3) Execute a secao transacional com service_role em ambiente controlado.
--
-- Politica de seguranca:
-- - Selecao de candidatos usa assinatura forte (idempotency_key).
-- - Sem candidatos => aborta com diagnostico de etapas.
-- - Safety cap impede rollback amplo acidental.

-- ============================================================
-- 1) DIAGNOSTICO (somente leitura)
-- ============================================================

-- 1.1 Parametros e validacao de contexto
WITH params AS (
  SELECT
    -- TODO: preencher antes de executar
    '00000000-0000-0000-0000-000000000000'::uuid AS empresa_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS conta_bancaria_id,
    NULL::text AS conta_label, -- opcional: apenas para conferencia
    TIMESTAMPTZ '2026-02-26 00:00:00-03' AS window_start,
    TIMESTAMPTZ '2026-02-27 23:59:59-03' AS window_end,
    TRUE::boolean AS strict_signature_only
),
resolved_account AS (
  SELECT c.id, c.empresa_id, c.descricao
  FROM public.contas_bancarias c
  JOIN params p
    ON p.conta_bancaria_id = c.id
)
SELECT
  p.empresa_id,
  p.conta_bancaria_id,
  p.conta_label,
  p.window_start,
  p.window_end,
  p.strict_signature_only,
  ra.descricao AS conta_resolvida_descricao,
  (ra.id IS NOT NULL) AS conta_existe,
  (ra.empresa_id = p.empresa_id) AS conta_pertence_empresa,
  (
    p.conta_label IS NULL
    OR btrim(p.conta_label) = ''
    OR lower(btrim(p.conta_label)) = lower(btrim(COALESCE(ra.descricao, '')))
  ) AS conta_label_confere
FROM params p
LEFT JOIN resolved_account ra ON TRUE;

-- 1.2 Stage counts deterministico
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS empresa_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS conta_bancaria_id,
    NULL::text AS conta_label,
    TIMESTAMPTZ '2026-02-26 00:00:00-03' AS window_start,
    TIMESTAMPTZ '2026-02-27 23:59:59-03' AS window_end,
    TRUE::boolean AS strict_signature_only
),
base_confirmed AS (
  SELECT
    cb.empresa_id,
    c.id AS conta_bancaria_id,
    c.descricao AS conta_descricao,
    cb.id AS conciliacao_id,
    cb.extrato_transacao_id,
    cb.item_financeiro_id,
    cb.lancamento_caixa_id,
    cb.method,
    cb.confirmed_at,
    lc.tipo,
    lc.valor,
    lc.created_at AS lancamento_created_at,
    idem.idempotency_key
  FROM public.conciliacoes_bancarias cb
  JOIN public.lancamentos_caixa lc
    ON lc.id = cb.lancamento_caixa_id
  JOIN public.contas_bancarias c
    ON c.id = lc.conta_bancaria_id
  LEFT JOIN public.conciliacao_bank_idempotency idem
    ON idem.empresa_id = cb.empresa_id
   AND idem.lancamento_caixa_id = lc.id
  JOIN params p
    ON p.empresa_id = cb.empresa_id
  WHERE cb.status = 'confirmed'
),
by_conta AS (
  SELECT b.*
  FROM base_confirmed b
  JOIN params p
    ON p.conta_bancaria_id = b.conta_bancaria_id
),
by_window_created_or_confirmed AS (
  SELECT b.*
  FROM by_conta b
  CROSS JOIN params p
  WHERE (
    b.lancamento_created_at BETWEEN p.window_start AND p.window_end
    OR b.confirmed_at BETWEEN p.window_start AND p.window_end
  )
),
by_signature_strong AS (
  SELECT b.*
  FROM by_window_created_or_confirmed b
  CROSS JOIN params p
  WHERE (
    COALESCE(b.idempotency_key, '') LIKE 'chat-ui:%:apply_reconciliation_plan:%:create:%'
    OR COALESCE(b.idempotency_key, '') LIKE 'chat-confirm:apply_reconciliation_plan:%:create:%'
    OR COALESCE(b.idempotency_key, '') LIKE 'rule-auto:%'
    OR (p.strict_signature_only IS FALSE AND b.method IN ('ai', 'rule'))
  )
)
SELECT
  (SELECT COUNT(*) FROM base_confirmed) AS confirmed_by_empresa,
  (SELECT COUNT(*) FROM by_conta) AS by_conta,
  (SELECT COUNT(*) FROM by_window_created_or_confirmed) AS by_window_created_or_confirmed,
  (SELECT COUNT(*) FROM by_signature_strong) AS by_signature_strong,
  (
    SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
    FROM by_signature_strong
  ) AS impacto_liquido_assinatura_forte,
  (SELECT MIN(lancamento_created_at) FROM by_signature_strong) AS primeiro_lancamento,
  (SELECT MAX(lancamento_created_at) FROM by_signature_strong) AS ultimo_lancamento;

-- 1.3 Amostra de candidatos fortes
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS empresa_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS conta_bancaria_id,
    TIMESTAMPTZ '2026-02-26 00:00:00-03' AS window_start,
    TIMESTAMPTZ '2026-02-27 23:59:59-03' AS window_end
)
SELECT
  cb.id AS conciliacao_id,
  cb.method,
  cb.confirmed_at,
  lc.id AS lancamento_id,
  lc.tipo,
  lc.valor,
  lc.created_at AS lancamento_created_at,
  idem.idempotency_key
FROM public.conciliacoes_bancarias cb
JOIN public.lancamentos_caixa lc
  ON lc.id = cb.lancamento_caixa_id
LEFT JOIN public.conciliacao_bank_idempotency idem
  ON idem.empresa_id = cb.empresa_id
 AND idem.lancamento_caixa_id = lc.id
JOIN params p
  ON p.empresa_id = cb.empresa_id
WHERE cb.status = 'confirmed'
  AND lc.conta_bancaria_id = p.conta_bancaria_id
  AND (
    lc.created_at BETWEEN p.window_start AND p.window_end
    OR cb.confirmed_at BETWEEN p.window_start AND p.window_end
  )
  AND (
    COALESCE(idem.idempotency_key, '') LIKE 'chat-ui:%:apply_reconciliation_plan:%:create:%'
    OR COALESCE(idem.idempotency_key, '') LIKE 'chat-confirm:apply_reconciliation_plan:%:create:%'
    OR COALESCE(idem.idempotency_key, '') LIKE 'rule-auto:%'
  )
ORDER BY lc.created_at ASC
LIMIT 200;

-- 1.4 Quase-candidatos (janela ok, assinatura nao forte) para debug
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS empresa_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS conta_bancaria_id,
    TIMESTAMPTZ '2026-02-26 00:00:00-03' AS window_start,
    TIMESTAMPTZ '2026-02-27 23:59:59-03' AS window_end
)
SELECT
  cb.id AS conciliacao_id,
  cb.method,
  cb.confirmed_at,
  lc.id AS lancamento_id,
  lc.tipo,
  lc.valor,
  lc.created_at AS lancamento_created_at,
  idem.idempotency_key
FROM public.conciliacoes_bancarias cb
JOIN public.lancamentos_caixa lc
  ON lc.id = cb.lancamento_caixa_id
LEFT JOIN public.conciliacao_bank_idempotency idem
  ON idem.empresa_id = cb.empresa_id
 AND idem.lancamento_caixa_id = lc.id
JOIN params p
  ON p.empresa_id = cb.empresa_id
WHERE cb.status = 'confirmed'
  AND lc.conta_bancaria_id = p.conta_bancaria_id
  AND (
    lc.created_at BETWEEN p.window_start AND p.window_end
    OR cb.confirmed_at BETWEEN p.window_start AND p.window_end
  )
  AND NOT (
    COALESCE(idem.idempotency_key, '') LIKE 'chat-ui:%:apply_reconciliation_plan:%:create:%'
    OR COALESCE(idem.idempotency_key, '') LIKE 'chat-confirm:apply_reconciliation_plan:%:create:%'
    OR COALESCE(idem.idempotency_key, '') LIKE 'rule-auto:%'
  )
ORDER BY lc.created_at ASC
LIMIT 50;

-- ============================================================
-- 2) ROLLBACK TRANSACIONAL
-- ============================================================
BEGIN;

CREATE TEMP TABLE tmp_sb_s0i2_params ON COMMIT DROP AS
SELECT
  -- TODO: preencher antes de executar
  '00000000-0000-0000-0000-000000000000'::uuid AS empresa_id,
  '00000000-0000-0000-0000-000000000000'::uuid AS conta_bancaria_id,
  NULL::text AS conta_label, -- opcional: apenas conferencia
  TIMESTAMPTZ '2026-02-26 00:00:00-03' AS window_start,
  TIMESTAMPTZ '2026-02-27 23:59:59-03' AS window_end,
  TRUE::boolean AS strict_signature_only,
  500::integer AS safety_cap,
  FALSE::boolean AS allow_large_rollback;

DO $$
DECLARE
  v_empresa_id UUID;
  v_conta_id UUID;
  v_conta_label TEXT;
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_conta_empresa UUID;
  v_conta_descricao TEXT;
BEGIN
  SELECT
    empresa_id,
    conta_bancaria_id,
    NULLIF(btrim(conta_label), ''),
    window_start,
    window_end
  INTO
    v_empresa_id,
    v_conta_id,
    v_conta_label,
    v_window_start,
    v_window_end
  FROM tmp_sb_s0i2_params
  LIMIT 1;

  IF v_empresa_id IS NULL
     OR v_empresa_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION
      'Parametro invalido: empresa_id obrigatorio (nao pode ser placeholder all-zero).';
  END IF;

  IF v_conta_id IS NULL
     OR v_conta_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION
      'Parametro invalido: conta_bancaria_id obrigatorio (nao pode ser placeholder all-zero).';
  END IF;

  IF v_window_start IS NULL OR v_window_end IS NULL OR v_window_start > v_window_end THEN
    RAISE EXCEPTION
      'Janela invalida: window_start/window_end obrigatorios e window_start <= window_end.';
  END IF;

  SELECT c.empresa_id, c.descricao
  INTO v_conta_empresa, v_conta_descricao
  FROM public.contas_bancarias c
  WHERE c.id = v_conta_id;

  IF v_conta_empresa IS NULL THEN
    RAISE EXCEPTION
      'Conta informada nao existe: conta_bancaria_id=%', v_conta_id;
  END IF;

  IF v_conta_empresa <> v_empresa_id THEN
    RAISE EXCEPTION
      'Conta nao pertence a empresa: conta_bancaria_id=% empresa_conta=% empresa_param=%',
      v_conta_id, v_conta_empresa, v_empresa_id;
  END IF;

  IF v_conta_label IS NOT NULL
     AND lower(btrim(v_conta_label)) <> lower(btrim(COALESCE(v_conta_descricao, ''))) THEN
    RAISE EXCEPTION
      'conta_label nao confere com conta_bancaria_id. label_param=% label_conta=%',
      v_conta_label, v_conta_descricao;
  END IF;
END;
$$;

CREATE TEMP TABLE tmp_sb_s0i2_base_confirmed ON COMMIT DROP AS
SELECT
  cb.empresa_id,
  c.id AS conta_bancaria_id,
  c.descricao AS conta_descricao,
  cb.id AS conciliacao_id,
  cb.extrato_transacao_id,
  cb.item_financeiro_id,
  cb.lancamento_caixa_id,
  cb.method,
  cb.confirmed_at AS conciliacao_confirmed_at,
  lc.tipo,
  lc.valor,
  lc.created_at AS lancamento_created_at,
  idem.idempotency_key
FROM public.conciliacoes_bancarias cb
JOIN public.lancamentos_caixa lc
  ON lc.id = cb.lancamento_caixa_id
JOIN public.contas_bancarias c
  ON c.id = lc.conta_bancaria_id
LEFT JOIN public.conciliacao_bank_idempotency idem
  ON idem.empresa_id = cb.empresa_id
 AND idem.lancamento_caixa_id = lc.id
JOIN tmp_sb_s0i2_params p
  ON p.empresa_id = cb.empresa_id
WHERE cb.status = 'confirmed';

CREATE TEMP TABLE tmp_sb_s0i2_by_conta ON COMMIT DROP AS
SELECT b.*
FROM tmp_sb_s0i2_base_confirmed b
JOIN tmp_sb_s0i2_params p
  ON p.conta_bancaria_id = b.conta_bancaria_id;

CREATE TEMP TABLE tmp_sb_s0i2_by_window ON COMMIT DROP AS
SELECT b.*
FROM tmp_sb_s0i2_by_conta b
JOIN tmp_sb_s0i2_params p
  ON TRUE
WHERE (
  b.lancamento_created_at BETWEEN p.window_start AND p.window_end
  OR b.conciliacao_confirmed_at BETWEEN p.window_start AND p.window_end
);

CREATE TEMP TABLE tmp_sb_s0i2_incident_candidates ON COMMIT DROP AS
SELECT b.*
FROM tmp_sb_s0i2_by_window b
JOIN tmp_sb_s0i2_params p
  ON TRUE
WHERE (
  COALESCE(b.idempotency_key, '') LIKE 'chat-ui:%:apply_reconciliation_plan:%:create:%'
  OR COALESCE(b.idempotency_key, '') LIKE 'chat-confirm:apply_reconciliation_plan:%:create:%'
  OR COALESCE(b.idempotency_key, '') LIKE 'rule-auto:%'
  OR (p.strict_signature_only IS FALSE AND b.method IN ('ai', 'rule'))
);

DO $$
DECLARE
  v_count INTEGER;
  v_count_base INTEGER;
  v_count_by_conta INTEGER;
  v_count_by_window INTEGER;
  v_safety_cap INTEGER;
  v_allow_large_rollback BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_count_base FROM tmp_sb_s0i2_base_confirmed;
  SELECT COUNT(*) INTO v_count_by_conta FROM tmp_sb_s0i2_by_conta;
  SELECT COUNT(*) INTO v_count_by_window FROM tmp_sb_s0i2_by_window;
  SELECT COUNT(*) INTO v_count FROM tmp_sb_s0i2_incident_candidates;

  SELECT safety_cap, allow_large_rollback
  INTO v_safety_cap, v_allow_large_rollback
  FROM tmp_sb_s0i2_params
  LIMIT 1;

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'Rollback abortado: nenhum candidato encontrado. Stage counts => confirmed_by_empresa=%, by_conta=%, by_window_created_or_confirmed=%, by_signature_strong=%. Revise empresa_id, conta_bancaria_id, janela e padroes de idempotency_key.',
      v_count_base, v_count_by_conta, v_count_by_window, v_count;
  END IF;

  IF NOT COALESCE(v_allow_large_rollback, FALSE)
     AND v_count > COALESCE(v_safety_cap, 500) THEN
    RAISE EXCEPTION
      'Rollback abortado: candidatos (%) acima do safety_cap (%). Ajuste parametros ou marque allow_large_rollback=true se for intencional.',
      v_count, v_safety_cap;
  END IF;
END;
$$;

-- remove sugestoes create_new vinculadas aos extratos impactados (higiene)
DELETE FROM public.bank_ai_suggestions s
WHERE s.empresa_id IN (
  SELECT DISTINCT empresa_id
  FROM tmp_sb_s0i2_incident_candidates
)
AND s.extrato_transacao_id IN (
  SELECT DISTINCT extrato_transacao_id
  FROM tmp_sb_s0i2_incident_candidates
)
AND s.suggestion_action = 'create_new'
AND s.status IN ('suggested', 'approved', 'applied');

-- remove conciliacoes confirmadas do incidente
DELETE FROM public.conciliacoes_bancarias cb
WHERE cb.id IN (
  SELECT conciliacao_id
  FROM tmp_sb_s0i2_incident_candidates
);

-- remove itens financeiros canonicos derivados dos lancamentos do incidente,
-- apenas se nao houver mais conciliacoes referenciando o item
DELETE FROM public.conciliacao_itens_financeiros i
WHERE i.id IN (
  SELECT DISTINCT item_financeiro_id
  FROM tmp_sb_s0i2_incident_candidates
  WHERE item_financeiro_id IS NOT NULL
)
AND i.origem_tipo = 'lancamento_caixa'
AND i.origem_id_uuid IN (
  SELECT DISTINCT lancamento_caixa_id
  FROM tmp_sb_s0i2_incident_candidates
  WHERE lancamento_caixa_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM public.conciliacoes_bancarias cb
  WHERE cb.item_financeiro_id = i.id
);

-- remove chaves de idempotencia associadas
DELETE FROM public.conciliacao_bank_idempotency idp
WHERE idp.empresa_id IN (
  SELECT DISTINCT empresa_id
  FROM tmp_sb_s0i2_incident_candidates
)
AND idp.lancamento_caixa_id IN (
  SELECT DISTINCT lancamento_caixa_id
  FROM tmp_sb_s0i2_incident_candidates
  WHERE lancamento_caixa_id IS NOT NULL
);

-- remove lancamentos criados no incidente
DELETE FROM public.lancamentos_caixa l
WHERE l.id IN (
  SELECT DISTINCT lancamento_caixa_id
  FROM tmp_sb_s0i2_incident_candidates
  WHERE lancamento_caixa_id IS NOT NULL
);

-- recomputa saldo da conta
SELECT public.rpc_bank_recompute_account_balance(conta_bancaria_id)
FROM (
  SELECT DISTINCT conta_bancaria_id
  FROM tmp_sb_s0i2_incident_candidates
) t;

-- auditoria do rollback tecnico
INSERT INTO public.bank_reconciliation_audit_log (
  empresa_id,
  action,
  status,
  message,
  details
)
SELECT
  c.empresa_id,
  'incident_sb_s0i2_rollback',
  'warning',
  'Rollback tecnico de conciliacao aplicado para remover lancamentos indevidos.',
  jsonb_build_object(
    'conta_bancaria_id', c.conta_bancaria_id,
    'conta_descricao', MAX(c.conta_descricao),
    'conciliacoes_removidas', COUNT(*),
    'lancamentos_removidos', COUNT(DISTINCT c.lancamento_caixa_id),
    'impacto_liquido_revertido',
      COALESCE(SUM(CASE WHEN c.tipo = 'entrada' THEN c.valor ELSE -c.valor END), 0),
    'stage_counts', jsonb_build_object(
      'confirmed_by_empresa', (SELECT COUNT(*) FROM tmp_sb_s0i2_base_confirmed),
      'by_conta', (SELECT COUNT(*) FROM tmp_sb_s0i2_by_conta),
      'by_window_created_or_confirmed', (SELECT COUNT(*) FROM tmp_sb_s0i2_by_window),
      'by_signature_strong', (SELECT COUNT(*) FROM tmp_sb_s0i2_incident_candidates)
    ),
    'params', jsonb_build_object(
      'window_start', (SELECT window_start FROM tmp_sb_s0i2_params LIMIT 1),
      'window_end', (SELECT window_end FROM tmp_sb_s0i2_params LIMIT 1),
      'strict_signature_only', (SELECT strict_signature_only FROM tmp_sb_s0i2_params LIMIT 1),
      'safety_cap', (SELECT safety_cap FROM tmp_sb_s0i2_params LIMIT 1),
      'allow_large_rollback', (SELECT allow_large_rollback FROM tmp_sb_s0i2_params LIMIT 1)
    ),
    'executed_at', NOW()
  )
FROM tmp_sb_s0i2_incident_candidates c
GROUP BY c.empresa_id, c.conta_bancaria_id;

COMMIT;

-- 2.1 Validacao final de saldo (apos commit)
WITH params AS (
  SELECT
    -- TODO: preencher com os mesmos parametros usados no rollback
    '00000000-0000-0000-0000-000000000000'::uuid AS conta_bancaria_id
)
SELECT
  c.id,
  c.descricao,
  c.saldo_atual,
  c.updated_at
FROM public.contas_bancarias c
JOIN params p
  ON p.conta_bancaria_id = c.id;
