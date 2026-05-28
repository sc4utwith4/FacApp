-- ============================================
-- CONSOLIDAR POLÍTICAS RLS - REMOVER REDUNDÂNCIAS
-- ============================================
-- As políticas "Users can manage own empresa X" já incluem SELECT, INSERT, UPDATE, DELETE
-- As políticas "Users can view own empresa X" são redundantes e podem ser removidas
-- Isso melhora a performance ao reduzir o número de políticas a serem avaliadas

-- Remover políticas redundantes de VIEW que são cobertas pelas políticas de MANAGE
DROP POLICY IF EXISTS "Users can view own empresa cheques" ON cheques;
DROP POLICY IF EXISTS "Users can view own empresa clientes" ON clientes;
DROP POLICY IF EXISTS "Users can view own empresa contas" ON contas_bancarias;
DROP POLICY IF EXISTS "Users can view own empresa despesas" ON despesas_operacao;
DROP POLICY IF EXISTS "Users can view own empresa fornecedores" ON fornecedores;
DROP POLICY IF EXISTS "Users can view own empresa grupos" ON grupos_contas;
DROP POLICY IF EXISTS "Users can view own empresa lancamentos" ON lancamentos_caixa;
DROP POLICY IF EXISTS "Users can view own empresa operacoes" ON operacoes;;
