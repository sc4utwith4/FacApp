-- ============================================
-- FUNÇÕES HELPER E MELHORIAS RLS
-- ============================================

-- 1. Criar função helper para obter empresa_id do usuário autenticado
CREATE OR REPLACE FUNCTION get_user_empresa_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_empresa_id UUID;
BEGIN
    -- Buscar empresa_id do perfil do usuário autenticado
    SELECT empresa_id INTO v_empresa_id
    FROM profiles
    WHERE id = auth.uid()
    LIMIT 1;
    
    RETURN v_empresa_id;
END;
$$;

-- 2. Criar função helper para verificar se usuário é admin ou financeiro
CREATE OR REPLACE FUNCTION user_has_permission(required_perfil TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_perfil TEXT;
BEGIN
    -- Buscar perfil do usuário autenticado
    SELECT perfil INTO v_perfil
    FROM profiles
    WHERE id = auth.uid()
    LIMIT 1;
    
    -- Se não especificar perfil, qualquer usuário autenticado pode
    IF required_perfil IS NULL THEN
        RETURN v_perfil IS NOT NULL;
    END IF;
    
    -- Verificar se o perfil corresponde ou é Admin (que tem acesso total)
    RETURN v_perfil = required_perfil OR v_perfil = 'Admin';
END;
$$;

-- 3. Remover políticas antigas e criar novas otimizadas por empresa
-- Empresas
DROP POLICY IF EXISTS "Authenticated users can manage empresas" ON empresas;
DROP POLICY IF EXISTS "Users can view own empresa" ON empresas;

CREATE POLICY "Users can view empresas" ON empresas FOR SELECT
    USING (true); -- Todos podem ver empresas (pode ajustar conforme necessário)

CREATE POLICY "Authenticated users can manage empresas" ON empresas FOR INSERT
    WITH CHECK ((SELECT auth.role()) = 'authenticated');

CREATE POLICY "Authenticated users can update own empresa" ON empresas FOR UPDATE
    USING ((SELECT auth.role()) = 'authenticated');

-- Profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT
    USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
    USING ((SELECT auth.uid()) = id);

-- Contas Bancárias - Filtrar por empresa_id
DROP POLICY IF EXISTS "Authenticated users can manage contas_bancarias" ON contas_bancarias;

CREATE POLICY "Users can view own empresa contas" ON contas_bancarias FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

CREATE POLICY "Users can manage own empresa contas" ON contas_bancarias FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

-- Grupos de Contas - Filtrar por empresa_id
DROP POLICY IF EXISTS "Authenticated users can manage grupos_contas" ON grupos_contas;

CREATE POLICY "Users can view own empresa grupos" ON grupos_contas FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

CREATE POLICY "Users can manage own empresa grupos" ON grupos_contas FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

-- Clientes - Filtrar por empresa_id
DROP POLICY IF EXISTS "Authenticated users can manage clientes" ON clientes;

CREATE POLICY "Users can view own empresa clientes" ON clientes FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

CREATE POLICY "Users can manage own empresa clientes" ON clientes FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

-- Fornecedores - Filtrar por empresa_id
DROP POLICY IF EXISTS "Authenticated users can manage fornecedores" ON fornecedores;

CREATE POLICY "Users can view own empresa fornecedores" ON fornecedores FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

CREATE POLICY "Users can manage own empresa fornecedores" ON fornecedores FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

-- Lançamentos de Caixa - Filtrar por empresa_id
DROP POLICY IF EXISTS "Authenticated users can manage lancamentos_caixa" ON lancamentos_caixa;

CREATE POLICY "Users can view own empresa lancamentos" ON lancamentos_caixa FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

CREATE POLICY "Users can manage own empresa lancamentos" ON lancamentos_caixa FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

-- Operações - Filtrar por empresa_id
DROP POLICY IF EXISTS "Authenticated users can manage operacoes" ON operacoes;

CREATE POLICY "Users can view own empresa operacoes" ON operacoes FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

CREATE POLICY "Users can manage own empresa operacoes" ON operacoes FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        empresa_id = (SELECT get_user_empresa_id())
    );

-- Despesas de Operação - Filtrar por empresa_id através da operação
DROP POLICY IF EXISTS "Authenticated users can manage despesas_operacao" ON despesas_operacao;

CREATE POLICY "Users can view own empresa despesas" ON despesas_operacao FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        EXISTS (
            SELECT 1 FROM operacoes
            WHERE operacoes.id = despesas_operacao.operacao_id
            AND operacoes.empresa_id = (SELECT get_user_empresa_id())
        )
    );

CREATE POLICY "Users can manage own empresa despesas" ON despesas_operacao FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        EXISTS (
            SELECT 1 FROM operacoes
            WHERE operacoes.id = despesas_operacao.operacao_id
            AND operacoes.empresa_id = (SELECT get_user_empresa_id())
        )
    );

-- Cheques - Filtrar por empresa_id através da conta bancária
DROP POLICY IF EXISTS "Authenticated users can manage cheques" ON cheques;

CREATE POLICY "Users can view own empresa cheques" ON cheques FOR SELECT
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        EXISTS (
            SELECT 1 FROM contas_bancarias
            WHERE contas_bancarias.id = cheques.conta_bancaria_id
            AND contas_bancarias.empresa_id = (SELECT get_user_empresa_id())
        )
    );

CREATE POLICY "Users can manage own empresa cheques" ON cheques FOR ALL
    USING (
        (SELECT auth.role()) = 'authenticated' AND
        EXISTS (
            SELECT 1 FROM contas_bancarias
            WHERE contas_bancarias.id = cheques.conta_bancaria_id
            AND contas_bancarias.empresa_id = (SELECT get_user_empresa_id())
        )
    );;
