// Tipos para a página de Recebidos

export type OrigemRecebimento = "caixa" | "estoque";

export interface RecebimentoCaixa {
  id: string;
  data: string;
  historico: string;
  tipo: "entrada";
  valor: number;
  documento: string | null;
  conta_bancaria_id: string | null;
  grupo_contas_id: string | null;
  observacoes: string | null;
  origem: "caixa";
  grupos_contas?: {
    id: string;
    nome: string;
    natureza: string;
  } | null;
  contas_bancarias?: {
    id: string;
    descricao: string;
    agencia: string | null;
    conta: string | null;
    bancos?: {
      nome: string;
    } | null;
  } | null;
}

export interface RecebimentoEstoque {
  id: number;
  data_vencimento: string;
  descricao: string | null;
  valor: number;
  tipo_estoque: "SPPRO" | "SOI";
  status: "pago";
  operacao_estoque_id: number;
  origem: "estoque";
  operacoes_estoque?: {
    id: number;
    data: string;
    historico: string | null;
    fornecedores?: {
      razao_social: string | null;
      nome_fantasia: string | null;
    } | null;
  } | null;
}

export type Recebimento = RecebimentoCaixa | RecebimentoEstoque;

export interface FiltrosRecebidos {
  data_inicio?: string;
  data_fim?: string;
  conta_bancaria_id?: string;
  grupo_contas_id?: string;
  cliente_id?: string;
  tipo_estoque?: "SPPRO" | "SOI" | "todos";
  busca?: string;
}

export interface ResumoRecebidos {
  totalMes: number;
  totalAno: number;
  totalPeriodo: number;
  quantidade: number;
  mediaDiaria: number;
  maiorRecebimento: number;
}

export interface RecebimentoPorGrupo {
  grupo_id: string;
  grupo_nome: string;
  recebimentos: RecebimentoCaixa[];
  total: number;
  quantidade: number;
}

export interface RecebivelPorFornecedor {
  fornecedor_id: string | null;
  fornecedor_nome: string;
  recebimentos: RecebimentoEstoque[];
  total: number;
  quantidade: number;
}

