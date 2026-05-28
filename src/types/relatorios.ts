export interface FiltrosRelatorio {
  periodo: {
    inicio: string;
    fim: string;
  };
  conta_bancaria_id?: string;
  grupo_conta_id?: string;
}

export interface RelatorioFechamento {
  periodo: { inicio: string; fim: string };
  resumo: {
    total_entradas: number;
    total_saidas: number;
    saldo_final: number;
    quantidade_lancamentos: number;
  };
  lancamentos: LancamentoCaixa[];
  saldo_por_conta: Array<{
    conta: ContaBancaria;
    saldo_inicial: number;
    saldo_final: number;
    movimentacao: number;
  }>;
}

export interface RelatorioExtrato {
  conta: ContaBancaria;
  periodo: { inicio: string; fim: string };
  saldo_inicial: number;
  saldo_final: number;
  lancamentos: LancamentoCaixa[];
}

export interface RelatorioReceitasDespesas {
  periodo: { inicio: string; fim: string };
  receitas: Array<{
    grupo: string;
    total: number;
    quantidade: number;
  }>;
  despesas: Array<{
    grupo: string;
    total: number;
    quantidade: number;
  }>;
  total_receitas: number;
  total_despesas: number;
  saldo_periodo: number;
}

// Tipos existentes (importados)
export interface LancamentoCaixa {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  grupo_conta_id: string;
  cliente_id?: string;
  fornecedor_id?: string;
  descricao: string;
  valor: number;
  data: string;
  tipo: 'entrada' | 'saida';
  observacoes?: string;
  created_at: string;
  updated_at: string;
  contas_bancarias?: ContaBancaria;
  grupos_contas?: GrupoConta;
  clientes?: Cliente;
}

export interface ContaBancaria {
  id: string;
  empresa_id: string;
  banco_id: string;
  nome: string;
  agencia: string;
  conta: string;
  saldo_inicial: number;
  saldo_atual: number;
  status: boolean;
  created_at: string;
  updated_at: string;
  bancos?: Banco;
}

export interface GrupoConta {
  id: string;
  empresa_id: string;
  nome: string;
  natureza: 'receita' | 'despesa';
  descricao?: string;
  created_at: string;
  updated_at: string;
}

export interface Cliente {
  id: string;
  empresa_id: string;
  nome: string;
  email?: string;
  telefone?: string;
  documento: string;
  tipo_pessoa: 'fisica' | 'juridica';
  created_at: string;
  updated_at: string;
}

export interface Banco {
  id: string;
  codigo: string;
  nome: string;
  created_at: string;
  updated_at: string;
}






