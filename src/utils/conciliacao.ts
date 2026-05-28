// ============================================
// LÓGICA DE CONCILIAÇÃO - MÓDULO COBRANÇA BANCÁRIA
// ============================================

import type { TituloCobranca, EventoCobranca, EventoCobrancaInsert } from "@/types/cobranca-bancaria";
import { supabase } from "@/integrations/supabase/client";

export interface MatchResult {
  tituloId: string | null;
  confianca: number; // 0-100
  metodo: "nosso_numero" | "seu_numero" | "chave_composta" | "nenhum";
  detalhes?: string;
}

/**
 * Concilia um evento com um título usando diferentes estratégias de matching
 */
export async function conciliarEvento(
  evento: EventoCobrancaInsert,
  empresaId: string
): Promise<MatchResult> {
  // Estratégia 1: Matching por nosso_numero (mais confiável)
  if (evento.origem && typeof evento.origem === "object" && "nosso_numero" in evento.origem) {
    const nossoNumero = (evento.origem as any).nosso_numero as string;
    if (nossoNumero) {
      const match = await matchPorNossoNumero(nossoNumero, empresaId);
      if (match) {
        return {
          tituloId: match.id,
          confianca: 100,
          metodo: "nosso_numero",
          detalhes: `Match exato por nosso número: ${nossoNumero}`,
        };
      }
    }
  }

  // Estratégia 2: Matching por seu_numero/contrato
  if (evento.origem && typeof evento.origem === "object" && "seu_numero" in evento.origem) {
    const seuNumero = (evento.origem as any).seu_numero as string;
    if (seuNumero) {
      const match = await matchPorSeuNumero(seuNumero, empresaId);
      if (match) {
        return {
          tituloId: match.id,
          confianca: 90,
          metodo: "seu_numero",
          detalhes: `Match por seu número: ${seuNumero}`,
        };
      }
    }
  }

  // Estratégia 3: Matching por chave composta
  // (documento + vencimento + valor com tolerância)
  if (
    evento.origem &&
    typeof evento.origem === "object" &&
    "documento" in evento.origem &&
    "vencimento" in evento.origem &&
    "valor" in evento.origem
  ) {
    const documento = (evento.origem as any).documento as string;
    const vencimento = (evento.origem as any).vencimento as string;
    const valor = parseFloat((evento.origem as any).valor as string) || evento.valor_principal;

    if (documento && vencimento && valor > 0) {
      const match = await matchPorChaveComposta(documento, vencimento, valor, empresaId);
      if (match) {
        return {
          tituloId: match.tituloId,
          confianca: match.confianca,
          metodo: "chave_composta",
          detalhes: match.detalhes,
        };
      }
    }
  }

  return {
    tituloId: null,
    confianca: 0,
    metodo: "nenhum",
    detalhes: "Nenhum match encontrado",
  };
}

/**
 * Match por nosso número (exato)
 */
