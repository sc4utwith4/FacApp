export type LancamentoCategoriaOperacional =
  | "entrada"
  | "saida"
  | "movimentacao"
  | "devolucao"
  | "recompra"
  | "operacao";

export type LancamentoOrigemTipo =
  | "movimentacao"
  | "devolucao_estoque"
  | "recompra_estoque"
  | "operacao_estoque"
  | "previsto_pago"
  | "manual";

export interface LancamentoOrigem {
  tipo: LancamentoOrigemTipo;
  label: string;
  referencia?: string | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface LancamentoAnexo {
  id: string;
  empresa_id: string;
  lancamento_caixa_id: string;
  storage_bucket: string;
  storage_key: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface LancamentoDetalhe {
  id: string;
  data: string;
  historico: string;
  tipo: "entrada" | "saida";
  valor: number;
  documento: string | null;
  observacoes: string | null;
  conta_bancaria_id: string | null;
  grupo_contas_id: string | null;
}
