import { Building2, TrendingUp, TrendingDown, Calendar, Package, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFornecedoresComOperacoes, type FornecedorComOperacoes } from "@/hooks/useEstoque";

// Funções utilitárias locais
const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || isNaN(value)) {
    return "R$ 0,00";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "-";
  try {
    const date = new Date(dateString.includes('T') ? dateString : dateString + "T00:00:00");
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("pt-BR");
  } catch {
    return dateString;
  }
};

interface ListaFornecedoresOperacoesProps {
  tipoEstoque: "SPPRO" | "SOI";
  onFornecedorClick: (fornecedorId: string, fornecedorNome: string) => void;
}

export function ListaFornecedoresOperacoes({
  tipoEstoque,
  onFornecedorClick,
}: ListaFornecedoresOperacoesProps) {
  const { data: fornecedores, isLoading, error } = useFornecedoresComOperacoes(tipoEstoque);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Carregando fornecedores...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive font-semibold">Erro ao carregar fornecedores</p>
          <p className="text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Erro desconhecido"}
          </p>
        </div>
      </div>
    );
  }

  if (!fornecedores || fornecedores.length === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="border-dashed w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum fornecedor encontrado</h3>
            <p className="text-sm text-muted-foreground">
              Não há fornecedores com operações {tipoEstoque} cadastradas ainda.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const corTipo = tipoEstoque === "SPPRO" ? "blue" : "purple";
  const corTipoHex = tipoEstoque === "SPPRO" ? "#3b82f6" : "#a855f7";

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {fornecedores.map((fornecedor) => (
        <Card
          key={fornecedor.fornecedor_id}
          className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.02] border-l-4"
          style={{ borderLeftColor: corTipoHex }}
          onClick={() => onFornecedorClick(fornecedor.fornecedor_id, fornecedor.fornecedor_nome)}
        >
          <CardContent className="p-6">
            <div className="space-y-4">
              {/* Header com nome do fornecedor */}
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate" title={fornecedor.fornecedor_nome}>
                    {fornecedor.fornecedor_nome}
                  </h3>
                </div>
                <Badge
                  variant="secondary"
                  className="ml-2 shrink-0"
                  style={{
                    backgroundColor: `${corTipoHex}15`,
                    color: corTipoHex,
                    borderColor: `${corTipoHex}40`,
                  }}
                >
                  <Package className="h-3 w-3 mr-1" />
                  {fornecedor.total_operacoes}
                </Badge>
              </div>

              {/* Valor Líquido Total */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Líquido</span>
                  {fornecedor.total_liquido >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-success" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  )}
                </div>
                <p
                  className={`text-2xl font-bold ${
                    fornecedor.total_liquido >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {formatCurrency(fornecedor.total_liquido)}
                </p>
              </div>

              {/* Estatísticas */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Entradas</p>
                  <p className="text-sm font-medium text-success">
                    {formatCurrency(fornecedor.total_entradas)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Saídas</p>
                  <p className="text-sm font-medium text-destructive">
                    {formatCurrency(fornecedor.total_saidas)}
                  </p>
                </div>
              </div>

              {/* Última Operação */}
              {fornecedor.ultima_operacao && (
                <div className="flex items-center gap-2 pt-2 border-t text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>Última: {formatDate(fornecedor.ultima_operacao)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

