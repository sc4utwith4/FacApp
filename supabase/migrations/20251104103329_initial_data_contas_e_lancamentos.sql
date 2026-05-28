-- ============================================
-- DADOS INICIAIS - Contas Bancárias e Lançamentos
-- ============================================

-- 1. INSERIR CONTAS BANCÁRIAS
INSERT INTO contas_bancarias (empresa_id, banco_id, agencia, conta, descricao, saldo_inicial, status)
VALUES
('00000000-0000-0000-0000-000000000001'::UUID, 1, '1234-5', '12345-6', 'Conta Corrente Principal - BB', 15000.00, true),
('00000000-0000-0000-0000-000000000001'::UUID, 4, '4567-8', '98765-4', 'Conta Corrente - CEF', 8500.00, true),
('00000000-0000-0000-0000-000000000001'::UUID, 3, '7890-1', '54321-0', 'Conta Corrente - Bradesco', 12000.00, true)
ON CONFLICT DO NOTHING;

-- 2. INSERIR LANÇAMENTOS DE CAIXA (Últimos 30 dias)
-- Primeiro, vamos buscar os IDs dinamicamente
DO $$
DECLARE
    v_empresa_id UUID := '00000000-0000-0000-0000-000000000001'::UUID;
    v_conta_bb UUID;
    v_conta_cef UUID;
    v_conta_bradesco UUID;
    v_grupo_vendas_produtos UUID;
    v_grupo_vendas_servicos UUID;
    v_grupo_receitas_fin UUID;
    v_grupo_outras_receitas UUID;
    v_grupo_fornecedores UUID;
    v_grupo_salarios UUID;
    v_grupo_aluguel UUID;
    v_grupo_energia UUID;
    v_grupo_marketing UUID;
    v_grupo_combustivel UUID;
    v_grupo_manutencao UUID;
    v_grupo_impostos UUID;
    v_grupo_outras_despesas UUID;