async function matchPorNossoNumero(
  nossoNumero: string,
  empresaId: string
): Promise<TituloCobranca | null> {
  const { data, error } = await supabase
    .from("titulos_cobranca")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("nosso_numero", nossoNumero)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Match por seu número (exato)
 */
async function matchPorSeuNumero(
  seuNumero: string,
  empresaId: string
): Promise<TituloCobranca | null> {
  const { data, error } = await supabase
    .from("titulos_cobranca")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("seu_numero", seuNumero)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Match por chave composta (documento + vencimento + valor com tolerância)
 */
async function matchPorChaveComposta(
  documento: string,
  vencimento: string,
  valor: number,
  empresaId: string
): Promise<{ tituloId: string; confianca: number; detalhes: string } | null> {
  // Buscar títulos com documento correspondente
  const { data: titulos, error } = await supabase
    .from("titulos_cobranca")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("sacado_documento", documento.replace(/[^\d]/g, "")) // Normalizar documento
    .gte("vencimento", new Date(vencimento).toISOString().split("T")[0])
    .lte("vencimento", new Date(vencimento).toISOString().split("T")[0]);

  if (error || !titulos || titulos.length === 0) return null;

  // Tolerância de 1% no valor
  const tolerancia = valor * 0.01;
  const valorMin = valor - tolerancia;
  const valorMax = valor + tolerancia;

  // Encontrar título com valor mais próximo
  let melhorMatch: TituloCobranca | null = null;
  let menorDiferenca = Infinity;

  for (const titulo of titulos) {
    const diferenca = Math.abs(titulo.valor_nominal - valor);
    if (diferenca <= tolerancia && diferenca < menorDiferenca) {
      melhorMatch = titulo;
      menorDiferenca = diferenca;
    }
  }

  if (!melhorMatch) return null;

  // Calcular confiança baseada na diferença de valor
  const diferencaPercentual = (menorDiferenca / valor) * 100;
  let confianca = 100;

  if (diferencaPercentual > 0.5) confianca = 80;
  if (diferencaPercentual > 1) confianca = 70;
  if (diferencaPercentual > 2) confianca = 60;

  return {
    tituloId: melhorMatch.id,
    confianca,
    detalhes: `Match por chave composta (documento: ${documento}, vencimento: ${vencimento}, valor: ${valor.toFixed(2)}). Diferença: ${menorDiferenca.toFixed(2)}`,
  };
}

/**
 * Concilia automaticamente todos os eventos não conciliados
 */
export async function conciliarEventosPendentes(empresaId: string): Promise<{
  conciliados: number;
  naoConciliados: number;
  erros: string[];
}> {
  const resultado = {
    conciliados: 0,
    naoConciliados: 0,
    erros: [] as string[],
  };

  try {
    // Buscar eventos não conciliados
    const { data: eventos, error: eventosError } = await supabase
      .from("eventos_cobranca")
      .select("*")
      .eq("conciliado", false)
      .order("created_at", { ascending: true });

    if (eventosError) {
      resultado.erros.push(`Erro ao buscar eventos: ${eventosError.message}`);
      return resultado;
    }

    if (!eventos || eventos.length === 0) {
      return resultado;
    }

    // Buscar título relacionado para cada evento
    for (const evento of eventos) {
      try {
        const { data: titulo } = await supabase
          .from("titulos_cobranca")
          .select("id, empresa_id")
          .eq("id", evento.titulo_id)
          .single();

        if (!titulo || titulo.empresa_id !== empresaId) {
          // Tentar conciliar
          const match = await conciliarEvento(evento as any, empresaId);
          if (match.tituloId && match.confianca >= 70) {
            // Atualizar evento com título encontrado
            const { error: updateError } = await supabase
              .from("eventos_cobranca")
              .update({
                titulo_id: match.tituloId,
                conciliado: true,
                confianca_conciliacao: match.confianca,
                observacoes: match.detalhes,
              })
              .eq("id", evento.id);

            if (updateError) {
              resultado.erros.push(`Erro ao atualizar evento ${evento.id}: ${updateError.message}`);
            } else {
              resultado.conciliados++;
            }
          } else {
            resultado.naoConciliados++;
          }
        } else {
          // Já está conciliado
          resultado.conciliados++;
        }
      } catch (error) {
        resultado.erros.push(
          `Erro ao processar evento ${evento.id}: ${error instanceof Error ? error.message : "Erro desconhecido"}`
        );
        resultado.naoConciliados++;
      }
    }
  } catch (error) {
    resultado.erros.push(
      `Erro geral na conciliação: ${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }

  return resultado;
}

/**
 * Atualiza o status do título baseado nos eventos conciliados
 */
export async function atualizarStatusTitulo(tituloId: string): Promise<void> {
  try {
    // Buscar todos os eventos do título ordenados por data
    const { data: eventos, error } = await supabase
      .from("eventos_cobranca")
      .select("*")
      .eq("titulo_id", tituloId)
      .eq("conciliado", true)
      .order("data_evento", { ascending: false });

    if (error || !eventos || eventos.length === 0) return;

    // Determinar status baseado no evento mais recente
    const eventoMaisRecente = eventos[0];
    let novoStatus: string;

    switch (eventoMaisRecente.tipo_evento) {
      case "LIQUIDACAO":
        novoStatus = "LIQUIDADO";
        break;
      case "BAIXA":
        novoStatus = "BAIXADO";
        break;
      case "DEVOLUCAO":
        novoStatus = "DEVOLVIDO";
        break;
      case "PROTESTO":
        novoStatus = "PROTESTO_INSTRUIDO";
        break;
      case "CARTORIO":
        novoStatus = "EM_CARTORIO";
        break;
      default:
        novoStatus = "ABERTO";
    }

    // Atualizar status do título
    await supabase
      .from("titulos_cobranca")
      .update({ status_atual: novoStatus as any })
      .eq("id", tituloId);
  } catch (error) {
    console.error(`Erro ao atualizar status do título ${tituloId}:`, error);
  }
}

