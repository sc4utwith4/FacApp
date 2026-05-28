// Tipos para a página de Pagos

export interface Pagamento {
  id: string;
  data: string;
  historico: string;
  tipo: "entrada" | "saida";
  valor: number;
  documento: string | null;
  conta_bancaria_id: string | null;
  grupo_contas_id: string | null;
  observacoes: string | null;
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

export interface FiltrosPagos {
  data_inicio?: string;
  data_fim?: string;
  conta_bancaria_id?: string;
  grupo_contas_id?: string;
  busca?: string;
}

export interface ResumoPagos {
  totalMes: number;
  totalAno: number;
  totalPeriodo: number;
  quantidade: number;
  mediaDiaria: number;
  maiorPagamento: number;
}

export interface PagamentoPorGrupo {
  grupo_id: string;
  grupo_nome: string;
  pagamentos: Pagamento[];
  total: number;
  quantidade: number;
}

