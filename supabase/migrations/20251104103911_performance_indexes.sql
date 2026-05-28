-- ============================================
-- ÍNDICES DE PERFORMANCE ADICIONAIS
-- ============================================

-- Índices para foreign keys sem cobertura
CREATE INDEX IF NOT EXISTS idx_contas_bancarias_banco_id ON contas_bancarias(banco_id);
CREATE INDEX IF NOT EXISTS idx_cheques_conta_bancaria_id ON cheques(conta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_caixa_grupo_contas_id ON lancamentos_caixa(grupo_contas_id);
CREATE INDEX IF NOT EXISTS idx_despesas_operacao_operacao_id ON despesas_operacao(operacao_id);
CREATE INDEX IF NOT EXISTS idx_despesas_operacao_grupo_contas_id ON despesas_operacao(grupo_contas_id);
CREATE INDEX IF NOT EXISTS idx_operacoes_cliente_id ON operacoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_operacoes_fornecedor_id ON operacoes(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_profiles_empresa_id ON profiles(empresa_id);

-- Índices compostos para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_lancamentos_empresa_data ON lancamentos_caixa(empresa_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_lancamentos_empresa_tipo ON lancamentos_caixa(empresa_id, tipo);
CREATE INDEX IF NOT EXISTS idx_contas_empresa_status ON contas_bancarias(empresa_id, status) WHERE status = true;
CREATE INDEX IF NOT EXISTS idx_grupos_empresa_natureza ON grupos_contas(empresa_id, natureza);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa_status ON clientes(empresa_id, status) WHERE status = true;
CREATE INDEX IF NOT EXISTS idx_fornecedores_empresa_status ON fornecedores(empresa_id, status) WHERE status = true;

-- Índices para busca por documento/CNPJ
CREATE INDEX IF NOT EXISTS idx_clientes_documento ON clientes(documento) WHERE documento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fornecedores_cnpj ON fornecedores(cnpj) WHERE cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_empresas_cnpj ON empresas(cnpj) WHERE cnpj IS NOT NULL;;
