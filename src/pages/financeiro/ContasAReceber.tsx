import FinanceiroPrevistosBoard from "@/components/financeiro/PrevistosBoard";
import { RecebiveisOperacoesEstoque } from "@/components/estoque/RecebiveisOperacoesEstoque";
import { Separator } from "@/components/ui/separator";

const ContasAReceber = () => (
  <div className="space-y-6">
  <FinanceiroPrevistosBoard
    tipo="entrada"
    title="Contas a Receber"
    description="Visualize recebimentos previstos, antecipe entradas e confirme recebimentos à medida que forem liquidados."
    emptyMessage="Nenhum recebimento previsto para o período selecionado."
  />
    
    <Separator />
    
    <RecebiveisOperacoesEstoque />
  </div>
);

export default ContasAReceber;

