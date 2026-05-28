-- ============================================
-- CORREÇÕES DE SEGURANÇA E PERFORMANCE
-- ============================================

-- 1. Corrigir função update_updated_at_column para segurança
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Recriar todos os triggers
CREATE TRIGGER update_empresas_updated_at BEFORE UPDATE ON empresas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contas_bancarias_updated_at BEFORE UPDATE ON contas_bancarias
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_grupos_contas_updated_at BEFORE UPDATE ON grupos_contas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fornecedores_updated_at BEFORE UPDATE ON fornecedores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lancamentos_caixa_updated_at BEFORE UPDATE ON lancamentos_caixa
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operacoes_updated_at BEFORE UPDATE ON operacoes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cheques_updated_at BEFORE UPDATE ON cheques
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Habilitar RLS em tabelas públicas (bancos e ufs são dados de referência)
-- Mas permitir leitura pública para todos
ALTER TABLE bancos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view bancos" ON bancos FOR SELECT
    USING (true);

CREATE POLICY "Anyone can view ufs" ON ufs FOR SELECT
    USING (true);

-- 3. Otimizar políticas RLS usando SELECT para auth.role()
-- Remover políticas duplicadas e otimizar

-- Remover políticas antigas da tabela empresas
DROP POLICY IF EXISTS "Users can view own empresa" ON empresas;
DROP POLICY IF EXISTS "Authenticated users can manage empresas" ON empresas;

-- Criar políticas otimizadas
CREATE POLICY "Authenticated users can manage empresas" ON empresas FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

-- Otimizar políticas de profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT
    USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
    USING ((SELECT auth.uid()) = id);

-- Otimizar políticas das outras tabelas
DROP POLICY IF EXISTS "Authenticated users can manage contas_bancarias" ON contas_bancarias;
CREATE POLICY "Authenticated users can manage contas_bancarias" ON contas_bancarias FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage grupos_contas" ON grupos_contas;
CREATE POLICY "Authenticated users can manage grupos_contas" ON grupos_contas FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage clientes" ON clientes;
CREATE POLICY "Authenticated users can manage clientes" ON clientes FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage fornecedores" ON fornecedores;
CREATE POLICY "Authenticated users can manage fornecedores" ON fornecedores FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage lancamentos_caixa" ON lancamentos_caixa;
CREATE POLICY "Authenticated users can manage lancamentos_caixa" ON lancamentos_caixa FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage operacoes" ON operacoes;
CREATE POLICY "Authenticated users can manage operacoes" ON operacoes FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage despesas_operacao" ON despesas_operacao;
CREATE POLICY "Authenticated users can manage despesas_operacao" ON despesas_operacao FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage cheques" ON cheques;
CREATE POLICY "Authenticated users can manage cheques" ON cheques FOR ALL
    USING ((SELECT auth.role()) = 'authenticated');;
