// ============================================
// APLICAR CÁLCULO AUTOMÁTICO DE LIQUIDAÇÃO
// ============================================

import { supabase } from "@/integrations/supabase/client";
import { calcularLiquidacao, type ParametrosLiquidacao } from "./calculoLiquidacao";
import type { TituloCobranca, EventoCobranca } from "@/types/cobranca-bancaria";

/**
 * Aplica cálculo automático de liquidação a um evento
 * Busca regras da carteira e calcula valores automaticamente
 */
export async function aplicarCalculoLiquidacaoAutomatico(
  evento: EventoCobranca,
  titulo: TituloCobranca
): Promise<void> {
  // Se o evento já tem valores calculados, não recalcular
  if (evento.valor_principal > 0 && evento.valor_liquido > 0) {
    return;
  }

  // Buscar regras da carteira
  let regrasJurosMulta = {
    juros_diario: 0.033, // Padrão: 0.033% ao dia
    multa_atraso: 2, // Padrão: 2%
    desconto_antecipacao: 0,
  };

  if (titulo.carteira_id) {
    const { data: carteira } = await supabase
      .from("carteiras_cobranca")
      .select("regras_juros_multa")
      .eq("id", titulo.carteira_id)
      .single();

    if (carteira?.regras_juros_multa) {
      const regras = carteira.regras_juros_multa as any;
      regrasJurosMulta = {
        juros_diario: regras.juros_diario || 0.033,
        multa_atraso: regras.multa_atraso || 2,
        desconto_antecipacao: regras.desconto_antecipacao || 0,
      };
    }
  }

  // Calcular valores
  const parametros: ParametrosLiquidacao = {
    valor_nominal: titulo.valor_nominal,
    data_vencimento: titulo.vencimento,
    data_liquidacao: evento.data_evento,
    regras_juros_multa: regrasJurosMulta,
    tarifa_bancaria: evento.tarifa || 0,
    comissao_factoring: 0, // TODO: Buscar da carteira se necessário
    percentual_repasse: 100,
  };

  const resultado = calcularLiquidacao(parametros);

  // Atualizar evento com valores calculados
  await supabase
    .from("eventos_cobranca")
    .update({
      valor_principal: resultado.valor_principal,
      juros: resultado.juros,
      multa: resultado.multa,
      desconto: resultado.desconto,
      tarifa: resultado.tarifa,
      valor_liquido: resultado.valor_liquido,
    })
    .eq("id", evento.id);
}

