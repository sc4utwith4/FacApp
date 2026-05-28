-- ============================================
-- SCRIPT PARA ATUALIZAR SALDOS DAS CONTAS BANCÁRIAS
-- Atualiza o campo saldo_atual de contas identificadas pelo código na descricao
-- ============================================

-- Tabela temporária para armazenar os dados de atualização
CREATE TEMP TABLE IF NOT EXISTS temp_atualizacoes_saldos (
    codigo_conta VARCHAR(50),
    valor_numerico DECIMAL(15,2),
    conta_encontrada BOOLEAN DEFAULT false,
    conta_id UUID,
    saldo_anterior DECIMAL(15,2),
    saldo_atualizado DECIMAL(15,2)
);

-- Inserir os dados a serem atualizados
INSERT INTO temp_atualizacoes_saldos (codigo_conta, valor_numerico) VALUES
    ('SBC', 3726.97),
    ('SBAS', 3568.90),
    ('SBAR', 52.46),
    ('SBG', 3027.79),
    ('SB-S0I1', 14100.00),
    ('SBTI', 422.43),
    ('SBVT', 4500.00),
    ('SBQ', 1441.82),
    ('SBP', 57.00),
    ('SB-S0I2', 274407.37),
    ('SBECOMX', 204.50),
    ('SBCX$', 267.36),
    ('SBG-APLIC', 716566.77),
    ('SBOI2-APLIC', 1530205.63);

-- Atualizar informações sobre contas encontradas
-- Usa correspondência exata primeiro, depois parcial para garantir melhor match
UPDATE temp_atualizacoes_saldos t
SET 
    conta_id = subquery.id,
    saldo_anterior = subquery.saldo_anterior,
    conta_encontrada = true
FROM (
    SELECT DISTINCT ON (t2.codigo_conta)
        t2.codigo_conta,
        cb.id,
        COALESCE(cb.saldo_atual, cb.saldo_inicial, 0) as saldo_anterior,
        -- Priorizar correspondência exata, depois parcial
        CASE 
            WHEN cb.descricao = t2.codigo_conta THEN 1
            WHEN cb.descricao ILIKE t2.codigo_conta || '%' THEN 2
            WHEN cb.descricao ILIKE '%' || t2.codigo_conta || '%' THEN 3
            ELSE 4
        END as prioridade
    FROM temp_atualizacoes_saldos t2
    CROSS JOIN contas_bancarias cb
    WHERE cb.descricao ILIKE '%' || t2.codigo_conta || '%'
       OR cb.descricao = t2.codigo_conta
    ORDER BY t2.codigo_conta, prioridade, cb.created_at DESC
) subquery
WHERE subquery.codigo_conta = t.codigo_conta;

-- Relatório ANTES da atualização
SELECT 
    '=== RELATÓRIO ANTES DA ATUALIZAÇÃO ===' as relatorio;

SELECT 
    t.codigo_conta,
    CASE 
        WHEN t.conta_encontrada THEN '✓ ENCONTRADA'
        ELSE '✗ NÃO ENCONTRADA'
    END as status,
    t.conta_id,
    cb.descricao as descricao_completa,
    COALESCE(cb.saldo_atual, cb.saldo_inicial, 0) as saldo_atual_antes,
    t.valor_numerico as saldo_novo
FROM temp_atualizacoes_saldos t
LEFT JOIN contas_bancarias cb ON cb.id = t.conta_id
ORDER BY t.codigo_conta;

-- Atualizar os saldos das contas encontradas
UPDATE contas_bancarias cb
SET saldo_atual = t.valor_numerico,
    updated_at = NOW()
FROM temp_atualizacoes_saldos t
WHERE cb.id = t.conta_id
  AND t.conta_encontrada = true;

-- Relatório DEPOIS da atualização
SELECT 
    '=== RELATÓRIO DEPOIS DA ATUALIZAÇÃO ===' as relatorio;

SELECT 
    t.codigo_conta,
    CASE 
        WHEN t.conta_encontrada THEN '✓ ATUALIZADA'
        ELSE '✗ NÃO ATUALIZADA (não encontrada)'
    END as status,
    t.conta_id,
    cb.descricao as descricao_completa,
    t.saldo_anterior as saldo_antes,
    COALESCE(cb.saldo_atual, 0) as saldo_depois,
    (COALESCE(cb.saldo_atual, 0) - t.saldo_anterior) as diferenca
FROM temp_atualizacoes_saldos t
LEFT JOIN contas_bancarias cb ON cb.id = t.conta_id
ORDER BY t.codigo_conta;

-- Resumo final
SELECT 
    '=== RESUMO FINAL ===' as relatorio;

SELECT 
    COUNT(*) FILTER (WHERE conta_encontrada = true) as contas_atualizadas,
    COUNT(*) FILTER (WHERE conta_encontrada = false) as contas_nao_encontradas,
    COUNT(*) as total_contas_processadas
FROM temp_atualizacoes_saldos;

-- Listar contas não encontradas (se houver)
SELECT 
    '=== CONTAS NÃO ENCONTRADAS ===' as relatorio;

SELECT 
    codigo_conta,
    valor_numerico as valor_esperado
FROM temp_atualizacoes_saldos
WHERE conta_encontrada = false
ORDER BY codigo_conta;

-- Verificar se há múltiplas correspondências (aviso)
SELECT 
    '=== AVISOS: MÚLTIPLAS CORRESPONDÊNCIAS ===' as relatorio;

SELECT 
    t.codigo_conta,
    COUNT(cb.id) as total_correspondencias,
    STRING_AGG(cb.descricao, ', ') as descricoes_encontradas
FROM temp_atualizacoes_saldos t
INNER JOIN contas_bancarias cb ON (
    cb.descricao ILIKE '%' || t.codigo_conta || '%'
    OR cb.descricao = t.codigo_conta
)
WHERE t.conta_encontrada = true
GROUP BY t.codigo_conta
HAVING COUNT(cb.id) > 1
ORDER BY t.codigo_conta;

-- Limpar tabela temporária
DROP TABLE IF EXISTS temp_atualizacoes_saldos;

