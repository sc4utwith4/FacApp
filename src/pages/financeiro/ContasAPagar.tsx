import FinanceiroPrevistosBoard from "@/components/financeiro/PrevistosBoard";

const ContasAPagar = () => (
  <FinanceiroPrevistosBoard
    tipo="saida"
    title="Contas a Pagar"
    description="Acompanhe compromissos recorrentes, vencimentos e pagamentos confirmados para manter o caixa saudável."
    emptyMessage="Nenhum pagamento previsto para o período selecionado."
  />
);

export default ContasAPagar;

