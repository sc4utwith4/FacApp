import { z } from 'zod';

// Função para validar CNPJ
const cnpjSchema = z.string()
  .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'CNPJ deve estar no formato 00.000.000/0000-00')
  .refine((cnpj) => {
    // Remove caracteres não numéricos
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    
    // Verifica se tem 14 dígitos
    if (cnpjLimpo.length !== 14) return false;
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1+$/.test(cnpjLimpo)) return false;
    
    // Validação do primeiro dígito verificador
    let soma = 0;
    let peso = 5;
    for (let i = 0; i < 12; i++) {
      soma += parseInt(cnpjLimpo[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    let resto = soma % 11;
    const dv1 = resto < 2 ? 0 : 11 - resto;
    if (dv1 !== parseInt(cnpjLimpo[12])) return false;
    
    // Validação do segundo dígito verificador
    soma = 0;
    peso = 6;
    for (let i = 0; i < 13; i++) {
      soma += parseInt(cnpjLimpo[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    resto = soma % 11;
    const dv2 = resto < 2 ? 0 : 11 - resto;
    if (dv2 !== parseInt(cnpjLimpo[13])) return false;
    
    return true;
  }, 'CNPJ inválido');

// Função para validar CPF
const cpfSchema = z.string()
  .regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'CPF deve estar no formato 000.000.000-00')
  .refine((cpf) => {
    // Remove caracteres não numéricos
    const cpfLimpo = cpf.replace(/\D/g, '');
    
    // Verifica se tem 11 dígitos
    if (cpfLimpo.length !== 11) return false;
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1+$/.test(cpfLimpo)) return false;
    
    // Validação do primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
      soma += parseInt(cpfLimpo[i]) * (11 - i);
    }
    let resto = soma % 11;
    const dv1 = resto < 2 ? 0 : 11 - resto;
    if (dv1 !== parseInt(cpfLimpo[9])) return false;
    
    // Validação do segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
      soma += parseInt(cpfLimpo[i]) * (12 - i);
    }
    resto = soma % 11;
    const dv2 = resto < 2 ? 0 : 11 - resto;
    if (dv2 !== parseInt(cpfLimpo[10])) return false;
    
    return true;
  }, 'CPF inválido');

// Schema base para Fornecedor (sem validações complexas) - expandido para factoring
const fornecedorBaseSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo'),
  nome_fantasia: z.string().max(200, 'Nome fantasia muito longo').optional(),
  cnpj: cnpjSchema.optional(),
  cpf: cpfSchema.optional(),
  inscricao_estadual: z.string().max(20, 'Inscrição estadual muito longa').optional(),
  inscricao_municipal: z.string().max(20, 'Inscrição municipal muito longa').optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  telefone: z.string().max(20, 'Telefone muito longo').optional(),
  celular: z.string().max(20, 'Celular muito longo').optional(),
  endereco: z.string().max(500, 'Endereço muito longo').optional(),
  cidade: z.string().max(100, 'Cidade muito longa').optional(),
  estado: z.string().length(2, 'Estado deve ter 2 caracteres').optional(),
  cep: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP deve estar no formato 00000-000').optional(),
  observacoes: z.string().max(1000, 'Observações muito longas').default(''),
  ativo: z.boolean().default(true),
  // Campos de factoring
  limite_credito: z.number().min(0).default(0).optional(),
  limite_utilizado: z.number().min(0).default(0).optional(),
  taxa_antecipacao: z.number().min(0).max(100).default(0).optional(),
  prazo_medio_dias: z.number().int().min(0).default(30).optional(),
  situacao: z.enum(['ativo', 'em_analise', 'bloqueado', 'inadimplente']).default('ativo').optional(),
  data_avaliacao: z.string().optional(),
  score_credito: z.number().int().min(0).max(1000).optional(),
  saldo_a_liberar: z.number().min(0).default(0).optional(),
  titulos_em_atraso: z.number().int().min(0).default(0).optional(),
  valor_titulos_atraso: z.number().min(0).default(0).optional(),
});

