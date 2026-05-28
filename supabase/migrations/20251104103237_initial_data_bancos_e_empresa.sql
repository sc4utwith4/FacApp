-- ============================================
-- DADOS INICIAIS - Bancos e Empresa
-- ============================================

-- 1. INSERIR BANCOS BRASILEIROS PRINCIPAIS
INSERT INTO bancos (codigo, nome) VALUES
('001', 'Banco do Brasil S.A.'),
('033', 'Banco Santander (Brasil) S.A.'),
('104', 'Caixa Econômica Federal'),
('237', 'Banco Bradesco S.A.'),
('341', 'Banco Itaú S.A.'),
('356', 'Banco Real S.A.'),
('422', 'Banco Safra S.A.'),
('748', 'Banco Cooperativo Sicredi S.A.'),
('756', 'Bancoob - Banco Cooperativo do Brasil S.A.')
ON CONFLICT (codigo) DO NOTHING;

-- 2. INSERIR ESTADOS BRASILEIROS (UF)
INSERT INTO ufs (codigo, nome) VALUES
('AC', 'Acre'),
('AL', 'Alagoas'),
('AP', 'Amapá'),
('AM', 'Amazonas'),
('BA', 'Bahia'),
('CE', 'Ceará'),
('DF', 'Distrito Federal'),
('ES', 'Espírito Santo'),
('GO', 'Goiás'),
('MA', 'Maranhão'),
('MT', 'Mato Grosso'),
('MS', 'Mato Grosso do Sul'),
('MG', 'Minas Gerais'),
('PA', 'Pará'),
('PB', 'Paraíba'),
('PR', 'Paraná'),
('PE', 'Pernambuco'),
('PI', 'Piauí'),
('RJ', 'Rio de Janeiro'),
('RN', 'Rio Grande do Norte'),
('RS', 'Rio Grande do Sul'),
('RO', 'Rondônia'),
('RR', 'Roraima'),
('SC', 'Santa Catarina'),
('SP', 'São Paulo'),
('SE', 'Sergipe'),
('TO', 'Tocantins')
ON CONFLICT (codigo) DO NOTHING;

-- 3. INSERIR EMPRESA PADRÃO (se não existir)
INSERT INTO empresas (id, nome, razao_social, cnpj, email, telefone, status)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'ASSFAC Platform',
    'ASSFAC Platform Ltda',
    '12345678000190',
    'contato@assfac.com.br',
    '(11) 99999-9999',
    true
)
ON CONFLICT DO NOTHING;;
