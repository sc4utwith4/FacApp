-- ============================================
-- DADOS INICIAIS - Grupos de Contas
-- ============================================

-- Grupos de Contas (Entradas)
INSERT INTO grupos_contas (empresa_id, nome, natureza, descricao) VALUES
('00000000-0000-0000-0000-000000000001'::UUID, 'Vendas de Produtos', 'entrada', 'Receitas provenientes de vendas de produtos'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Vendas de Serviços', 'entrada', 'Receitas provenientes de prestação de serviços'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Receitas Financeiras', 'entrada', 'Rendimentos de aplicações e investimentos'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Outras Receitas', 'entrada', 'Outras receitas diversas')
ON CONFLICT DO NOTHING;

-- Grupos de Contas (Saídas)
INSERT INTO grupos_contas (empresa_id, nome, natureza, descricao) VALUES
('00000000-0000-0000-0000-000000000001'::UUID, 'Fornecedores', 'saida', 'Pagamentos a fornecedores'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Salários e Encargos', 'saida', 'Folha de pagamento e encargos sociais'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Aluguel e Condomínio', 'saida', 'Aluguel de imóveis e condomínios'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Energia e Telefone', 'saida', 'Contas de energia elétrica, telefone e internet'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Marketing e Publicidade', 'saida', 'Gastos com marketing e publicidade'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Combustível e Transporte', 'saida', 'Gastos com combustível e transporte'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Manutenção e Reparos', 'saida', 'Gastos com manutenção e reparos'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Impostos e Taxas', 'saida', 'Impostos e taxas diversas'),
('00000000-0000-0000-0000-000000000001'::UUID, 'Outras Despesas', 'saida', 'Outras despesas diversas')
ON CONFLICT DO NOTHING;;