// Schema completo para Fornecedor (com UUID)
export const fornecedorSchema = fornecedorBaseSchema.extend({
  id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  razao_social: z.string().min(1, 'Razão social é obrigatória').max(200),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).refine(
  (data) => data.cnpj || data.cpf || (!data.cnpj && !data.cpf),
  {
    message: 'Deve informar CNPJ ou CPF',
    path: ['cnpj']
  }
);

export type Fornecedor = z.infer<typeof fornecedorSchema>;

// Schema para criar Fornecedor
export const createFornecedorSchema = fornecedorBaseSchema.extend({
  empresa_id: z.string().uuid(),
  razao_social: z.string().min(1, 'Razão social é obrigatória').max(200).optional(),
}).refine(
  (data) => data.cnpj || data.cpf || (!data.cnpj && !data.cpf),
  {
    message: 'Deve informar CNPJ ou CPF',
    path: ['cnpj']
  }
).transform((data) => {
  // Se 'nome' foi fornecido mas não 'razao_social', usar 'nome' como 'razao_social'
  if (data.nome && !data.razao_social) {
    return { ...data, razao_social: data.nome };
  }
  return data;
});

export type CreateFornecedor = z.infer<typeof createFornecedorSchema>;

// Schema para atualizar Fornecedor
export const updateFornecedorSchema = fornecedorBaseSchema.partial().extend({
  id: z.string().uuid(),
}).refine(
  (data) => data.cnpj || data.cpf || (!data.cnpj && !data.cpf),
  {
    message: 'Deve informar CNPJ ou CPF',
    path: ['cnpj']
  }
);

export type UpdateFornecedor = z.infer<typeof updateFornecedorSchema>;

// Schema para filtros de fornecedores
export const filtrosFornecedoresSchema = z.object({
  nome: z.string().optional(),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  ativo: z.boolean().optional(),
  data_inicio: z.string().optional(),
  data_fim: z.string().optional(),
});

export type FiltrosFornecedores = z.infer<typeof filtrosFornecedoresSchema>;

// Schema para histórico de pagamentos
export const historicoPagamentoSchema = z.object({
  id: z.number(),
  data: z.string(),
  historico: z.string().nullable(),
  valor: z.number(),
  documento: z.string().nullable(),
  conta_bancaria_id: z.number(),
  conta_descricao: z.string(),
  banco_nome: z.string(),
});

export type HistoricoPagamento = z.infer<typeof historicoPagamentoSchema>;

// Schema para estatísticas de fornecedor
export const fornecedorStatsSchema = z.object({
  id: z.number(),
  nome: z.string(),
  nome_fantasia: z.string().nullable(),
  cnpj: z.string().nullable(),
  cpf: z.string().nullable(),
  email: z.string().nullable(),
  telefone: z.string().nullable(),
  cidade: z.string().nullable(),
  estado: z.string().nullable(),
  ativo: z.boolean(),
  total_pagamentos: z.number(),
  qtd_pagamentos: z.number(),
  ultimo_pagamento: z.string().nullable(),
  created_at: z.string(),
});

export type FornecedorStats = z.infer<typeof fornecedorStatsSchema>;

// Constantes
export const ESTADOS_BRASIL = [
  { value: 'AC', label: 'Acre' },
  { value: 'AL', label: 'Alagoas' },
  { value: 'AP', label: 'Amapá' },
  { value: 'AM', label: 'Amazonas' },
  { value: 'BA', label: 'Bahia' },
  { value: 'CE', label: 'Ceará' },
  { value: 'DF', label: 'Distrito Federal' },
  { value: 'ES', label: 'Espírito Santo' },
  { value: 'GO', label: 'Goiás' },
  { value: 'MA', label: 'Maranhão' },
  { value: 'MT', label: 'Mato Grosso' },
  { value: 'MS', label: 'Mato Grosso do Sul' },
  { value: 'MG', label: 'Minas Gerais' },
  { value: 'PA', label: 'Pará' },
  { value: 'PB', label: 'Paraíba' },
  { value: 'PR', label: 'Paraná' },
  { value: 'PE', label: 'Pernambuco' },
  { value: 'PI', label: 'Piauí' },
  { value: 'RJ', label: 'Rio de Janeiro' },
  { value: 'RN', label: 'Rio Grande do Norte' },
  { value: 'RS', label: 'Rio Grande do Sul' },
  { value: 'RO', label: 'Rondônia' },
  { value: 'RR', label: 'Roraima' },
  { value: 'SC', label: 'Santa Catarina' },
  { value: 'SP', label: 'São Paulo' },
  { value: 'SE', label: 'Sergipe' },
  { value: 'TO', label: 'Tocantins' },
];

// Funções auxiliares
export const formatCNPJ = (cnpj: string) => {
  const cleaned = cnpj.replace(/\D/g, '');
  return cleaned.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
};

export const formatCPF = (cpf: string) => {
  const cleaned = cpf.replace(/\D/g, '');
  return cleaned.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
};

export const formatCEP = (cep: string) => {
  const cleaned = cep.replace(/\D/g, '');
  return cleaned.replace(/^(\d{5})(\d{3})$/, '$1-$2');
};

export const formatTelefone = (telefone: string) => {
  const cleaned = telefone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return cleaned.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  } else if (cleaned.length === 11) {
    return cleaned.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  }
  return telefone;
};

// ============================================
// TIPOS PARA FACTORING
// ============================================