BEGIN
    -- Buscar IDs das contas bancárias
    SELECT id INTO v_conta_bb FROM contas_bancarias WHERE descricao = 'Conta Corrente Principal - BB' LIMIT 1;
    SELECT id INTO v_conta_cef FROM contas_bancarias WHERE descricao = 'Conta Corrente - CEF' LIMIT 1;
    SELECT id INTO v_conta_bradesco FROM contas_bancarias WHERE descricao = 'Conta Corrente - Bradesco' LIMIT 1;
    
    -- Buscar IDs dos grupos de contas
    SELECT id INTO v_grupo_vendas_produtos FROM grupos_contas WHERE nome = 'Vendas de Produtos' LIMIT 1;
    SELECT id INTO v_grupo_vendas_servicos FROM grupos_contas WHERE nome = 'Vendas de Serviços' LIMIT 1;
    SELECT id INTO v_grupo_receitas_fin FROM grupos_contas WHERE nome = 'Receitas Financeiras' LIMIT 1;
    SELECT id INTO v_grupo_outras_receitas FROM grupos_contas WHERE nome = 'Outras Receitas' LIMIT 1;
    SELECT id INTO v_grupo_fornecedores FROM grupos_contas WHERE nome = 'Fornecedores' LIMIT 1;
    SELECT id INTO v_grupo_salarios FROM grupos_contas WHERE nome = 'Salários e Encargos' LIMIT 1;
    SELECT id INTO v_grupo_aluguel FROM grupos_contas WHERE nome = 'Aluguel e Condomínio' LIMIT 1;
    SELECT id INTO v_grupo_energia FROM grupos_contas WHERE nome = 'Energia e Telefone' LIMIT 1;
    SELECT id INTO v_grupo_marketing FROM grupos_contas WHERE nome = 'Marketing e Publicidade' LIMIT 1;
    SELECT id INTO v_grupo_combustivel FROM grupos_contas WHERE nome = 'Combustível e Transporte' LIMIT 1;
    SELECT id INTO v_grupo_manutencao FROM grupos_contas WHERE nome = 'Manutenção e Reparos' LIMIT 1;
    SELECT id INTO v_grupo_impostos FROM grupos_contas WHERE nome = 'Impostos e Taxas' LIMIT 1;
    SELECT id INTO v_grupo_outras_despesas FROM grupos_contas WHERE nome = 'Outras Despesas' LIMIT 1;
    
    -- Inserir lançamentos de ENTRADA
    INSERT INTO lancamentos_caixa (empresa_id, conta_bancaria_id, grupo_contas_id, data, historico, tipo, valor, documento) VALUES
    -- Vendas de Produtos
    (v_empresa_id, v_conta_bb, v_grupo_vendas_produtos, CURRENT_DATE - INTERVAL '15 days', 'Venda de produtos diversos', 'entrada', 2500.00, 'VEN-001'),
    (v_empresa_id, v_conta_bb, v_grupo_vendas_produtos, CURRENT_DATE - INTERVAL '14 days', 'Venda de equipamentos', 'entrada', 1800.00, 'VEN-002'),
    (v_empresa_id, v_conta_cef, v_grupo_vendas_produtos, CURRENT_DATE - INTERVAL '13 days', 'Venda de produtos', 'entrada', 3200.00, 'VEN-003'),
    (v_empresa_id, v_conta_bb, v_grupo_vendas_produtos, CURRENT_DATE - INTERVAL '12 days', 'Venda de produtos', 'entrada', 1500.00, 'VEN-004'),
    (v_empresa_id, v_conta_bradesco, v_grupo_vendas_produtos, CURRENT_DATE - INTERVAL '11 days', 'Venda de equipamentos', 'entrada', 4200.00, 'VEN-005'),
    
    -- Vendas de Serviços
    (v_empresa_id, v_conta_bb, v_grupo_vendas_servicos, CURRENT_DATE - INTERVAL '15 days', 'Prestação de serviços', 'entrada', 800.00, 'SER-001'),
    (v_empresa_id, v_conta_cef, v_grupo_vendas_servicos, CURRENT_DATE - INTERVAL '14 days', 'Consultoria técnica', 'entrada', 1200.00, 'SER-002'),
    (v_empresa_id, v_conta_bb, v_grupo_vendas_servicos, CURRENT_DATE - INTERVAL '13 days', 'Manutenção de equipamentos', 'entrada', 600.00, 'SER-003'),
    (v_empresa_id, v_conta_bradesco, v_grupo_vendas_servicos, CURRENT_DATE - INTERVAL '12 days', 'Prestação de serviços', 'entrada', 950.00, 'SER-004'),
    
    -- Receitas Financeiras
    (v_empresa_id, v_conta_bb, v_grupo_receitas_fin, CURRENT_DATE - INTERVAL '15 days', 'Rendimento de aplicação', 'entrada', 150.00, 'FIN-001'),
    (v_empresa_id, v_conta_cef, v_grupo_receitas_fin, CURRENT_DATE - INTERVAL '10 days', 'Rendimento de aplicação', 'entrada', 200.00, 'FIN-002'),
    
    -- Outras Receitas
    (v_empresa_id, v_conta_bb, v_grupo_outras_receitas, CURRENT_DATE - INTERVAL '14 days', 'Devolução de imposto', 'entrada', 300.00, 'OUT-001'),
    (v_empresa_id, v_conta_bradesco, v_grupo_outras_receitas, CURRENT_DATE - INTERVAL '13 days', 'Recebimento de multa', 'entrada', 100.00, 'OUT-002');
    
    -- Inserir lançamentos de SAÍDA
    INSERT INTO lancamentos_caixa (empresa_id, conta_bancaria_id, grupo_contas_id, data, historico, tipo, valor, documento) VALUES
    -- Fornecedores
    (v_empresa_id, v_conta_bb, v_grupo_fornecedores, CURRENT_DATE - INTERVAL '15 days', 'Pagamento fornecedor ABC', 'saida', 1200.00, 'FOR-001'),
    (v_empresa_id, v_conta_cef, v_grupo_fornecedores, CURRENT_DATE - INTERVAL '14 days', 'Pagamento fornecedor XYZ', 'saida', 800.00, 'FOR-002'),
    (v_empresa_id, v_conta_bb, v_grupo_fornecedores, CURRENT_DATE - INTERVAL '13 days', 'Pagamento fornecedor DEF', 'saida', 1500.00, 'FOR-003'),
    (v_empresa_id, v_conta_bradesco, v_grupo_fornecedores, CURRENT_DATE - INTERVAL '12 days', 'Pagamento fornecedor GHI', 'saida', 900.00, 'FOR-004'),
    
    -- Salários e Encargos
    (v_empresa_id, v_conta_bb, v_grupo_salarios, CURRENT_DATE - INTERVAL '25 days', 'Folha de pagamento', 'saida', 8000.00, 'SAL-001'),
    (v_empresa_id, v_conta_cef, v_grupo_salarios, CURRENT_DATE - INTERVAL '25 days', 'Encargos sociais', 'saida', 2400.00, 'ENC-001'),
    
    -- Aluguel e Condomínio
    (v_empresa_id, v_conta_bb, v_grupo_aluguel, CURRENT_DATE - INTERVAL '20 days', 'Aluguel do escritório', 'saida', 2500.00, 'ALU-001'),
    (v_empresa_id, v_conta_bb, v_grupo_aluguel, CURRENT_DATE - INTERVAL '20 days', 'Condomínio', 'saida', 300.00, 'CON-001'),
    
    -- Energia e Telefone
    (v_empresa_id, v_conta_cef, v_grupo_energia, CURRENT_DATE - INTERVAL '12 days', 'Conta de energia', 'saida', 450.00, 'ENE-001'),
    (v_empresa_id, v_conta_cef, v_grupo_energia, CURRENT_DATE - INTERVAL '12 days', 'Conta de telefone', 'saida', 180.00, 'TEL-001'),
    (v_empresa_id, v_conta_bb, v_grupo_energia, CURRENT_DATE - INTERVAL '12 days', 'Internet', 'saida', 120.00, 'INT-001'),
    
    -- Marketing e Publicidade
    (v_empresa_id, v_conta_bradesco, v_grupo_marketing, CURRENT_DATE - INTERVAL '14 days', 'Campanha publicitária', 'saida', 800.00, 'MAR-001'),
    (v_empresa_id, v_conta_bb, v_grupo_marketing, CURRENT_DATE - INTERVAL '13 days', 'Material promocional', 'saida', 300.00, 'PRO-001'),
    
    -- Combustível e Transporte
    (v_empresa_id, v_conta_cef, v_grupo_combustivel, CURRENT_DATE - INTERVAL '15 days', 'Combustível', 'saida', 200.00, 'COM-001'),
    (v_empresa_id, v_conta_bb, v_grupo_combustivel, CURRENT_DATE - INTERVAL '14 days', 'Transporte', 'saida', 150.00, 'TRA-001'),
    
    -- Manutenção e Reparos
    (v_empresa_id, v_conta_bradesco, v_grupo_manutencao, CURRENT_DATE - INTERVAL '13 days', 'Manutenção de equipamentos', 'saida', 400.00, 'MAN-001'),
    (v_empresa_id, v_conta_bb, v_grupo_manutencao, CURRENT_DATE - INTERVAL '12 days', 'Reparo de equipamentos', 'saida', 250.00, 'REP-001'),
    
    -- Impostos e Taxas
    (v_empresa_id, v_conta_bb, v_grupo_impostos, CURRENT_DATE - INTERVAL '15 days', 'ICMS', 'saida', 350.00, 'IMP-001'),
    (v_empresa_id, v_conta_cef, v_grupo_impostos, CURRENT_DATE - INTERVAL '15 days', 'ISS', 'saida', 180.00, 'ISS-001'),
    (v_empresa_id, v_conta_bradesco, v_grupo_impostos, CURRENT_DATE - INTERVAL '15 days', 'PIS/COFINS', 'saida', 120.00, 'PIS-001'),
    
    -- Outras Despesas
    (v_empresa_id, v_conta_bb, v_grupo_outras_despesas, CURRENT_DATE - INTERVAL '15 days', 'Material de escritório', 'saida', 150.00, 'MAT-001'),
    (v_empresa_id, v_conta_cef, v_grupo_outras_despesas, CURRENT_DATE - INTERVAL '14 days', 'Taxa bancária', 'saida', 50.00, 'TAX-001'),
    (v_empresa_id, v_conta_bradesco, v_grupo_outras_despesas, CURRENT_DATE - INTERVAL '13 days', 'Despesas diversas', 'saida', 200.00, 'DES-001');
    
    -- Lançamentos de hoje
    INSERT INTO lancamentos_caixa (empresa_id, conta_bancaria_id, grupo_contas_id, data, historico, tipo, valor, documento) VALUES
    (v_empresa_id, v_conta_bb, v_grupo_vendas_produtos, CURRENT_DATE, 'Venda de produtos - hoje', 'entrada', 1800.00, 'VEN-HOJE-001'),
    (v_empresa_id, v_conta_cef, v_grupo_vendas_servicos, CURRENT_DATE, 'Venda de serviços - hoje', 'entrada', 950.00, 'SER-HOJE-001'),
    (v_empresa_id, v_conta_bb, v_grupo_fornecedores, CURRENT_DATE, 'Pagamento fornecedor - hoje', 'saida', 600.00, 'FOR-HOJE-001'),
    (v_empresa_id, v_conta_cef, v_grupo_energia, CURRENT_DATE, 'Conta de energia - hoje', 'saida', 180.00, 'ENE-HOJE-001');
END $$;;
