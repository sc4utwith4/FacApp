-- ============================================
-- SCRIPT PARA ATUALIZAR SALDOS DOS ESTOQUES
-- Atualiza o campo saldo_atual de estoques identificados pelo tipo (SPPRO e SOI)
-- ============================================

-- Tabela temporária para armazenar os dados de atualização
CREATE TEMP TABLE IF NOT EXISTS temp_atualizacoes_saldos_estoques (
    tipo_estoque VARCHAR(10),
    valor_numerico DECIMAL(15,2),
    estoque_encontrado BOOLEAN DEFAULT false,
    estoque_id BIGINT,
    saldo_anterior DECIMAL(15,2),
    saldo_atualizado DECIMAL(15,2)
);

-- Inserir os dados a serem atualizados
INSERT INTO temp_atualizacoes_saldos_estoques (tipo_estoque, valor_numerico) VALUES
    ('SPPRO', 11307520.39),
    ('SOI', 6391750.10);

-- Atualizar informações sobre estoques encontrados
-- Busca pelo tipo e garante que seja estoque ativo
UPDATE temp_atualizacoes_saldos_estoques t
SET 
    estoque_id = subquery.id,
    saldo_anterior = subquery.saldo_anterior,
    estoque_encontrado = true
FROM (
    SELECT DISTINCT ON (e.tipo)
        e.tipo,
        e.id,
        COALESCE(e.saldo_atual, e.saldo_inicial, 0) as saldo_anterior
    FROM estoques e
    WHERE e.tipo IN ('SPPRO', 'SOI')
      AND e.ativo = true
    ORDER BY e.tipo, e.created_at DESC
) subquery
WHERE subquery.tipo = t.tipo_estoque;

-- Relatório ANTES da atualização
SELECT 
    '=== RELATÓRIO ANTES DA ATUALIZAÇÃO ===' as relatorio;

SELECT 
    t.tipo_estoque,
    CASE 
        WHEN t.estoque_encontrado THEN '✓ ENCONTRADO'
        ELSE '✗ NÃO ENCONTRADO'
    END as status,
    t.estoque_id,
    e.descricao as descricao_completa,
    COALESCE(e.saldo_atual, e.saldo_inicial, 0) as saldo_atual_antes,
    t.valor_numerico as saldo_novo
FROM temp_atualizacoes_saldos_estoques t
LEFT JOIN estoques e ON e.id = t.estoque_id
ORDER BY t.tipo_estoque;

-- Atualizar os saldos dos estoques encontrados
UPDATE estoques e
SET saldo_atual = t.valor_numerico,
    updated_at = NOW()
FROM temp_atualizacoes_saldos_estoques t
WHERE e.id = t.estoque_id
  AND t.estoque_encontrado = true;

-- Relatório DEPOIS da atualização
SELECT 
    '=== RELATÓRIO DEPOIS DA ATUALIZAÇÃO ===' as relatorio;

SELECT 
    t.tipo_estoque,
    CASE 
        WHEN t.estoque_encontrado THEN '✓ ATUALIZADO'
        ELSE '✗ NÃO ATUALIZADO (não encontrado)'
    END as status,
    t.estoque_id,
    e.descricao as descricao_completa,
    t.saldo_anterior as saldo_antes,
    COALESCE(e.saldo_atual, 0) as saldo_depois,
    (COALESCE(e.saldo_atual, 0) - t.saldo_anterior) as diferenca
FROM temp_atualizacoes_saldos_estoques t
LEFT JOIN estoques e ON e.id = t.estoque_id
ORDER BY t.tipo_estoque;

-- Resumo final
SELECT 
    '=== RESUMO FINAL ===' as relatorio;

SELECT 
    COUNT(*) FILTER (WHERE estoque_encontrado = true) as estoques_atualizados,
    COUNT(*) FILTER (WHERE estoque_encontrado = false) as estoques_nao_encontrados,
    COUNT(*) as total_estoques_processados
FROM temp_atualizacoes_saldos_estoques;

-- Listar estoques não encontrados (se houver)
SELECT 
    '=== ESTOQUES NÃO ENCONTRADOS ===' as relatorio;

SELECT 
    tipo_estoque,
    valor_numerico as valor_esperado
FROM temp_atualizacoes_saldos_estoques
WHERE estoque_encontrado = false
ORDER BY tipo_estoque;

-- Verificar se há múltiplos estoques do mesmo tipo (aviso)
SELECT 
    '=== AVISOS: MÚLTIPLOS ESTOQUES DO MESMO TIPO ===' as relatorio;

SELECT 
    e.tipo,
    COUNT(e.id) as total_estoques,
    STRING_AGG(e.descricao, ', ') as descricoes_encontradas,
    STRING_AGG(e.id::text, ', ') as ids_encontrados
FROM estoques e
WHERE e.tipo IN ('SPPRO', 'SOI')
  AND e.ativo = true
GROUP BY e.tipo
HAVING COUNT(e.id) > 1
ORDER BY e.tipo;

-- Limpar tabela temporária
DROP TABLE IF EXISTS temp_atualizacoes_saldos_estoques;