// Contrato de Fornecedor
export const contratoFornecedorSchema = z.object({
  id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  fornecedor_id: z.string().uuid(),
  numero_contrato: z.string().min(1, 'Número do contrato é obrigatório').max(50),
  data_inicio: z.string(),
  data_fim: z.string().nullable().optional(),
  valor_limite: z.number().min(0).default(0),
  taxa_antecipacao: z.number().min(0).max(100).default(0),
  prazo_medio_dias: z.number().int().min(0).default(30),
  status: z.enum(['ativo', 'suspenso', 'encerrado', 'cancelado']).default('ativo'),
  observacoes: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

export type ContratoFornecedor = z.infer<typeof contratoFornecedorSchema>;

export const createContratoFornecedorSchema = contratoFornecedorSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateContratoFornecedor = z.infer<typeof createContratoFornecedorSchema>;

// Duplicata de Fornecedor
export const duplicataFornecedorSchema = z.object({
  id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  fornecedor_id: z.string().uuid(),
  contrato_id: z.string().uuid().nullable().optional(),
  numero_duplicata: z.string().min(1, 'Número da duplicata é obrigatório').max(50),
  numero_nota_fiscal: z.string().max(50).nullable().optional(),
  data_emissao: z.string(),
  data_vencimento: z.string(),
  valor_face: z.number().min(0),
  valor_antecipado: z.number().min(0).default(0),
  taxa_aplicada: z.number().min(0).default(0),
  valor_liquido: z.number().min(0).default(0),
  status: z.enum(['pendente', 'antecipada', 'paga', 'vencida', 'cancelada']).default('pendente'),
  data_pagamento: z.string().nullable().optional(),
  data_antecipacao: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

export type DuplicataFornecedor = z.infer<typeof duplicataFornecedorSchema>;

export const createDuplicataFornecedorSchema = duplicataFornecedorSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateDuplicataFornecedor = z.infer<typeof createDuplicataFornecedorSchema>;

// Pagamento de Fornecedor
export const pagamentoFornecedorSchema = z.object({
  id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  fornecedor_id: z.string().uuid(),
  duplicata_id: z.string().uuid().nullable().optional(),
  conta_bancaria_id: z.string().uuid().nullable().optional(),
  data_pagamento: z.string(),
  valor: z.number().min(0),
  tipo_pagamento: z.enum(['normal', 'antecipacao', 'parcial']).default('normal'),
  forma_pagamento: z.enum(['transferencia', 'ted', 'doc', 'boleto', 'cheque', 'dinheiro']).default('transferencia'),
  numero_documento: z.string().max(50).nullable().optional(),
  historico: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

export type PagamentoFornecedor = z.infer<typeof pagamentoFornecedorSchema>;

export const createPagamentoFornecedorSchema = pagamentoFornecedorSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreatePagamentoFornecedor = z.infer<typeof createPagamentoFornecedorSchema>;

// Tarifa de Fornecedor
export const tarifaFornecedorSchema = z.object({
  id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  fornecedor_id: z.string().uuid(),
  duplicata_id: z.string().uuid().nullable().optional(),
  tipo_tarifa: z.enum(['antecipacao', 'iof', 'iss', 'ad_valorem', 'taxa_administrativa', 'outras']),
  descricao: z.string().max(200).nullable().optional(),
  valor: z.number().min(0),
  percentual: z.number().min(0).max(100).nullable().optional(),
  data_aplicacao: z.string(),
  observacoes: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

export type TarifaFornecedor = z.infer<typeof tarifaFornecedorSchema>;

export const createTarifaFornecedorSchema = tarifaFornecedorSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateTarifaFornecedor = z.infer<typeof createTarifaFornecedorSchema>;

// Indicadores de Fornecedor
export const indicadoresFornecedorSchema = z.object({
  limite_utilizado: z.number().min(0),
  saldo_a_liberar: z.number().min(0),
  titulos_em_atraso: z.number().int().min(0),
  valor_titulos_atraso: z.number().min(0),
  total_duplicatas_pendentes: z.number().min(0),
  total_duplicatas_antecipadas: z.number().min(0),
  total_pagamentos: z.number().min(0),
  total_tarifas: z.number().min(0),
});

export type IndicadoresFornecedor = z.infer<typeof indicadoresFornecedorSchema>;

// Fornecedor com Indicadores (para listagem)
export const fornecedorComIndicadoresSchema = z.object({
  id: z.string().uuid(),
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  cnpj: z.string().nullable(),
  situacao: z.string(),
  limite_credito: z.number().min(0),
  limite_utilizado: z.number().min(0),
  saldo_a_liberar: z.number().min(0),
  titulos_em_atraso: z.number().int().min(0),
  valor_titulos_atraso: z.number().min(0),
  status: z.boolean(),
  created_at: z.string(),
});

export type FornecedorComIndicadores = z.infer<typeof fornecedorComIndicadoresSchema>;
