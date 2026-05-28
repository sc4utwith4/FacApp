-- ============================================
-- LIMPEZA COMPLETA DE DADOS - ASSFAC Platform
-- Este script apaga TODOS os dados existentes no banco
-- ATENÇÃO: Esta operação é IRREVERSÍVEL!
-- Data: 2025-12-01
-- ============================================

-- Desabilitar temporariamente as constraints de foreign key para facilitar a limpeza
SET session_replication_role = 'replica';

-- Apagar dados em ordem inversa das dependências (filhos primeiro, depois pais)

-- 1. Tabelas de movimentações e operações (mais dependentes)
TRUNCATE TABLE movimentacoes_estoque CASCADE;
TRUNCATE TABLE operacoes_estoque CASCADE;
TRUNCATE TABLE lancamentos_previstos CASCADE;
TRUNCATE TABLE contas_fixas CASCADE;
TRUNCATE TABLE despesas_operacao CASCADE;
TRUNCATE TABLE operacoes CASCADE;
TRUNCATE TABLE lancamentos_caixa CASCADE;
TRUNCATE TABLE cheques CASCADE;

-- 2. Tabelas de relacionamento fornecedor
TRUNCATE TABLE tarifas_fornecedor CASCADE;
TRUNCATE TABLE pagamentos_fornecedor CASCADE;
TRUNCATE TABLE duplicatas_fornecedor CASCADE;
TRUNCATE TABLE contratos_fornecedor CASCADE;

-- 3. Tabelas de estoque
TRUNCATE TABLE estoques CASCADE;

-- 4. Tabelas de cadastros secundários
TRUNCATE TABLE clientes CASCADE;
TRUNCATE TABLE fornecedores CASCADE;
TRUNCATE TABLE grupos_contas CASCADE;
TRUNCATE TABLE contas_bancarias CASCADE;

-- 5. Tabelas de convites
TRUNCATE TABLE invites CASCADE;

-- 6. Tabelas de perfis (manter estrutura, mas limpar dados)
-- Nota: profiles tem FK para auth.users, então não podemos truncar
-- Vamos deletar apenas os registros que não são do sistema auth
DELETE FROM profiles WHERE id NOT IN (SELECT id FROM auth.users);

-- 7. Tabelas de empresas
TRUNCATE TABLE empresas CASCADE;

-- 8. Tabelas de referência (opcional - descomente se quiser limpar também)
-- TRUNCATE TABLE bancos CASCADE;
-- TRUNCATE TABLE ufs CASCADE;

-- 9. Tabelas do Sienge (se quiser limpar também)
TRUNCATE TABLE conciliacao_bancaria CASCADE;
TRUNCATE TABLE movimentos_bancarios CASCADE;
TRUNCATE TABLE movimentos_bancarios_public CASCADE;
TRUNCATE TABLE inadimplencia CASCADE;
TRUNCATE TABLE contas_a_pagar CASCADE;
TRUNCATE TABLE contas_pagas CASCADE;
TRUNCATE TABLE contas_a_receber CASCADE;
TRUNCATE TABLE contas_recebidas CASCADE;

-- 10. Tabelas de empreendimentos
TRUNCATE TABLE metas_comerciais CASCADE;
TRUNCATE TABLE empreendimentos CASCADE;

-- 11. Tabelas adicionais que podem existir
-- Verificar e limpar outras tabelas que possam ter sido criadas
DO $$
BEGIN
    -- Tentar limpar tabelas que podem não existir (ignorar erros)
    BEGIN
        TRUNCATE TABLE recebiveis_operacoes_estoque CASCADE;
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;
    
    BEGIN
        TRUNCATE TABLE devolucoes_estoque CASCADE;
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;
    
    BEGIN
        TRUNCATE TABLE recompras_estoque CASCADE;
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;
END $$;

-- Reabilitar as constraints
SET session_replication_role = 'origin';

-- Resetar sequences (se necessário)
-- Isso garante que os IDs comecem do zero novamente
-- Descomente as linhas abaixo se quiser resetar as sequences também

-- ALTER SEQUENCE bancos_id_seq RESTART WITH 1;
-- ALTER SEQUENCE ufs_id_seq RESTART WITH 1;
-- ALTER SEQUENCE estoques_id_seq RESTART WITH 1;
-- ALTER SEQUENCE operacoes_estoque_id_seq RESTART WITH 1;
-- ALTER SEQUENCE movimentacoes_estoque_id_seq RESTART WITH 1;
-- ALTER SEQUENCE contas_fixas_id_seq RESTART WITH 1;
-- ALTER SEQUENCE lancamentos_previstos_id_seq RESTART WITH 1;
-- ALTER SEQUENCE movimentos_bancarios_id_seq RESTART WITH 1;
-- ALTER SEQUENCE conciliacao_bancaria_id_seq RESTART WITH 1;
-- ALTER SEQUENCE inadimplencia_id_seq RESTART WITH 1;
-- ALTER SEQUENCE contas_a_pagar_id_seq RESTART WITH 1;
-- ALTER SEQUENCE contas_pagas_id_seq RESTART WITH 1;
-- ALTER SEQUENCE contas_a_receber_id_seq RESTART WITH 1;
-- ALTER SEQUENCE contas_recebidas_id_seq RESTART WITH 1;

-- Verificação: Contar registros restantes (deve retornar 0 ou apenas dados de referência)
DO $$
DECLARE
    total_rows INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_rows FROM empresas;
    RAISE NOTICE 'Registros em empresas: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM profiles;
    RAISE NOTICE 'Registros em profiles: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM lancamentos_caixa;
    RAISE NOTICE 'Registros em lancamentos_caixa: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM contas_bancarias;
    RAISE NOTICE 'Registros em contas_bancarias: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM grupos_contas;
    RAISE NOTICE 'Registros em grupos_contas: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM clientes;
    RAISE NOTICE 'Registros em clientes: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM fornecedores;
    RAISE NOTICE 'Registros em fornecedores: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM estoques;
    RAISE NOTICE 'Registros em estoques: %', total_rows;
    
    SELECT COUNT(*) INTO total_rows FROM operacoes_estoque;
    RAISE NOTICE 'Registros em operacoes_estoque: %', total_rows;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Limpeza completa concluída!';
    RAISE NOTICE 'Todos os dados foram removidos (exceto auth.users e dados de referência)';
    RAISE NOTICE '========================================';
END $$;



