-- =====================================================================================
-- Enforce único estoque DEVOLUCOES ativo por empresa
-- =====================================================================================
-- Objetivo:
-- 1) Sanear legado com múltiplos DEVOLUCOES ativos por empresa (mantém o mais antigo).
-- 2) Garantir governança futura com índice único parcial.
--
-- Regra de saneamento:
-- - Para cada empresa, manter ativo somente o DEVOLUCOES mais antigo (created_at, id).
-- - Duplicados ativos são desativados (ativo=false) e marcados na descrição.

WITH devolucoes_ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY empresa_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.estoques
  WHERE tipo = 'DEVOLUCOES'
    AND ativo = true
),
duplicados AS (
  SELECT id
  FROM devolucoes_ranked
  WHERE rn > 1
)
UPDATE public.estoques e
SET
  ativo = false,
  descricao = CASE
    WHEN e.descricao IS NULL OR btrim(e.descricao) = '' THEN '[AUTO-DESATIVADO DUPLICADO] Estoque de Devolucoes'
    WHEN e.descricao LIKE '[AUTO-DESATIVADO DUPLICADO]%' THEN e.descricao
    ELSE '[AUTO-DESATIVADO DUPLICADO] ' || e.descricao
  END
WHERE e.id IN (SELECT id FROM duplicados);

-- Governança de escrita: só pode existir 1 DEVOLUCOES ativo por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoques_devolucoes_ativo_por_empresa
  ON public.estoques (empresa_id)
  WHERE tipo = 'DEVOLUCOES'
    AND ativo = true;

COMMENT ON INDEX uq_estoques_devolucoes_ativo_por_empresa IS
  'Garante um único estoque DEVOLUCOES ativo por empresa (sanear legado + prevenir duplicidade futura).';
